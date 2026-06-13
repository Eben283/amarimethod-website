import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Loader2, ExternalLink, AlertCircle, X, Phone, MessageSquare,
  Mail, StickyNote, Calendar, CalendarCheck, CheckCircle2, Search, Pencil, Check,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getPartnerProspects, getPartnerActivity, recordPartnerOutcome,
  toggleOutreachVerified, triggerActivityRefresh, updateContactField, ApiError,
  type EditableFieldKey,
} from '../lib/api';
import type {
  PartnerProspect, PartnerCategoryFilter, PartnerCategory, PartnerStage,
  PartnerLastSignal, PartnerActivityEvent,
} from '../types/staff';

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

const STALE_DAYS_THRESHOLD = 14;
const OUTREACH_STAGES: PartnerStage[] = ['no-outreach', 'working'];

// ─────────────────────────────────────────────────────────────────────────────
// Utility: friendly date format ("May 20th 2026", no time)

// Display-only title-case for names. GHL stores most contact names as lowercase
// (data quality from the import). We don't write back to GHL because names with
// intentional casing (O'Brien, McDonald, deSouza, iPhone) would get mangled —
// so we only auto-title-case when the value is entirely lowercase.
function displayName(s: string | null | undefined): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (!trimmed) return '';
  // If any uppercase letter exists, treat the casing as intentional.
  if (/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Extract a clean hostname from a URL for display ("www.f45training.com/marina"
// → "f45training.com"). Falls back to the raw string if parsing fails.
function hostnameOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Format the social profile string from Garrett's sheet (originally an
// "Instagram" column but mixed: IG handles, IG URLs, FB URLs, escaped text).
// Returns { platform, label, url } or null if value is empty/garbage.
function formatSocialProfile(raw: string | null | undefined): {
  platform: 'Instagram' | 'Facebook' | 'TikTok' | 'LinkedIn' | 'Web';
  label: string;
  url: string;
} | null {
  if (!raw) return null;
  // Markdown export from the sheet escapes underscores and dots.
  const cleaned = raw.replace(/\\([_.])/g, '$1').trim();
  if (!cleaned) return null;

  // Full URL — detect platform from hostname.
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const u = new URL(cleaned);
      const host = u.hostname.replace(/^www\./, '');
      const path = u.pathname.replace(/^\/+|\/+$/g, '');
      let platform: 'Instagram' | 'Facebook' | 'TikTok' | 'LinkedIn' | 'Web' = 'Web';
      if (host.includes('instagram.')) platform = 'Instagram';
      else if (host.includes('facebook.') || host.includes('fb.com')) platform = 'Facebook';
      else if (host.includes('tiktok.')) platform = 'TikTok';
      else if (host.includes('linkedin.')) platform = 'LinkedIn';
      return { platform, label: path ? `@${path.split('/')[0]}` : host, url: cleaned };
    } catch {
      return { platform: 'Web', label: cleaned, url: cleaned };
    }
  }

  // Bare value (no protocol). Strip @ if present.
  const handle = cleaned.replace(/^@/, '');

  // Reject obvious non-handles: business-name strings with spaces, or anything
  // too long to be a handle. Show as plain text, no link.
  if (/\s/.test(handle) || handle.length > 40) {
    return { platform: 'Web', label: cleaned, url: '' };
  }

  // Default to Instagram (the source column was the IG column in the sheet).
  return { platform: 'Instagram', label: `@${handle}`, url: `https://instagram.com/${handle}` };
}

function friendlyDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' :
    day % 10 === 2 && day !== 12 ? 'nd' :
    day % 10 === 3 && day !== 13 ? 'rd' :
    'th';
  return `${month} ${day}${suffix} ${year}`;
}

// "When did I last touch this contact?" — combines two signals:
//   1. lastActivityAt: last message in GHL /conversations (backfilled from outbound
//      calls/SMS/emails — only updated when GHL itself logs the message).
//   2. partnerLastSignalAt: when the user clicked an outcome button in the app
//      (Voicemail / Talked / etc.) — not a GHL message, just our state record.
// Garrett expects "Last activity" on the row to reflect the most recent of either.
// Otherwise a contact he just dispositioned reads as "2 months ago" because that's
// when the last conversation message was.
function lastTouchAt(p: PartnerProspect): string | null {
  const a = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : null;
  const b = p.partnerLastSignalAt ? new Date(p.partnerLastSignalAt).getTime() : null;
  if (a === null && b === null) return null;
  const t = Math.max(a ?? 0, b ?? 0);
  return new Date(t).toISOString();
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

// Placeholder emails were generated by the LinkedIn migration script for
// contacts scraped from LinkedIn but lacking a real email address. The pattern
// is `firstname.lastname.linkedin@amari-prospect.placeholder`. Anyone with
// this email shape is a confirmed LinkedIn presence even if no specific
// profile URL is stored yet.
const PLACEHOLDER_EMAIL_REGEX = /@amari-prospect\.placeholder$/i;

function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && PLACEHOLDER_EMAIL_REGEX.test(email);
}

function hasLinkedinPresence(p: PartnerProspect): boolean {
  return !!p.linkedinUrl || isPlaceholderEmail(p.email);
}

// Direct URL when we have the actual profile URL; LinkedIn search URL using
// firstname + lastname when we only know the person is on LinkedIn (placeholder
// email case). Returns null if we have no LinkedIn signal at all.
function linkedinJumpUrl(p: PartnerProspect): string | null {
  if (p.linkedinUrl) return p.linkedinUrl;
  if (!isPlaceholderEmail(p.email)) return null;
  const first = (p.firstName || '').trim();
  const last = (p.lastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ').trim();
  if (!name) return null;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}`;
}

// Compare URLs by hostname + first path segment, lowercased. Lets us detect
// that "https://www.marcibowman.com/" and "marcibowman.com" represent the
// same place even when one is a bare host and the other a full URL with a
// trailing slash. Used to suppress duplicate URLs across rows (e.g. an
// "Other URLs" entry that just repeats the Website).
function urlFingerprint(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/\\([_.])/g, '$1');
  if (!cleaned) return '';
  try {
    const u = new URL(cleaned.match(/^https?:\/\//i) ? cleaned : `https://${cleaned}`);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const seg = u.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
    return seg ? `${host}/${seg.toLowerCase()}` : host;
  } catch {
    return cleaned.toLowerCase();
  }
}

// Normalize an Instagram-shaped value (handle, @handle, or full URL) into
// just the lowercased handle. Used to dedupe the legacy socialProfile field
// against the newer partner_instagram field.
function normalizeInstagramHandle(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/\\([_.])/g, '$1');
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const u = new URL(cleaned);
      const seg = u.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
      return seg.toLowerCase();
    } catch {
      return '';
    }
  }
  return cleaned.replace(/^@/, '').toLowerCase();
}

function relativeDays(iso: string | null | undefined): string {
  const d = daysSince(iso);
  if (d === null) return 'not recorded';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 30) return `${d}d ago`;
  const months = Math.round(d / 30);
  return `${months}mo ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter chips, badges

const CATEGORY_FILTERS: { id: PartnerCategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'golf', label: 'Golf' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'trainer', label: 'Personal Trainer' },
  { id: 'business', label: 'Business' },
  { id: 'therapist', label: 'Therapist' },
];

const CATEGORY_BADGE: Record<PartnerCategory, string> = {
  golf: 'bg-emerald-100 text-emerald-900',
  tennis: 'bg-amber-100 text-amber-900',
  trainer: 'bg-sky-100 text-sky-900',
  business: 'bg-violet-100 text-violet-900',
  therapist: 'bg-rose-100 text-rose-900',
  unknown: 'bg-gray-100 text-gray-700',
};

// Display labels — underlying GHL values stay unchanged (working/future-potential
// in the picklist). Renamed per 2026-05-23 review: "Working" → "In progress",
// "Future potential" → "Revisit later".
const STAGE_LABEL: Record<PartnerStage, string> = {
  'no-outreach': 'No outreach',
  'working': 'In progress',
  'session-booked': 'Session booked',
  'partner': 'Partner',
  'future-potential': 'Revisit later',
  'dropped': 'Dropped',
};

// Top-level funnel buckets. Collapses 6 stages to 3 actionable tabs.
type TopStage = 'no-outreach' | 'in-progress' | 'closed';

const TOP_STAGE_LABEL: Record<TopStage, string> = {
  'no-outreach': 'No outreach',
  'in-progress': 'In progress',
  'closed': 'Closed',
};

const STAGE_TO_TOP: Record<PartnerStage, TopStage> = {
  'no-outreach': 'no-outreach',
  'working': 'in-progress',
  'session-booked': 'closed',
  'partner': 'closed',
  'future-potential': 'closed',
  'dropped': 'closed',
};

// Sub-filter inside Closed — answers "what kind of closed?"
type ClosedSubStage = 'all' | 'session-booked' | 'partner' | 'future-potential' | 'dropped';

const CLOSED_SUB_FILTERS: { id: ClosedSubStage; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'session-booked', label: 'Session booked' },
  { id: 'partner', label: 'Partner' },
  { id: 'future-potential', label: 'Revisit later' },
  { id: 'dropped', label: 'Dropped' },
];

// Data-quality filter (was the Ready/Review top-level toggle, now a sub-filter).
type VerificationFilter = 'all' | 'verified' | 'review';

const VERIFICATION_FILTERS: { id: VerificationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'verified', label: '✓ Verified' },
  { id: 'review', label: '○ Needs review' },
];

// Recency filter for In Progress tab — answers "who's been ignored too long?"
type RecencyFilter = 'all' | '7' | '14' | '30';

const RECENCY_FILTERS: { id: RecencyFilter; label: string }[] = [
  { id: 'all', label: 'Any time' },
  { id: '7', label: '> 7d ago' },
  { id: '14', label: '> 14d ago' },
  { id: '30', label: '> 30d ago' },
];

// Channel filter — "which contacts can I reach via X right now?". Orthogonal
// to stage and verification. LinkedIn matches both contacts with a stored
// partner_linkedin_url AND contacts with a placeholder email (which means
// they were scraped from LinkedIn, so a profile exists even if the URL
// isn't stored yet — the LinkedIn jump button does a name search in that case).
type ChannelFilter = 'all' | 'phone' | 'linkedin' | 'instagram';

const CHANNEL_FILTERS: { id: ChannelFilter; label: string }[] = [
  { id: 'all', label: 'Any channel' },
  { id: 'phone', label: 'Has phone' },
  { id: 'linkedin', label: 'Has LinkedIn' },
  { id: 'instagram', label: 'Has Instagram' },
];

const SIGNAL_LABEL: Record<PartnerLastSignal, string> = {
  'no-answer': 'No answer',
  'voicemail': 'Voicemail',
  'talked': 'Talked',
  'link-sent': 'Sent link',
  'booked': 'Booked',
  'deferred': 'Future potential',
  'not-interested': 'Not interested',
  'linkedin-msg': 'LinkedIn DM',
  'linkedin-req': 'LinkedIn connect',
  'instagram-msg': 'Instagram DM',
  'in-person': 'In-person',
  // 'skip' and 'note' never persist as partner_last_signal — they're only sent
  // to the outcome endpoint ('skip' → partner_stage=dropped, 'note' → note-only
  // save). Labels exist to satisfy the Record<PartnerLastSignal,…> type and as a
  // fallback if the backend ever echoes one back.
  'skip': 'Skipped',
  'note': 'Note added',
};

// ─────────────────────────────────────────────────────────────────────────────
// Geographic tier — how relevant is this contact for SF studio referrals?
//
// Primary signal: facility name (where they work = where their clients are).
// Fallback: phone area code (typically a club main line — also a geo signal).
//
//   A: SF / Peninsula — primary market, easy comp-session travel
//   B: East Bay / North Bay — feasible but real friction (45–60 min)
//   C: South Bay — meaningful distance (60–90 min)
//   skip: Out of region (LA, NYC, etc.)
//   unknown: no facility, no phone, or facility unrecognized

type GeoTier = 'A' | 'B' | 'C' | 'skip' | 'unknown';

// Facility-name substrings → tier. Match is case-insensitive substring.
// Extend as new clubs surface; missing matches fall through to phone area code.
const FACILITY_TIER: ReadonlyArray<readonly [string, GeoTier]> = [
  // A — SF + Peninsula
  ['california golf club of san francisco', 'A'],
  ['olympic club', 'A'],
  ['san francisco golf club', 'A'],
  ['presidio golf', 'A'],
  ['harding park', 'A'],
  ['tpc harding', 'A'],
  ['lake merced', 'A'],
  ['burlingame country', 'A'],
  ['san bruno golf', 'A'],
  ['crystal springs', 'A'],
  ['peninsula golf', 'A'],
  ['half moon bay golf', 'A'],
  ['poplar creek', 'A'],
  ['sharp park', 'A'],
  ['gleneagles', 'A'],
  ['stanford golf', 'A'],
  ['palo alto', 'A'],
  ['menlo country', 'A'],
  ['mariners point', 'A'],
  ['sequoia woods', 'A'],
  // B — East Bay + North Bay
  ['bridges golf', 'B'],
  ['sequoyah', 'B'],
  ['claremont country', 'B'],
  ['mira vista', 'B'],
  ['round hill country', 'B'],
  ['blackhawk country', 'B'],
  ['ruby hill', 'B'],
  ['castlewood', 'B'],
  ['orinda country', 'B'],
  ['diablo country', 'B'],
  ['marin country', 'B'],
  ['meadow club', 'B'],
  ['peacock gap', 'B'],
  ['mcinnis', 'B'],
  ['tilden park', 'B'],
  ['lone tree', 'B'],
  ['boundary oak', 'B'],
  ['contra costa', 'B'],
  // C — South Bay
  ['cordevalle', 'C'],
  ['santa teresa', 'C'],
  ['san jose country', 'C'],
  ['silver creek', 'C'],
  ['summit pointe', 'C'],
  ['cinnabar hills', 'C'],
  ['the institute', 'C'],
  ['boulder ridge', 'C'],     // San Jose — Bay Club operates a club here
  ['los altos golf', 'C'],
  ['los altos country', 'C'],
  ['saratoga country', 'C'],
  ['la rinconada', 'C'],
  ['almaden golf', 'C'],
  ['coyote creek', 'C'],
  ['eagle ridge', 'C'],
  ['palm valley', 'C'],
  // skip — out of region (catches known wrong-region facilities)
  ['pebble beach', 'C'], // technically a destination resort — still long drive
];

const AREA_CODE_TIER: Record<string, GeoTier> = {
  '415': 'A', '628': 'A', '650': 'A',
  '510': 'B', '925': 'B', '707': 'B',
  '408': 'C', '669': 'C',
};

function computeGeoTier(prospect: PartnerProspect): GeoTier {
  // Facility is the trusted signal — it's the working location, which is
  // where the partnership pays off. If facility is present but unmatched,
  // return 'unknown' rather than falling through to phone: phone area codes
  // can lie (personal cells travel with people), and a silent mis-tier is
  // worse than a visible "?" that prompts adding the club to the list.
  const facility = (prospect.partnerFacility || '').toLowerCase();
  if (facility) {
    for (const [needle, tier] of FACILITY_TIER) {
      if (facility.includes(needle)) return tier;
    }
    return 'unknown';
  }
  // No facility recorded — fall back to phone area code as best-available signal.
  const digits = (prospect.phone || '').replace(/\D/g, '');
  let areaCode: string | null = null;
  if (digits.length === 10) areaCode = digits.slice(0, 3);
  else if (digits.length === 11 && digits.startsWith('1')) areaCode = digits.slice(1, 4);
  if (areaCode && AREA_CODE_TIER[areaCode]) return AREA_CODE_TIER[areaCode];
  return 'unknown';
}

const GEO_TIER_BADGE_LABEL: Record<GeoTier, string> = {
  'A': 'SF',
  'B': 'East Bay',
  'C': 'South Bay',
  'skip': 'OOR',
  'unknown': '?',
};

const GEO_TIER_BADGE_STYLE: Record<GeoTier, string> = {
  'A': 'bg-emerald-100 text-emerald-900',
  'B': 'bg-amber-100 text-amber-900',
  'C': 'bg-slate-200 text-slate-700',
  'skip': 'bg-red-100 text-red-900',
  'unknown': 'bg-gray-100 text-gray-500',
};

const GEO_TIER_SORT_ORDER: Record<GeoTier, number> = {
  'A': 1, 'B': 2, 'C': 3, 'unknown': 4, 'skip': 5,
};

// Outcome buttons — capture what GHL can't infer from raw call/SMS logs.
// "Voicemail" stays even though GHL records the call: GHL doesn't know
// whether Garrett left a message vs hung up.
//
// Note: 'link-sent' intentionally NOT a manual button — sending the partner
// session link happens via GHL/staff-app send-link button, which already
// records an outbound message.
//
// 'booked' removed 2026-06-03 — booked status is now derived from GHL's
// `partner-session-booked` tag (set automatically by the "Partner Session
// Booked — Add Tag" workflow when a partner books the partner calendar). The
// manual button drifted from reality, so the tag is the single source of truth.
const OUTCOME_BUTTONS: { id: PartnerLastSignal; label: string; tone: string }[] = [
  { id: 'voicemail',      label: 'Voicemail',        tone: 'bg-amber-100 text-amber-900 border-amber-400 hover:bg-amber-200' },
  { id: 'talked',         label: 'Talked',           tone: 'bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200' },
  { id: 'deferred',       label: 'Future potential', tone: 'bg-sky-100 text-sky-900 border-sky-400 hover:bg-sky-200' },
  { id: 'not-interested', label: 'Not interested',   tone: 'bg-slate-200 text-slate-700 border-slate-400 hover:bg-slate-300' },
];

// Touch buttons — off-platform actions GHL doesn't see at all. Bump touch
// count + write a note prefixed "Touch:" so the GHL timeline records when
// the outreach happened. Never change partner_stage on their own.
const TOUCH_BUTTONS: { id: PartnerLastSignal; label: string; tone: string }[] = [
  { id: 'linkedin-msg',  label: 'LinkedIn DM',      tone: 'bg-blue-100 text-blue-900 border-blue-400 hover:bg-blue-200' },
  { id: 'linkedin-req',  label: 'LinkedIn connect', tone: 'bg-blue-50 text-blue-800 border-blue-300 hover:bg-blue-100' },
  { id: 'instagram-msg', label: 'Instagram DM',     tone: 'bg-pink-100 text-pink-900 border-pink-400 hover:bg-pink-200' },
  { id: 'in-person',     label: 'In-person',        tone: 'bg-orange-100 text-orange-900 border-orange-400 hover:bg-orange-200' },
];

// Shared rendering for outcome / touch / skip buttons so a tap visibly
// registers: the clicked button shows a spinner while saving, then a ✓
// "Recorded" flash before the modal closes (focus mode then auto-advances).
// Every other button dims while one submission is in flight.
function outcomeBtnClass(
  tone: string,
  size: string,
  isSubmitting: boolean,
  isRecorded: boolean,
  busy: boolean,
): string {
  const base = `${size} rounded-md border-2 transition-all active:scale-95 disabled:hover:scale-100`;
  if (isRecorded) return `${base} ${tone} ring-2 ring-emerald-500 scale-105`;
  if (isSubmitting) return `${base} ${tone} ring-2 ring-amari-charcoal scale-95`;
  return `${base} ${tone} hover:scale-105 ${busy ? 'opacity-40' : ''}`;
}

function outcomeBtnContent(label: string, isSubmitting: boolean, isRecorded: boolean) {
  if (isRecorded) {
    return <span className="inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Recorded</span>;
  }
  if (isSubmitting) {
    return <span className="inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</span>;
  }
  return label;
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority sort for the queue (higher score = closer to top)
//
// Order:
//  1. Working + stale (high attention)
//  2. Future Potential whose follow-up is within 7 days
//  3. Session Booked
//  4. No Outreach (still in queue to start)
//  5. Working with recent activity
//  6. Partner
//  7. Future Potential (not yet due)
//  8. Dropped

function priorityScore(p: PartnerProspect): number {
  const stage = p.partnerStage || 'no-outreach';
  // Use lastTouchAt so contacts recently dispositioned via the app aren't
  // mis-flagged as stale just because their /conversations history is older.
  const dSince = daysSince(lastTouchAt(p));
  const dToFollowup = daysSince(p.partnerFollowupAt);
  const hasPhone = !!p.phone;
  const hasRealSignal = !!p.partnerLastSignal;

  // Penalize hard if there's no phone — Garrett can't call them, so they drop
  // to the bottom of the queue. They're still visible (so they can be moved
  // forward when LinkedIn outreach is wired up), just not in his face.
  const noPhonePenalty = hasPhone ? 0 : -50;
  // Boost verified / sheet-matched contacts — they have clean data, more actionable.
  const verifiedBoost = (p.outreachVerified || p.inGarrettSheet) ? 15 : 0;
  // Recent-touch cool-off: if Garrett (or Eben) already reached out in the
  // last few days, don't surface them as top priority. They're "in motion" —
  // waiting on the other side to respond. Without this, a verified contact
  // who got a LinkedIn connect 2 days ago scores identically to a truly
  // cold contact, which is wrong. Linear decay over 7 days.
  // Eben flagged this 2026-05-29: Will Manning / Arron / Matt all showed
  // top-of-list despite recent LinkedIn connects.
  let recentTouchPenalty = 0;
  if (dSince !== null && dSince >= 0 && dSince < 7) {
    // -42 at 0 days, -36 at 1, -30 at 2, ... -0 at 7.
    recentTouchPenalty = -Math.round((7 - dSince) * 6);
  }
  const adjust = noPhonePenalty + verifiedBoost + recentTouchPenalty;

  if (stage === 'dropped') return 0 + adjust;
  if (stage === 'future-potential') {
    if (dToFollowup !== null && dToFollowup >= -7) return 80 + adjust;
    return 10 + adjust;
  }
  if (stage === 'partner') return 20 + adjust;
  if (stage === 'session-booked') return 70 + adjust;
  if (stage === 'working') {
    // Stale only when there's been real outreach that went cold (not "never touched")
    if (hasRealSignal && (dSince === null || dSince >= STALE_DAYS_THRESHOLD)) return 100 + adjust;
    return 50 + adjust;
  }
  if (stage === 'no-outreach') return 60 + adjust;
  return 30 + adjust;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact row in the queue

// Ready view: card leads with Garrett's real sheet data (Status, Notes).
function ReadyRow({ prospect, onTap }: { prospect: PartnerProspect; onTap: () => void }) {
  const stage = (prospect.partnerStage || 'no-outreach') as PartnerStage;
  // Use lastTouchAt (max of lastActivityAt and app-dispositioned signal time) so
  // a contact just dispositioned in the app isn't mis-flagged stale on its older
  // /conversations-derived lastActivityAt.
  const dSince = daysSince(lastTouchAt(prospect));
  const hasRealContact = !!prospect.partnerLastSignal || !!prospect.lastActivityAt || !!prospect.sheetStatus;
  const isStale = stage === 'working' && hasRealContact && (dSince !== null && dSince >= STALE_DAYS_THRESHOLD);

  return (
    <button
      onClick={onTap}
      className={`w-full text-left bg-white rounded-md border p-3 shadow-sm hover:bg-amari-light-sand/30 transition-colors ${
        isStale ? 'border-l-2 border-l-red-500' : 'border-amari-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium text-amari-charcoal truncate">
          {displayName(prospect.fullName)}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${CATEGORY_BADGE[prospect.category]}`}>
            {prospect.category === 'trainer' ? 'PT' : prospect.category}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amari-light-sand text-amari-charcoal">
            {STAGE_LABEL[stage]}
          </span>
          {isStale && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-red-700 font-medium">
              <AlertCircle className="w-3 h-3" />
              stale
            </span>
          )}
        </div>
      </div>
      {prospect.phone && (
        <p className="text-xs text-amari-charcoal mt-0.5">{prospect.phone}</p>
      )}
      {/* Business info — facility, role, has-PT, website (compact, muted) */}
      {(prospect.partnerFacility || prospect.partnerFacilityRole || prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No' || prospect.website) && (
        <p className="text-[11px] text-amari-text-muted mt-0.5">
          {prospect.partnerFacility && <span>🏢 {displayName(prospect.partnerFacility)}</span>}
          {prospect.partnerFacility && prospect.partnerFacilityRole && ' · '}
          {prospect.partnerFacilityRole && <span>{prospect.partnerFacilityRole}</span>}
          {(prospect.partnerFacility || prospect.partnerFacilityRole) && (prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No') && ' · '}
          {prospect.hasPtOnStaff === 'Yes' && (
            <span className="text-amber-700 font-medium" title="Likely has in-house body worker already — harder partnership">⚠ PT on staff</span>
          )}
          {prospect.hasPtOnStaff === 'No' && (
            <span className="text-emerald-700 font-medium" title="No in-house body worker — open lane for referrals">✓ No PT on staff</span>
          )}
          {(prospect.partnerFacility || prospect.partnerFacilityRole || prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No') && prospect.website && ' · '}
          {prospect.website && <span>{hostnameOf(prospect.website)}</span>}
        </p>
      )}
      {/* Sheet Status and Notes — Garrett's real curated data, leads the card */}
      {prospect.sheetStatus && (
        <p className="text-xs text-amari-charcoal font-medium mt-1">
          📋 {prospect.sheetStatus}
        </p>
      )}
      {prospect.sheetNotes && (
        <p className="text-xs text-amari-text-secondary italic mt-0.5 line-clamp-2">
          "{prospect.sheetNotes}"
        </p>
      )}
      <p className="text-[11px] text-amari-text-muted mt-1">
        Last touch: {relativeDays(lastTouchAt(prospect))}
        {prospect.partnerLastSignal && ` · ${SIGNAL_LABEL[prospect.partnerLastSignal]}`}
        {prospect.touchCount > 0 && ` · ${prospect.touchCount} ${prospect.touchCount === 1 ? 'touch' : 'touches'}`}
      </p>
    </button>
  );
}

// Review view: card emphasizes the verification action and what's missing.
function ReviewRow({
  prospect,
  onTap,
  onMarkVerified,
}: {
  prospect: PartnerProspect;
  onTap: () => void;
  onMarkVerified: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();
  const handleVerify = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSubmitting(true);
    try {
      await onMarkVerified();
    } finally {
      setSubmitting(false);
    }
  };
  const missing: string[] = [];
  if (!prospect.phone) missing.push('phone');
  if (!prospect.email) missing.push('email');
  if (!prospect.partnerFacility) missing.push('facility');

  // Visual feedback for "I just touched this." When partnerLastSignalAt is today,
  // the card dims and shows the signal that was logged. Without this, after recording
  // an outcome via the modal the card looks identical to untouched cards, so a batch
  // of outreach can't be visually audited and contacts get missed.
  const touchedDaysAgo = daysSince(prospect.partnerLastSignalAt);
  const justTouchedToday = touchedDaysAgo === 0;
  const containerClass = justTouchedToday
    ? 'w-full text-left bg-emerald-50/60 rounded-md border border-emerald-300 border-l-4 border-l-emerald-500 p-3 shadow-sm hover:bg-emerald-50 transition-colors opacity-80'
    : 'w-full text-left bg-white rounded-md border border-amari-border p-3 shadow-sm hover:bg-amari-light-sand/30 transition-colors';

  return (
    <button
      onClick={onTap}
      className={containerClass}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium text-amari-charcoal truncate">
          {displayName(prospect.fullName)}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {(() => {
            const tier = computeGeoTier(prospect);
            return (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${GEO_TIER_BADGE_STYLE[tier]}`}
                title={`Geo tier ${tier} — ${tier === 'A' ? 'SF / Peninsula' : tier === 'B' ? 'East Bay / North Bay' : tier === 'C' ? 'South Bay' : tier === 'skip' ? 'Out of region' : 'Location unknown — facility unrecognized + no phone area code match'}`}
              >
                {GEO_TIER_BADGE_LABEL[tier]}
              </span>
            );
          })()}
          <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${CATEGORY_BADGE[prospect.category]}`}>
            {prospect.category === 'trainer' ? 'PT' : prospect.category}
          </span>
        </div>
      </div>
      {justTouchedToday && prospect.partnerLastSignal && (
        <p className="text-[11px] text-emerald-800 font-medium mt-0.5">
          ✓ Logged today: {SIGNAL_LABEL[prospect.partnerLastSignal]}
        </p>
      )}
      {prospect.phone ? (
        <p className="text-xs text-amari-charcoal mt-0.5">{prospect.phone}</p>
      ) : (
        <p className="text-xs text-amari-text-muted italic mt-0.5">
          {prospect.email ? `email only: ${prospect.email}` : prospect.socialProfile ? `social only: ${formatSocialProfile(prospect.socialProfile)?.label || prospect.socialProfile}` : 'no contact info'}
        </p>
      )}
      {/* Business info (helps decide whether to verify) */}
      {(prospect.partnerFacility || prospect.partnerFacilityRole || prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No' || prospect.website) && (
        <p className="text-[11px] text-amari-text-muted mt-0.5">
          {prospect.partnerFacility && <span>🏢 {displayName(prospect.partnerFacility)}</span>}
          {prospect.partnerFacility && prospect.partnerFacilityRole && ' · '}
          {prospect.partnerFacilityRole && <span>{prospect.partnerFacilityRole}</span>}
          {(prospect.partnerFacility || prospect.partnerFacilityRole) && (prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No') && ' · '}
          {prospect.hasPtOnStaff === 'Yes' && (
            <span className="text-amber-700 font-medium" title="Likely has in-house body worker already — harder partnership">⚠ PT on staff</span>
          )}
          {prospect.hasPtOnStaff === 'No' && (
            <span className="text-emerald-700 font-medium" title="No in-house body worker — open lane for referrals">✓ No PT on staff</span>
          )}
          {(prospect.partnerFacility || prospect.partnerFacilityRole || prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No') && prospect.website && ' · '}
          {prospect.website && <span>{hostnameOf(prospect.website)}</span>}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-[11px] text-amari-text-muted mt-0.5">
          Missing: {missing.join(', ')}
        </p>
      )}
      {/* Touch summary — matches the OutreachRow format on the search/in-progress
          views. Without this, you can't tell at a scan whether you've already
          worked a contact (the just-touched-today emerald treatment only handles
          today's touches, not historical). */}
      {(prospect.touchCount > 0 || prospect.partnerLastSignal) && (
        <p className="text-[11px] text-amari-text-muted mt-0.5">
          Last touch: {relativeDays(lastTouchAt(prospect))}
          {prospect.partnerLastSignal && ` · ${SIGNAL_LABEL[prospect.partnerLastSignal]}`}
          {prospect.touchCount > 0 && ` · ${prospect.touchCount} ${prospect.touchCount === 1 ? 'touch' : 'touches'}`}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2" onClick={stopProp}>
        <button
          onClick={handleVerify}
          disabled={submitting}
          className={
            justTouchedToday
              ? 'px-2.5 py-1 rounded text-xs font-medium bg-white text-emerald-700 border border-emerald-400 hover:bg-emerald-50 disabled:opacity-50'
              : 'px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
          }
        >
          {submitting ? '...' : '✓ Mark verified'}
        </button>
        <span className="text-[11px] text-amari-text-muted">— moves to Ready view</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditableField — inline edit for one field on a contact.
//
// Click → input + Save/Cancel. Optimistic UI: parent's local state updates
// immediately on save; rolls back if the API call fails. Clearing a non-empty
// field requires a confirm() prompt so a stray tab-out can't wipe data.
//
// `displayChildren` renders the read-state (e.g. a clickable link). When
// undefined, falls back to plain text of the current value.

function EditableField({
  label,
  value,
  fieldKey,
  contactId,
  onSaved,
  type = 'text',
  placeholder,
  displayChildren,
}: {
  label: string;
  value: string | null;
  fieldKey: EditableFieldKey;
  contactId: string;
  onSaved: (newValue: string) => void;
  type?: 'text' | 'email' | 'tel' | 'url';
  placeholder?: string;
  displayChildren?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset draft when the underlying value changes (e.g. after a reload).
  useEffect(() => { setDraft(value || ''); }, [value]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(value || '');
    setError('');
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setError(''); setDraft(value || ''); };

  const save = async () => {
    const newVal = draft.trim();
    if (newVal === (value || '')) { setEditing(false); return; }
    if (!newVal && value) {
      if (!confirm(`Clear ${label}? This removes "${value}" from the contact.`)) return;
    }
    setSaving(true);
    setError('');
    try {
      await updateContactField(contactId, fieldKey, newVal);
      onSaved(newVal);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex gap-2 items-start">
        <dt className="text-amari-text-muted w-24 shrink-0 pt-1">{label}</dt>
        <dd className="text-amari-charcoal flex-1 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <input
              type={type}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') cancel();
              }}
              className="flex-1 text-sm border border-amari-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amari-pine-teal"
              disabled={saving}
            />
            <button
              onClick={save}
              disabled={saving}
              className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
              title="Save (Enter)"
            >
              {saving ? '...' : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={cancel}
              disabled={saving}
              className="px-2 py-1 rounded bg-white text-amari-text-muted text-xs border border-amari-border hover:bg-amari-light-sand/50 disabled:opacity-50"
              title="Cancel (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {error && <p className="text-[11px] text-red-700">{error}</p>}
        </dd>
      </div>
    );
  }

  return (
    <div className="flex gap-2 group">
      <dt className="text-amari-text-muted w-24 shrink-0">{label}</dt>
      <dd className="text-amari-charcoal break-all flex-1 flex items-center gap-1">
        <span className="flex-1">
          {displayChildren ?? (value ? value : <span className="text-amari-text-muted italic">—</span>)}
        </span>
        <button
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-amari-text-muted hover:text-amari-charcoal"
          title={`Edit ${label}`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — full detail + actions

function ProspectModal({
  prospect,
  onClose,
  onOutcomeRecorded,
  onLocalPatch,
  focusContext,
}: {
  prospect: PartnerProspect;
  onClose: () => void;
  onOutcomeRecorded: (signal: PartnerLastSignal) => void;
  /** Optimistic local update from inline field edits. Lets the modal reflect
   *  the edit instantly without waiting for a full reload. */
  onLocalPatch?: (patch: Partial<PartnerProspect>) => void;
  focusContext?: {
    progress: string;
    remaining: string;
    onSkip: () => void;
    onExit: () => void;
  };
}) {
  const [activity, setActivity] = useState<PartnerActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  // Per-button feedback: which signal is mid-submit (spinner) and which just
  // succeeded (✓ flash before the modal closes / focus mode advances).
  const [submittingSignal, setSubmittingSignal] = useState<PartnerLastSignal | null>(null);
  const [recordedSignal, setRecordedSignal] = useState<PartnerLastSignal | null>(null);
  const [outcomeError, setOutcomeError] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [pendingDeferred, setPendingDeferred] = useState(false);
  // Note-only save (the "Save note" button) gets its own in-flight + confirmed
  // state so it doesn't drive the outcome buttons' spinner/✓ visuals.
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const busy = submittingSignal !== null || recordedSignal !== null || savingNote;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setActivityLoading(true);
      setActivityError('');
      try {
        const data = await getPartnerActivity(prospect.contactId);
        if (!cancelled) setActivity(data.events);
      } catch (err) {
        if (!cancelled) setActivityError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prospect.contactId]);

  const handleOutcome = async (signal: PartnerLastSignal) => {
    if (signal === 'deferred' && !followupDate) {
      setPendingDeferred(true);
      return;
    }
    setSubmittingSignal(signal);
    setOutcomeError('');
    try {
      await recordPartnerOutcome({
        contactId: prospect.contactId,
        signal,
        note: outcomeNote.trim() || undefined,
        followupAt: signal === 'deferred' ? followupDate : undefined,
      });
      // Success → flip the clicked button to a confirmed state for a beat so the
      // tap visibly registers, then close (focus mode auto-advances).
      setSubmittingSignal(null);
      setRecordedSignal(signal);
      setTimeout(() => {
        onOutcomeRecorded(signal);
        onClose();
      }, 600);
    } catch (err) {
      setSubmittingSignal(null);
      setOutcomeError(err instanceof Error ? err.message : 'Failed to record outcome');
    }
  };

  // Save a standalone note WITHOUT recording an outcome. Writes a GHL "Note: …"
  // entry only — no stage/signal/touch change, no meter pollution, and (unlike
  // an outcome) it does NOT advance focus mode or close the modal. The user can
  // keep working the contact and still record an outcome afterward.
  const handleSaveNote = async () => {
    const text = outcomeNote.trim();
    if (!text || busy) return;
    setSavingNote(true);
    setNoteSaved(false);
    setOutcomeError('');
    try {
      await recordPartnerOutcome({
        contactId: prospect.contactId,
        signal: 'note',
        note: text,
      });
      // Optimistically surface the new note at the top of the visible timeline.
      setActivity((prev) => [
        { date: new Date().toISOString(), type: 'note', body: `Note: ${text}` },
        ...prev,
      ]);
      setSavingNote(false);
      setNoteSaved(true);
      setOutcomeNote('');
      setTimeout(() => setNoteSaved(false), 1500);
    } catch (err) {
      setSavingNote(false);
      setOutcomeError(err instanceof Error ? err.message : 'Failed to save note');
    }
  };

  const stage = (prospect.partnerStage || 'no-outreach') as PartnerStage;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-start sm:items-center justify-center p-0 sm:p-4"
      onClick={focusContext ? undefined : onClose}
    >
      {/* Card is fixed-height (max 100vh on mobile, 90vh on desktop) and uses
          flex-col so the header stays put while the body scrolls inside it.
          Earlier version had the outer container scrolling, which made the
          "sticky" header scroll out of view when content was tall — Eben
          flagged this 2026-05-29 (Pure Performance Private Fitness modal). */}
      <div
        className="bg-amari-bone-white w-full sm:max-w-2xl sm:rounded-lg shadow-xl flex flex-col max-h-[100dvh] sm:max-h-[90vh] my-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — shrink-0 so it stays visible while body scrolls. */}
        <div className="shrink-0 flex items-center justify-between border-b border-amari-border px-4 py-3 bg-amari-bone-white shadow-sm">
          <div>
            <h2 className="text-lg font-serif text-amari-charcoal">{displayName(prospect.fullName)}</h2>
            <p className="text-xs text-amari-text-muted">
              {prospect.category === 'trainer' ? 'Personal Trainer' : prospect.category} · {STAGE_LABEL[stage]}
              {prospect.partnerSource && ` · ${prospect.partnerSource}`}
            </p>
            {focusContext && (
              <p className="text-[11px] text-amari-text-muted mt-0.5 font-medium">
                {focusContext.progress} · {focusContext.remaining}
              </p>
            )}
          </div>
          {focusContext ? (
            <div className="flex items-center gap-1">
              <button
                onClick={focusContext.onSkip}
                disabled={busy}
                className="text-xs text-amari-text-muted hover:text-amari-charcoal px-2 py-1.5 disabled:opacity-40 disabled:pointer-events-none"
              >
                Skip →
              </button>
              <button
                onClick={focusContext.onExit}
                className="p-1 hover:bg-amari-light-sand rounded"
                aria-label="Exit focus mode"
              >
                <X className="w-5 h-5 text-amari-charcoal" />
              </button>
            </div>
          ) : (
            <button onClick={onClose} className="p-1 hover:bg-amari-light-sand rounded">
              <X className="w-5 h-5 text-amari-charcoal" />
            </button>
          )}
        </div>

        {/* Body — flex-1 + overflow-y-auto so it absorbs remaining height and
            scrolls inside the card. Header above stays pinned.
            min-h-0 is REQUIRED: a flex child defaults to min-height:auto, which
            refuses to shrink below its content, so overflow-y-auto never engages
            and the scrollbar appears but won't move (iOS Chrome, Garrett
            2026-06-03). overscroll-contain stops the scroll from chaining to the
            page behind the modal. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
          {/* Contact */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Contact</h3>
            {/* Two-column grid on sm+ so the modal doesn't get absurdly tall.
                Items wrap naturally if either column overflows. */}
            <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
              <EditableField
                label="Phone"
                value={prospect.phone}
                fieldKey="phone"
                contactId={prospect.contactId}
                type="tel"
                placeholder="+1..."
                onSaved={(v) => onLocalPatch?.({ phone: v || null })}
              />
              <EditableField
                label="Email"
                value={prospect.email}
                fieldKey="email"
                contactId={prospect.contactId}
                type="email"
                placeholder="name@domain.com"
                onSaved={(v) => onLocalPatch?.({ email: v || null })}
              />
              <EditableField
                label="Website"
                value={prospect.website}
                fieldKey="website"
                contactId={prospect.contactId}
                type="url"
                placeholder="example.com"
                onSaved={(v) => onLocalPatch?.({ website: v || null })}
                displayChildren={prospect.website && (
                  <a href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
                     target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                     className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                    {hostnameOf(prospect.website) || prospect.website} <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              />
              {/* Garrett's sheet socialProfile — read-only, marked so it's clear
                  it comes from the sheet. Suppressed when it duplicates a value
                  already shown in one of the editable rows below (most commonly
                  the same Instagram handle in both socialProfile and the newer
                  partner_instagram field). */}
              {(() => {
                const s = formatSocialProfile(prospect.socialProfile);
                if (!s) return null;
                // Suppress if it's the same Instagram handle as partner_instagram
                const sheetHandle = normalizeInstagramHandle(prospect.socialProfile);
                const igHandle = normalizeInstagramHandle(prospect.instagram);
                if (s.platform === 'Instagram' && sheetHandle && igHandle && sheetHandle === igHandle) return null;
                // Suppress if same LinkedIn as partner_linkedin_url
                if (s.platform === 'LinkedIn' && prospect.linkedinUrl
                    && urlFingerprint(s.url) === urlFingerprint(prospect.linkedinUrl)) return null;
                // Suppress if same as Website
                if (s.platform === 'Web' && prospect.website
                    && urlFingerprint(s.url || s.label) === urlFingerprint(prospect.website)) return null;
                return (
                  <div className="flex gap-2">
                    <dt className="text-amari-text-muted w-24 shrink-0">{s.platform}</dt>
                    <dd className="text-amari-charcoal break-all">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                           className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                          {s.label} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : s.label}
                      <span className="text-[10px] text-amari-text-muted ml-1 italic">(from sheet)</span>
                    </dd>
                  </div>
                );
              })()}
              <EditableField
                label="LinkedIn"
                value={prospect.linkedinUrl}
                fieldKey="partnerLinkedinUrl"
                contactId={prospect.contactId}
                type="url"
                placeholder="https://linkedin.com/in/handle"
                onSaved={(v) => onLocalPatch?.({ linkedinUrl: v || null })}
                displayChildren={(() => {
                  // Direct URL → clickable profile link. No stored URL but
                  // placeholder email → search link using firstname+lastname,
                  // because we know they're on LinkedIn even if we don't yet
                  // know which profile is theirs. Edit to capture the real URL.
                  if (prospect.linkedinUrl) {
                    let label = prospect.linkedinUrl;
                    try {
                      const u = new URL(prospect.linkedinUrl);
                      const seg = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
                      if (seg.length >= 2) label = `@${seg[1]}`;
                    } catch { /* raw */ }
                    return (
                      <a href={prospect.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                         className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                        {label} <ExternalLink className="w-3 h-3" />
                      </a>
                    );
                  }
                  const searchUrl = linkedinJumpUrl(prospect);
                  if (searchUrl) {
                    return (
                      <a href={searchUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                         className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                        Search on LinkedIn <ExternalLink className="w-3 h-3" />
                        <span className="text-[10px] text-amari-text-muted ml-1 italic">(profile URL not stored)</span>
                      </a>
                    );
                  }
                  return null;
                })()}
              />
              <EditableField
                label="Instagram"
                value={prospect.instagram}
                fieldKey="partnerInstagram"
                contactId={prospect.contactId}
                placeholder="@handle"
                onSaved={(v) => onLocalPatch?.({ instagram: v || null })}
                displayChildren={prospect.instagram && (() => {
                  const raw = prospect.instagram.trim();
                  let handle = raw.replace(/^@/, '');
                  let href = raw;
                  if (raw.startsWith('http')) {
                    try {
                      const u = new URL(raw);
                      const seg = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
                      if (seg.length >= 1 && seg[0]) handle = seg[0];
                    } catch { /* fall through */ }
                  } else {
                    href = `https://instagram.com/${handle}`;
                  }
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                       className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                      @{handle} <ExternalLink className="w-3 h-3" />
                    </a>
                  );
                })()}
              />
              <EditableField
                label="Other URLs"
                value={prospect.otherUrls}
                fieldKey="partnerOtherUrls"
                contactId={prospect.contactId}
                type="text"
                placeholder="url1; url2; url3"
                onSaved={(v) => onLocalPatch?.({ otherUrls: v || null })}
                displayChildren={(() => {
                  if (!prospect.otherUrls) return null;
                  const urls = prospect.otherUrls.split(/[;\n]/).map((u) => u.trim()).filter(Boolean);
                  // Suppress URLs that duplicate something already rendered above
                  // (Website, LinkedIn, Instagram, or the from-sheet socialProfile).
                  const alreadyShown = new Set<string>();
                  if (prospect.website) alreadyShown.add(urlFingerprint(prospect.website));
                  if (prospect.linkedinUrl) alreadyShown.add(urlFingerprint(prospect.linkedinUrl));
                  if (prospect.instagram) {
                    const ig = normalizeInstagramHandle(prospect.instagram);
                    if (ig) alreadyShown.add(`instagram.com/${ig}`);
                  }
                  if (prospect.socialProfile) {
                    const sp = formatSocialProfile(prospect.socialProfile);
                    if (sp?.url) alreadyShown.add(urlFingerprint(sp.url));
                  }
                  const filtered = urls.filter((url) => !alreadyShown.has(urlFingerprint(url)));
                  if (filtered.length === 0) return null;
                  return (
                    <div className="flex flex-col gap-0.5">
                      {filtered.map((url, i) => {
                        const href = url.startsWith('http') ? url : `https://${url}`;
                        const label = hostnameOf(url) || url;
                        return (
                          <a key={i} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                             className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                            {label} <ExternalLink className="w-3 h-3" />
                          </a>
                        );
                      })}
                    </div>
                  );
                })()}
              />
              <EditableField
                label="Business"
                value={prospect.companyName}
                fieldKey="companyName"
                contactId={prospect.contactId}
                onSaved={(v) => onLocalPatch?.({ companyName: v || null })}
              />
              <EditableField
                label="Facility"
                value={prospect.partnerFacility}
                fieldKey="partnerFacility"
                contactId={prospect.contactId}
                onSaved={(v) => onLocalPatch?.({ partnerFacility: v || null })}
                displayChildren={prospect.partnerFacility && displayName(prospect.partnerFacility)}
              />
              {prospect.partnerFacilityType && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Facility type</dt><dd className="text-amari-charcoal">{prospect.partnerFacilityType}</dd></div>
              )}
              <EditableField
                label="Role"
                value={prospect.partnerFacilityRole}
                fieldKey="partnerFacilityRole"
                contactId={prospect.contactId}
                onSaved={(v) => onLocalPatch?.({ partnerFacilityRole: (v as PartnerProspect['partnerFacilityRole']) || null })}
              />
              {prospect.hasPtOnStaff && prospect.hasPtOnStaff !== 'Unknown' && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">PT on staff</dt><dd className="text-amari-charcoal">{prospect.hasPtOnStaff}</dd></div>
              )}
              <EditableField
                label="City"
                value={prospect.city}
                fieldKey="city"
                contactId={prospect.contactId}
                onSaved={(v) => onLocalPatch?.({ city: v || null })}
              />
              <EditableField
                label="State"
                value={prospect.state}
                fieldKey="state"
                contactId={prospect.contactId}
                placeholder="CA"
                onSaved={(v) => onLocalPatch?.({ state: v || null })}
              />
              <EditableField
                label="Zip"
                value={prospect.postalCode}
                fieldKey="postalCode"
                contactId={prospect.contactId}
                onSaved={(v) => onLocalPatch?.({ postalCode: v || null })}
              />
              <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Touches</dt><dd className="text-amari-charcoal">{prospect.touchCount} {prospect.touchCount === 1 ? 'outreach action' : 'outreach actions'}</dd></div>
            </dl>
            {prospect.rundown && (
              <div className="mt-2 p-2 rounded bg-amari-light-sand/40 border border-amari-border/40">
                <p className="text-[10px] uppercase tracking-wide text-amari-text-muted mb-0.5">Rundown</p>
                <p className="text-xs text-amari-charcoal whitespace-pre-wrap">{prospect.rundown}</p>
              </div>
            )}
            {(prospect.outreachVerified || prospect.inGarrettSheet) && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <CheckCircle2 className="w-3 h-3" />
                {prospect.outreachVerified && prospect.inGarrettSheet
                  ? "verified · in Garrett's sheet"
                  : prospect.outreachVerified
                    ? 'outreach verified'
                    : "in Garrett's sheet"}
              </p>
            )}
          </section>

          {/* From Garrett's sheet — primary source of human-curated outreach data */}
          {(prospect.sheetStatus || prospect.sheetNotes) && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">
                From Garrett's sheet
              </h3>
              {prospect.sheetStatus && (
                <p className="text-sm text-amari-charcoal font-medium">
                  Status: {prospect.sheetStatus}
                </p>
              )}
              {prospect.sheetNotes && (
                <p className="text-sm text-amari-text-secondary italic mt-1">
                  "{prospect.sheetNotes}"
                </p>
              )}
            </section>
          )}

          {/* Follow-up date (if Future Potential) */}
          {stage === 'future-potential' && prospect.partnerFollowupAt && (
            <section className="bg-amari-light-sand rounded p-2.5 text-sm">
              <div className="inline-flex items-center gap-1.5 text-amari-charcoal">
                <Calendar className="w-4 h-4" />
                Follow up: <strong>{friendlyDate(prospect.partnerFollowupAt)}</strong>
              </div>
            </section>
          )}

          {/* Enrichment note — pulled out of the timeline because it's the most
              actionable context. Most recent note whose body starts with "Enrichment". */}
          {(() => {
            const enrichment = activity.find((e) => e.type === 'note' && (e.body || '').trim().startsWith('Enrichment'));
            if (!enrichment) return null;
            return (
              <section>
                <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Enrichment summary</h3>
                <div className="bg-amari-light-sand rounded p-3 text-sm text-amari-charcoal whitespace-pre-wrap leading-relaxed">
                  {(enrichment.body || '').replace(/^Enrichment[^:]*:\s*/, '')}
                </div>
                <p className="text-[10px] text-amari-text-muted mt-1">
                  Researched {friendlyDate(enrichment.date)}
                </p>
              </section>
            );
          })()}

          {/* Activity Timeline */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Activity Timeline</h3>
            {activityLoading ? (
              <div className="flex items-center gap-2 text-xs text-amari-text-muted py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading activity...
              </div>
            ) : activityError ? (
              <p className="text-xs text-red-700">{activityError}</p>
            ) : activity.length === 0 ? (
              <p className="text-xs text-amari-text-muted italic">No activity yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {activity
                  // Don't show the enrichment note again — it's already rendered above
                  .filter((e) => !(e.type === 'note' && (e.body || '').trim().startsWith('Enrichment')))
                  .slice(0, 10)
                  .map((e, idx) => (
                    <li key={idx} className="flex gap-2 items-start">
                      <span className="text-amari-text-muted w-28 shrink-0 mt-0.5">{friendlyDate(e.date)}</span>
                      <div className="flex-1 min-w-0">
                        <span className="inline-flex items-center gap-1 text-amari-charcoal">
                          {e.type === 'call' && <Phone className="w-3 h-3" />}
                          {e.type === 'sms' && <MessageSquare className="w-3 h-3" />}
                          {e.type === 'email' && <Mail className="w-3 h-3" />}
                          {e.type === 'note' && <StickyNote className="w-3 h-3" />}
                          {e.type === 'appointment' && <CalendarCheck className="w-3 h-3" />}
                          {e.type === 'call' ? `Call ${e.direction === 'inbound' ? 'received' : 'placed'}` :
                           e.type === 'sms' ? `SMS ${e.direction === 'inbound' ? 'received' : 'sent'}` :
                           e.type === 'email' ? `Email ${e.direction === 'inbound' ? 'received' : 'sent'}` :
                           e.type === 'appointment' ? (e.body || 'Appointment') :
                           'Note'}
                        </span>
                        {e.body && e.type === 'note' && (
                          <p className="text-amari-text-secondary mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                            {e.body}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                {activity.filter((e) => !(e.type === 'note' && (e.body || '').trim().startsWith('Enrichment'))).length > 10 && (
                  <li className="text-amari-text-muted italic">… more older events (open in GHL to see all)</li>
                )}
              </ul>
            )}
          </section>

          {/* Actions */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Actions</h3>
            <a
              href={ghlContactUrl(prospect.contactId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amari-charcoal text-white text-sm font-medium hover:opacity-90 mb-3"
            >
              Open in GHL <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <p className="text-xs uppercase tracking-wide font-bold text-amari-charcoal mt-3 mb-2 flex items-center gap-1.5 select-none">
              <span className="inline-block animate-bounce text-base" style={{ animationDelay: '0s', animationDuration: '0.9s' }}>🐻</span>
              <span className="inline-block animate-bounce text-base" style={{ animationDelay: '0.15s', animationDuration: '0.9s' }}>🐻</span>
              <span className="mx-1">RECORD OUTCOME</span>
              <span className="inline-block animate-bounce text-base" style={{ animationDelay: '0.3s', animationDuration: '0.9s' }}>🐻</span>
              <span className="inline-block animate-bounce text-base" style={{ animationDelay: '0.45s', animationDuration: '0.9s' }}>🐻</span>
            </p>

            {/* Optional note — placed ABOVE the outcome buttons so it's typed
                BEFORE a button click submits and (in focus mode) auto-advances.
                Previously sat below the buttons and was almost never captured. */}
            <label className="block text-[11px] uppercase tracking-wide font-semibold text-amari-text-muted mb-1.5">
              Note <span className="font-normal normal-case">— save on its own, or it rides along with the outcome you record below</span>
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Optional note about this contact..."
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNote(); }}
                /* text-base = 16px: iOS auto-zooms on focus for any input under
                   16px, which inside a fixed modal shoves the field off-screen so
                   you can't see what you type. 16px stops the zoom. */
                className="flex-1 min-w-0 text-base bg-white text-amari-charcoal border border-amari-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amari-charcoal focus:border-transparent"
              />
              {/* Save note on its own — for when there's no outcome to record but
                  you still want the note on the contact's timeline. */}
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={busy || !outcomeNote.trim()}
                title="Save this note without recording an outcome"
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded border border-amari-border bg-white text-amari-charcoal hover:bg-amari-light-sand disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingNote ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                ) : noteSaved ? (
                  <><Check className="w-4 h-4" /> Saved</>
                ) : (
                  'Save note'
                )}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {OUTCOME_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleOutcome(b.id)}
                  disabled={busy}
                  className={outcomeBtnClass(b.tone, 'px-3.5 py-2 text-sm font-semibold', submittingSignal === b.id, recordedSignal === b.id, busy)}
                >
                  {outcomeBtnContent(b.label, submittingSignal === b.id, recordedSignal === b.id)}
                </button>
              ))}
            </div>

            <p className="text-[11px] uppercase tracking-wide font-semibold text-amari-text-muted mb-1.5">
              Log touch <span className="font-normal normal-case text-amari-text-muted">— GHL doesn't see these</span>
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {TOUCH_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleOutcome(b.id)}
                  disabled={busy}
                  className={outcomeBtnClass(b.tone, 'px-3 py-1.5 text-sm font-medium', submittingSignal === b.id, recordedSignal === b.id, busy)}
                >
                  {outcomeBtnContent(b.label, submittingSignal === b.id, recordedSignal === b.id)}
                </button>
              ))}
            </div>

            {/* Skip — disposition without contact. Wrong fit / wrong geo /
                wrong category. Different from Not Interested (they declined).
                Sets stage=dropped, no signal, no touch, no meter pollution. */}
            <p className="text-[11px] uppercase tracking-wide font-semibold text-amari-text-muted mb-1.5">
              Skip <span className="font-normal normal-case text-amari-text-muted">— removes from queue without recording outreach</span>
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => handleOutcome('skip')}
                disabled={busy}
                className={outcomeBtnClass('bg-stone-100 text-stone-700 border-stone-400 hover:bg-stone-200', 'px-3 py-1.5 text-sm font-medium', submittingSignal === 'skip', recordedSignal === 'skip', busy)}
                title="Mark not-a-fit and drop from queue. No outreach recorded — different from Not Interested."
              >
                {outcomeBtnContent('Skip — not a fit', submittingSignal === 'skip', recordedSignal === 'skip')}
              </button>
            </div>

            {pendingDeferred && (
              <div className="bg-amari-light-sand rounded p-2 mb-2">
                <label className="text-xs text-amari-charcoal block mb-1">
                  When should we revisit this contact?
                </label>
                <input
                  type="date"
                  value={followupDate}
                  onChange={(e) => setFollowupDate(e.target.value)}
                  className="text-xs border border-amari-border rounded px-2 py-1 mr-2"
                />
                <button
                  onClick={() => handleOutcome('deferred')}
                  disabled={!followupDate || busy}
                  className="text-xs px-2 py-1 rounded bg-amari-charcoal text-white disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {submittingSignal === 'deferred' ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                  ) : recordedSignal === 'deferred' ? (
                    <><Check className="w-3 h-3" /> Saved</>
                  ) : 'Confirm'}
                </button>
              </div>
            )}
            {outcomeError && (
              <p className="text-xs text-red-700 mt-1.5">{outcomeError}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus mode — single-contact full-screen call queue with auto-advance.
// Pattern adapted from Apollo Tasks / HubSpot guided execution / Close Power Dialer
// per research at /tmp/outreach-ux-research.md (2026-05-24).

function FocusView({
  queue,
  onExit,
  onProspectUpdated,
}: {
  queue: PartnerProspect[];
  onExit: () => void;
  onProspectUpdated: (contactId: string, updates: Partial<PartnerProspect>) => void;
}) {
  const [index, setIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);

  const done = index >= queue.length;
  const prospect = done ? null : queue[index];

  const advance = () => setIndex((i) => i + 1);

  if (done) {
    return (
      <div className="fixed inset-0 bg-amari-bone-white z-[70] flex flex-col">
        <div className="border-b border-amari-border px-4 py-3 flex items-center justify-between bg-white">
          <p className="text-sm font-medium text-amari-charcoal">Done!</p>
          <button
            onClick={onExit}
            className="p-1.5 text-amari-charcoal hover:bg-amari-light-sand rounded"
            aria-label="Exit focus mode"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-md">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h2 className="text-2xl font-serif text-amari-charcoal mb-2">Session done</h2>
            <p className="text-sm text-amari-text-muted mb-6">
              {completedCount} recorded · {queue.length - completedCount} skipped
            </p>
            <button
              onClick={onExit}
              className="px-6 py-2.5 rounded bg-amari-charcoal text-white font-medium hover:opacity-90"
            >
              Back to list
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!prospect) return null;

  return (
    <ProspectModal
      key={prospect.contactId}
      prospect={prospect}
      onClose={advance}
      onLocalPatch={(patch) => onProspectUpdated(prospect.contactId, patch)}
      onOutcomeRecorded={(signal) => {
        if (signal === 'skip') {
          // Skip is a disposition without outreach — only update partner_stage.
          // Do NOT bump signal/signal_at/touch — matches backend behavior.
          onProspectUpdated(prospect.contactId, {
            partnerStage: 'dropped',
          });
        } else {
          onProspectUpdated(prospect.contactId, {
            partnerLastSignal: signal,
            partnerLastSignalAt: new Date().toISOString(),
            touchCount: (prospect.touchCount ?? 0) + 1,
          });
        }
        setCompletedCount((c) => c + 1);
      }}
      focusContext={{
        progress: `${index + 1} of ${queue.length}`,
        remaining: `${completedCount} recorded · ${Math.max(0, queue.length - index)} left`,
        onSkip: advance,
        onExit,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page

type SortMode = 'priority' | 'oldest-contact' | 'newest-contact' | 'least-touched' | 'most-touched' | 'just-touched' | 'by-geo';

const SORT_LABEL: Record<SortMode, string> = {
  'priority': 'Priority',
  'oldest-contact': 'Oldest contact',
  'newest-contact': 'Newest contact',
  'least-touched': 'Fewest touches',
  'most-touched': 'Most touches',
  'just-touched': 'Just touched',
  'by-geo': 'Closest to SF',
};

export default function PartnersPage() {
  const { logout } = useAuth();

  // New structure (2026-05-23 restructure per review feedback):
  //   topStage:           3 top-level tabs (No outreach / In progress / Closed)
  //   verificationFilter: data-quality sub-filter (was the Ready/Review toggle)
  //   closedSubStage:     only meaningful inside Closed
  //   recencyFilter:      only meaningful inside In progress
  const [topStage, setTopStage] = useState<TopStage>('no-outreach');
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>('verified');
  const [closedSubStage, setClosedSubStage] = useState<ClosedSubStage>('all');
  const [recencyFilter, setRecencyFilter] = useState<RecencyFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<PartnerCategoryFilter>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [prospects, setProspects] = useState<PartnerProspect[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  // Activity cache freshness — surfaces silent failure of the nightly refresh Worker
  const [activityRefreshAt, setActivityRefreshAt] = useState<string | null>(null);
  const [activityRefreshStatus, setActivityRefreshStatus] = useState<string | null>(null);
  const [refreshTriggered, setRefreshTriggered] = useState(false);
  const [refreshError, setRefreshError] = useState('');

  // Focus mode — single-contact queue. Snapshot of visibleProspects at start.
  const [focusQueue, setFocusQueue] = useState<PartnerProspect[] | null>(null);

  // Chrome collapse — verification + category + sort row hidden by default
  const [chromeOpen, setChromeOpen] = useState(false);

  // Search WITHIN the loaded prospects (no API call — instant client-side filter).
  // Overrides all tabs/filters: typing finds matching outreach contacts regardless of
  // which tab they live in. Tap result → opens the prospect modal (stays in Outreach).
  // For full-database client lookup, use the Clients tab.
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getPartnerProspects();
      setProspects(data.prospects);
      setActivityRefreshAt(data.activityRefreshAt ?? null);
      setActivityRefreshStatus(data.activityRefreshStatus ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load partners');
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  const handleTriggerRefresh = async () => {
    setRefreshError('');
    setRefreshTriggered(false);
    try {
      await triggerActivityRefresh();
      setRefreshTriggered(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setRefreshError(err instanceof Error ? err.message : 'Failed to trigger refresh');
    }
  };

  useEffect(() => { load(); }, [load]);

  // Progress stats — how many contacts touched today / this week / this month.
  // Uses lastTouchAt (max of partner_last_real_activity and partner_last_signal_at),
  // so the meter counts BOTH outcome-button captures AND real outreach activity
  // pulled from GHL conversations (calls, SMS, email logged by GHL itself).
  // Previously only counted outcome captures, which understated reality when
  // Garrett called clients without going through focus-mode outcome capture.
  const progressStats = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOf7d = now.getTime() - 7 * 86_400_000;
    const startOf30d = now.getTime() - 30 * 86_400_000;
    let today = 0, week = 0, month = 0;
    for (const p of prospects) {
      const iso = lastTouchAt(p);
      if (!iso) continue;
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) continue;
      if (t >= startOfToday) today += 1;
      if (t >= startOf7d) week += 1;
      if (t >= startOf30d) month += 1;
    }
    return { today, week, month };
  }, [prospects]);

  const isSearching = searchQuery.trim().length > 0;

  // Phone digits-only match: typing "415" matches "+1 (415) 555-..." etc.
  const normalizePhoneForMatch = (s: string | null | undefined) =>
    (s || '').replace(/\D/g, '');

  // Client-side filter of prospects by keyword. Instant — no debounce needed
  // since it's just an array filter on data already in memory.
  // Matches against: name, email, web/IG, facility name, facility type & role,
  // sheet status + notes (Garrett's curated context), tags, and signal.
  // Phone is matched separately (digits-only, 3+ digits required).
  const searchMatches = useMemo<PartnerProspect[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, '');
    return prospects.filter((p) => {
      const hay = [
        p.fullName, p.firstName, p.lastName,
        p.email, p.website, p.socialProfile, p.linkedinUrl,
        p.partnerFacility, p.partnerFacilityType, p.partnerFacilityRole,
        p.sheetStatus, p.sheetNotes,
        p.partnerSource, p.partnerLastSignal,
        ...(p.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) return true;
      if (qDigits.length >= 3 && normalizePhoneForMatch(p.phone).includes(qDigits)) return true;
      return false;
    });
  }, [prospects, searchQuery]);

  const isReady = (p: PartnerProspect) => p.outreachVerified || p.inGarrettSheet;
  const prospectTopStage = (p: PartnerProspect): TopStage =>
    STAGE_TO_TOP[(p.partnerStage || 'no-outreach') as PartnerStage];

  // Top-stage counts (universe-wide, used for the three top-level tab pills).
  const topStageCounts = useMemo(() => {
    const counts: Record<TopStage, number> = { 'no-outreach': 0, 'in-progress': 0, 'closed': 0 };
    for (const p of prospects) counts[prospectTopStage(p)] += 1;
    return counts;
  }, [prospects]);

  // Prospects after the top-stage filter — used as base for downstream chip counts.
  const prospectsInTab = useMemo(
    () => prospects.filter((p) => prospectTopStage(p) === topStage),
    [prospects, topStage],
  );

  // Verification counts within the current tab
  const verificationCountsInTab = useMemo(() => {
    let verified = 0, review = 0;
    for (const p of prospectsInTab) (isReady(p) ? verified++ : review++);
    return { all: prospectsInTab.length, verified, review };
  }, [prospectsInTab]);

  // Prospects after the verification filter too — base for category + closed-sub chips
  const prospectsAfterVerification = useMemo(() => {
    if (verificationFilter === 'verified') return prospectsInTab.filter(isReady);
    if (verificationFilter === 'review') return prospectsInTab.filter((p) => !isReady(p));
    return prospectsInTab;
  }, [prospectsInTab, verificationFilter]);

  // Category counts within the current tab + verification filter
  const categoryCountsInTab = useMemo(() => {
    const counts: Record<PartnerCategory, number> = { golf: 0, tennis: 0, trainer: 0, business: 0, therapist: 0, unknown: 0 };
    for (const p of prospectsAfterVerification) counts[p.category] = (counts[p.category] || 0) + 1;
    return counts;
  }, [prospectsAfterVerification]);

  // Closed sub-stage counts (only meaningful when topStage === 'closed')
  const closedSubCounts = useMemo(() => {
    const counts: Record<Exclude<ClosedSubStage, 'all'>, number> = {
      'session-booked': 0, 'partner': 0, 'future-potential': 0, 'dropped': 0,
    };
    for (const p of prospectsAfterVerification) {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) continue;
      const stage = (p.partnerStage || 'no-outreach') as PartnerStage;
      if (stage in counts) counts[stage as Exclude<ClosedSubStage, 'all'>] += 1;
    }
    return counts;
  }, [prospectsAfterVerification, categoryFilter]);

  const visibleProspects = useMemo(() => {
    let v = prospectsAfterVerification;
    if (categoryFilter !== 'all') v = v.filter((p) => p.category === categoryFilter);
    if (channelFilter === 'phone') v = v.filter((p) => !!p.phone && p.phone.trim().length > 0);
    if (channelFilter === 'linkedin') v = v.filter(hasLinkedinPresence);
    if (channelFilter === 'instagram') v = v.filter((p) => !!p.instagram && p.instagram.trim().length > 0);
    if (topStage === 'closed' && closedSubStage !== 'all') {
      v = v.filter((p) => (p.partnerStage || 'no-outreach') === closedSubStage);
    }
    if (topStage === 'in-progress' && recencyFilter !== 'all') {
      const threshold = Number(recencyFilter);
      v = v.filter((p) => {
        // lastTouchAt, not raw lastActivityAt — matches the sort below so an
        // app-dispositioned contact isn't wrongly shown as ignored/stale.
        const d = daysSince(lastTouchAt(p));
        return d !== null && d >= threshold;
      });
    }
    return [...v].sort((a, b) => {
      if (sortMode === 'oldest-contact' || sortMode === 'newest-contact') {
        // Use lastTouchAt so a contact dispositioned via the app sorts as recent
        // even if their /conversations-derived lastActivityAt is older.
        const aIso = lastTouchAt(a);
        const bIso = lastTouchAt(b);
        const da = aIso ? new Date(aIso).getTime() : null;
        const db = bIso ? new Date(bIso).getTime() : null;
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return sortMode === 'oldest-contact' ? da - db : db - da;
      }
      if (sortMode === 'least-touched' || sortMode === 'most-touched') {
        const ta = a.touchCount ?? 0;
        const tb = b.touchCount ?? 0;
        if (ta !== tb) return sortMode === 'least-touched' ? ta - tb : tb - ta;
        const da = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const db = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
        return sortMode === 'least-touched' ? da - db : db - da;
      }
      if (sortMode === 'just-touched') {
        // Most recently recorded outcome first. Contacts with no outcome yet
        // sort to bottom (so the top of the list is always "what I just did").
        const ta = a.partnerLastSignalAt ? new Date(a.partnerLastSignalAt).getTime() : null;
        const tb = b.partnerLastSignalAt ? new Date(b.partnerLastSignalAt).getTime() : null;
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta;
      }
      if (sortMode === 'by-geo') {
        // A (SF/Peninsula) → B (East Bay) → C (South Bay) → unknown → skip.
        // Within a tier, tiebreak by priority so high-leverage SF contacts
        // still rise above low-leverage SF contacts.
        const ga = GEO_TIER_SORT_ORDER[computeGeoTier(a)];
        const gb = GEO_TIER_SORT_ORDER[computeGeoTier(b)];
        if (ga !== gb) return ga - gb;
        return priorityScore(b) - priorityScore(a);
      }
      const pa = priorityScore(a);
      const pb = priorityScore(b);
      if (pa !== pb) return pb - pa;
      const da = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const db = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return da - db;
    });
  }, [prospectsAfterVerification, topStage, categoryFilter, channelFilter, closedSubStage, recencyFilter, sortMode]);

  const handleMarkVerified = async (contactId: string) => {
    // Optimistic: flip the local prospect, then API persists.
    setProspects((prev) =>
      prev.map((p) => p.contactId === contactId ? { ...p, outreachVerified: true } : p),
    );
    try {
      await toggleOutreachVerified(contactId, true);
    } catch {
      // Roll back
      setProspects((prev) =>
        prev.map((p) => p.contactId === contactId ? { ...p, outreachVerified: false } : p),
      );
    }
  };

  const openProspect = useMemo(
    () => openContactId ? prospects.find((p) => p.contactId === openContactId) || null : null,
    [openContactId, prospects],
  );

  const categoryCount = (f: PartnerCategoryFilter): number => {
    if (f === 'all') return prospectsAfterVerification.length;
    return categoryCountsInTab[f as PartnerCategory] ?? 0;
  };

  return (
    <div className="px-3 pt-3 pb-8 max-w-4xl mx-auto">
      {focusQueue && (
        <FocusView
          queue={focusQueue}
          onExit={() => { setFocusQueue(null); load(); }}
          onProspectUpdated={(contactId, updates) => {
            setProspects((prev) => prev.map((p) => p.contactId === contactId ? { ...p, ...updates } : p));
          }}
        />
      )}

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-serif text-amari-charcoal">Outreach</h1>
        <div className="flex items-center gap-3">
          {progressStats.today > 0 ? (
            <button
              onClick={() => setSortMode('just-touched')}
              className="text-[11px] text-amari-text-muted hover:text-amari-charcoal"
              title={`${progressStats.week} this week · ${progressStats.month} this month`}
            >
              <strong className="text-amari-charcoal">{progressStats.today}</strong> done today
            </button>
          ) : progressStats.week > 0 ? (
            <button
              onClick={() => setSortMode('just-touched')}
              className="text-[11px] text-amari-text-muted hover:text-amari-charcoal"
              title={`${progressStats.month} this month`}
            >
              <strong className="text-amari-charcoal">{progressStats.week}</strong> this week
            </button>
          ) : null}
          <button
            onClick={() => load()}
            disabled={isLoading}
            className="flex items-center gap-1 text-xs text-amari-text-muted hover:text-amari-charcoal disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Activity-cache freshness — surfaces silent failure of the nightly refresh.
          Color shifts amber/red as the cache ages. Always-on Refresh button. */}
      {(() => {
        const ageDays = activityRefreshAt
          ? Math.floor((Date.now() - new Date(activityRefreshAt).getTime()) / 86_400_000)
          : null;
        const isError = activityRefreshStatus === 'error';
        const isStale = ageDays !== null && ageDays > 7;
        const isUnknown = ageDays === null;
        const tone = isError || isStale ? 'text-red-700 bg-red-50 border-red-200'
          : isUnknown ? 'text-amari-text-muted bg-amari-light-sand border-amari-border'
          : ageDays >= 2 ? 'text-amber-800 bg-amber-50 border-amber-200'
          : 'text-amari-text-muted bg-amari-bone-white border-amari-border';
        return (
          <div className={`flex items-center justify-between text-[11px] px-2.5 py-1.5 mb-2 rounded border ${tone}`}>
            <span>
              {isError ? '⚠ Activity refresh failed' :
               isUnknown ? 'Activity data freshness unknown' :
               ageDays === 0 ? 'Activity data: refreshed today' :
               ageDays === 1 ? 'Activity data: refreshed 1 day ago' :
               `Activity data: refreshed ${ageDays} days ago${isStale ? ' — stale' : ''}`}
              {refreshTriggered && <span className="ml-2 text-emerald-700">✓ Triggered — reload in 10-15 min</span>}
            </span>
            <button
              onClick={handleTriggerRefresh}
              disabled={refreshTriggered}
              className="text-amari-charcoal hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {refreshTriggered ? 'Triggered' : 'Refresh now →'}
            </button>
          </div>
        );
      })()}
      {refreshError && (
        <p className="text-[11px] text-red-700 mb-2 px-1">{refreshError}</p>
      )}

      {/* Search bar — searches all GHL contacts (partners + general clients) */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amari-text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search name, email, phone, gym, IG, notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="staff-input pl-10 pr-9"
          autoComplete="off"
          autoCapitalize="off"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-amari-light-sand"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-amari-text-muted" />
          </button>
        )}
      </div>

      {isSearching ? (
        /* Search mode — filter prospects (no API call). Overrides tabs + filters.
         * Tap a result → opens the prospect modal (stays in Outreach).
         * For full GHL contact lookup, use the Clients tab. */
        <>
          <p className="text-[11px] text-amari-text-muted mb-2 px-1">
            Searching {prospects.length} outreach contacts. For all clients, use the Clients tab.
          </p>
          {searchMatches.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-amari-text-muted text-sm">No matching outreach contacts</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {searchMatches.map((p) => (
                <ReadyRow
                  key={p.contactId}
                  prospect={p}
                  onTap={() => setOpenContactId(p.contactId)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Top-level tabs: No outreach / In progress / Closed (the funnel itself) */}
          <div className="flex gap-1 bg-amari-light-sand rounded-md p-1 mb-3">
            {(['no-outreach', 'in-progress', 'closed'] as TopStage[]).map((s) => (
              <button
                key={s}
                onClick={() => setTopStage(s)}
                className={`flex-1 px-2 py-2 rounded text-sm font-medium transition-colors ${
                  topStage === s ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted hover:text-amari-charcoal'
                }`}
              >
                {TOP_STAGE_LABEL[s]} <span className="opacity-70 ml-1">({topStageCounts[s]})</span>
              </button>
            ))}
          </div>

          {/* Start outreach — primary action, leads to single-contact focus mode */}
          {visibleProspects.length > 0 && (
            <button
              onClick={() => setFocusQueue([...visibleProspects])}
              className="w-full mb-3 px-4 py-3 rounded-md bg-amari-charcoal text-white font-medium hover:opacity-90 flex items-center justify-between transition-opacity"
            >
              <span>Start outreach</span>
              <span className="text-xs opacity-80">{visibleProspects.length} to do →</span>
            </button>
          )}

          {/* Filters & sort — collapsed disclosure, summary shown when closed */}
          {(() => {
            const summaryParts: string[] = [];
            if (verificationFilter === 'verified') summaryParts.push('✓ Verified');
            else if (verificationFilter === 'review') summaryParts.push('○ Needs review');
            else summaryParts.push('All contacts');
            if (categoryFilter !== 'all') {
              const cat = CATEGORY_FILTERS.find((f) => f.id === categoryFilter)?.label;
              if (cat) summaryParts.push(cat);
            }
            if (channelFilter !== 'all') {
              const ch = CHANNEL_FILTERS.find((f) => f.id === channelFilter)?.label;
              if (ch) summaryParts.push(ch);
            }
            if (sortMode !== 'priority') summaryParts.push(SORT_LABEL[sortMode]);
            if (topStage === 'in-progress' && recencyFilter !== 'all') {
              const r = RECENCY_FILTERS.find((f) => f.id === recencyFilter)?.label;
              if (r) summaryParts.push(r);
            }
            if (topStage === 'closed' && closedSubStage !== 'all') {
              const cs = CLOSED_SUB_FILTERS.find((f) => f.id === closedSubStage)?.label;
              if (cs) summaryParts.push(cs);
            }
            return (
              <button
                onClick={() => setChromeOpen((o) => !o)}
                className="w-full text-left text-[11px] text-amari-text-muted py-1.5 mb-2 px-1 flex items-center justify-between hover:text-amari-charcoal"
              >
                <span>
                  Filters · <span className="text-amari-charcoal">{summaryParts.join(' · ')}</span>
                </span>
                <span className="text-xs">{chromeOpen ? '▲ hide' : '▼ change'}</span>
              </button>
            );
          })()}

          {chromeOpen && (
            <div className="mb-3 pb-2 border-b border-amari-border">
              {/* Verification sub-filter — data quality, orthogonal to stage */}
              <div className="flex gap-1.5 mb-2 -mx-1 px-1 text-[11px]">
                {VERIFICATION_FILTERS.map((f) => {
                  const active = verificationFilter === f.id;
                  const count = verificationCountsInTab[f.id];
                  return (
                    <button
                      key={f.id}
                      onClick={() => setVerificationFilter(f.id)}
                      className={`shrink-0 px-2 py-1 rounded font-medium transition-colors ${
                        active ? 'bg-amari-charcoal text-white' : 'bg-white border border-amari-border text-amari-charcoal hover:bg-amari-light-sand/30'
                      }`}
                    >
                      {f.label} <span className="opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>

              {verificationFilter === 'review' && (
                <p className="text-[11px] text-amari-text-muted mb-2 px-1">
                  These contacts aren't in Garrett's sheet and haven't been manually verified. Review the data, then mark verified.
                </p>
              )}

              {/* Category chips */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
                {CATEGORY_FILTERS.map((f) => {
                  const active = categoryFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setCategoryFilter(f.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        active ? 'bg-amari-charcoal text-white' : 'bg-amari-light-sand text-amari-charcoal hover:bg-amari-light-sand/70'
                      }`}
                    >
                      {f.label}{!isLoading && <span className="ml-1.5 opacity-70">({categoryCount(f.id)})</span>}
                    </button>
                  );
                })}
              </div>

              {/* Channel filter — "which contacts can I reach via X right now" */}
              <div className="flex items-center gap-1.5 mb-2 text-[11px] text-amari-text-muted overflow-x-auto pb-1 -mx-1 px-1">
                <span className="shrink-0">Reachable via:</span>
                {CHANNEL_FILTERS.map((f) => {
                  const active = channelFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setChannelFilter(f.id)}
                      className={`shrink-0 px-2 py-0.5 rounded transition-colors ${
                        active ? 'bg-amari-charcoal text-white' : 'bg-white border border-amari-border text-amari-charcoal hover:bg-amari-light-sand/30'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>

              {/* Sort */}
              <div className="flex items-center gap-1.5 mb-2 text-[11px] text-amari-text-muted overflow-x-auto pb-1 -mx-1 px-1">
                <span className="shrink-0">Sort:</span>
                {(['priority', 'oldest-contact', 'newest-contact', 'least-touched', 'most-touched', 'just-touched'] as SortMode[]).map((m) => {
                  const active = sortMode === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setSortMode(m)}
                      className={`shrink-0 px-2 py-0.5 rounded transition-colors ${
                        active ? 'bg-amari-charcoal text-white' : 'bg-white border border-amari-border text-amari-charcoal hover:bg-amari-light-sand/30'
                      }`}
                    >
                      {SORT_LABEL[m]}
                    </button>
                  );
                })}
              </div>

              {/* In Progress: recency filter */}
              {topStage === 'in-progress' && (
                <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 text-[11px]">
                  <span className="shrink-0 self-center text-amari-text-muted">Last contact:</span>
                  {RECENCY_FILTERS.map((f) => {
                    const active = recencyFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setRecencyFilter(f.id)}
                        className={`shrink-0 px-2 py-1 rounded font-medium transition-colors ${
                          active ? 'bg-amari-accent-warm text-white' : 'bg-white border border-amari-border text-amari-charcoal hover:bg-amari-light-sand/30'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Closed: sub-stage filter */}
              {topStage === 'closed' && (
                <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 text-[11px]">
                  {CLOSED_SUB_FILTERS.map((f) => {
                    const active = closedSubStage === f.id;
                    const count = f.id === 'all'
                      ? (categoryFilter === 'all' ? prospectsAfterVerification.length : categoryCountsInTab[categoryFilter as PartnerCategory] ?? 0)
                      : closedSubCounts[f.id as Exclude<ClosedSubStage, 'all'>] || 0;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setClosedSubStage(f.id)}
                        className={`shrink-0 px-2 py-1 rounded font-medium transition-colors ${
                          active ? 'bg-amari-accent-warm text-white' : 'bg-white border border-amari-border text-amari-charcoal hover:bg-amari-light-sand/30'
                        }`}
                      >
                        {f.label} <span className="opacity-70">({count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
              {error}
            </div>
          )}

          {isLoading && prospects.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-amari-text-muted animate-spin" />
            </div>
          ) : visibleProspects.length === 0 ? (
            <p className="text-sm text-amari-text-muted text-center py-12">
              No prospects match the current filters.
            </p>
          ) : (
            <div className="space-y-1.5">
              {visibleProspects.map((p) =>
                verificationFilter === 'review' && !isReady(p) ? (
                  <ReviewRow
                    key={p.contactId}
                    prospect={p}
                    onTap={() => setOpenContactId(p.contactId)}
                    onMarkVerified={() => handleMarkVerified(p.contactId)}
                  />
                ) : (
                  <ReadyRow
                    key={p.contactId}
                    prospect={p}
                    onTap={() => setOpenContactId(p.contactId)}
                  />
                ),
              )}
            </div>
          )}
        </>
      )}

      {openProspect && (
        <ProspectModal
          prospect={openProspect}
          onClose={() => setOpenContactId(null)}
          onLocalPatch={(patch) => setProspects((prev) => prev.map((p) => p.contactId === openProspect.contactId ? { ...p, ...patch } : p))}
          onOutcomeRecorded={() => { load(); }}
        />
      )}
    </div>
  );
}
