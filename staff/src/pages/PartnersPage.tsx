import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Loader2, ExternalLink, AlertCircle, X, Phone, MessageSquare,
  Mail, StickyNote, Calendar, CalendarCheck, CheckCircle2, Search,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getPartnerProspects, getPartnerActivity, recordPartnerOutcome,
  toggleOutreachVerified, triggerActivityRefresh, ApiError,
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
];

const CATEGORY_BADGE: Record<PartnerCategory, string> = {
  golf: 'bg-emerald-100 text-emerald-900',
  tennis: 'bg-amber-100 text-amber-900',
  trainer: 'bg-sky-100 text-sky-900',
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

const SIGNAL_LABEL: Record<PartnerLastSignal, string> = {
  'no-answer': 'No answer',
  'voicemail': 'Voicemail',
  'talked': 'Talked',
  'link-sent': 'Sent link',
  'booked': 'Booked',
  'deferred': 'Future potential',
  'not-interested': 'Not interested',
};

// Note: 'link-sent' intentionally NOT a manual button — sending the partner
// session link happens via GHL/staff-app send-link button, which already
// records an outbound message. The enum value still exists (some migrated
// contacts have it set from sheet status) but Garrett doesn't pick it
// manually. Future: auto-detect link-sent by scanning outbound messages
// for the partner-booking-link URL.
const OUTCOME_BUTTONS: { id: PartnerLastSignal; label: string }[] = [
  { id: 'voicemail', label: 'Voicemail' },
  { id: 'talked', label: 'Talked' },
  { id: 'booked', label: 'Booked' },
  { id: 'deferred', label: 'Future potential' },
  { id: 'not-interested', label: 'Not interested' },
];

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
  const adjust = noPhonePenalty + verifiedBoost;

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
  const dSince = daysSince(prospect.lastActivityAt);
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

  return (
    <button
      onClick={onTap}
      className="w-full text-left bg-white rounded-md border border-amari-border p-3 shadow-sm hover:bg-amari-light-sand/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium text-amari-charcoal truncate">
          {displayName(prospect.fullName)}
        </p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${CATEGORY_BADGE[prospect.category]}`}>
          {prospect.category === 'trainer' ? 'PT' : prospect.category}
        </span>
      </div>
      {prospect.phone ? (
        <p className="text-xs text-amari-charcoal mt-0.5">{prospect.phone}</p>
      ) : (
        <p className="text-xs text-amari-text-muted italic mt-0.5">
          {prospect.email ? `email only: ${prospect.email}` : prospect.instagram ? `IG only: ${prospect.instagram}` : 'no contact info'}
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
      <div className="flex items-center gap-2 mt-2" onClick={stopProp}>
        <button
          onClick={handleVerify}
          disabled={submitting}
          className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? '...' : '✓ Mark verified'}
        </button>
        <span className="text-[11px] text-amari-text-muted">— moves to Ready view</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — full detail + actions

function ProspectModal({
  prospect,
  onClose,
  onOutcomeRecorded,
}: {
  prospect: PartnerProspect;
  onClose: () => void;
  onOutcomeRecorded: (signal: PartnerLastSignal) => void;
}) {
  const [activity, setActivity] = useState<PartnerActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);
  const [outcomeError, setOutcomeError] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [pendingDeferred, setPendingDeferred] = useState(false);

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
    setOutcomeSubmitting(true);
    setOutcomeError('');
    try {
      await recordPartnerOutcome({
        contactId: prospect.contactId,
        signal,
        note: outcomeNote.trim() || undefined,
        followupAt: signal === 'deferred' ? followupDate : undefined,
      });
      onOutcomeRecorded(signal);
      onClose();
    } catch (err) {
      setOutcomeError(err instanceof Error ? err.message : 'Failed to record outcome');
    } finally {
      setOutcomeSubmitting(false);
    }
  };

  const stage = (prospect.partnerStage || 'no-outreach') as PartnerStage;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-amari-bone-white w-full sm:max-w-2xl sm:rounded-lg shadow-xl my-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-amari-bone-white z-10 flex items-center justify-between border-b border-amari-border px-4 py-3">
          <div>
            <h2 className="text-lg font-serif text-amari-charcoal">{displayName(prospect.fullName)}</h2>
            <p className="text-xs text-amari-text-muted">
              {prospect.category === 'trainer' ? 'Personal Trainer' : prospect.category} · {STAGE_LABEL[stage]}
              {prospect.partnerSource && ` · ${prospect.partnerSource}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-amari-light-sand rounded">
            <X className="w-5 h-5 text-amari-charcoal" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Contact */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Contact</h3>
            <dl className="text-sm space-y-0.5">
              {prospect.phone && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Phone</dt><dd className="text-amari-charcoal">{prospect.phone}</dd></div>
              )}
              {prospect.email && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Email</dt><dd className="text-amari-charcoal break-all">{prospect.email}</dd></div>
              )}
              {prospect.website && (
                <div className="flex gap-2">
                  <dt className="text-amari-text-muted w-24 shrink-0">Website</dt>
                  <dd>
                    <a href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                      {prospect.website} <ExternalLink className="w-3 h-3" />
                    </a>
                  </dd>
                </div>
              )}
              {prospect.instagram && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">IG</dt><dd className="text-amari-charcoal">@{prospect.instagram.replace(/^@/, '')}</dd></div>
              )}
              {prospect.partnerFacility && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Facility</dt><dd className="text-amari-charcoal">{displayName(prospect.partnerFacility)}</dd></div>
              )}
              {prospect.partnerFacilityType && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Facility type</dt><dd className="text-amari-charcoal">{prospect.partnerFacilityType}</dd></div>
              )}
              {prospect.partnerFacilityRole && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Role</dt><dd className="text-amari-charcoal">{prospect.partnerFacilityRole}</dd></div>
              )}
              {prospect.hasPtOnStaff && prospect.hasPtOnStaff !== 'Unknown' && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">PT on staff</dt><dd className="text-amari-charcoal">{prospect.hasPtOnStaff}</dd></div>
              )}
              <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Touches</dt><dd className="text-amari-charcoal">{prospect.touchCount} {prospect.touchCount === 1 ? 'outreach action' : 'outreach actions'}</dd></div>
            </dl>
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

            <p className="text-[11px] uppercase tracking-wide text-amari-text-muted mt-2 mb-1.5">Record outcome</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {OUTCOME_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleOutcome(b.id)}
                  disabled={outcomeSubmitting}
                  className="px-3 py-1.5 rounded text-xs font-medium border border-amari-border text-amari-charcoal bg-white hover:bg-amari-light-sand disabled:opacity-50"
                >
                  {b.label}
                </button>
              ))}
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
                  disabled={!followupDate || outcomeSubmitting}
                  className="text-xs px-2 py-1 rounded bg-amari-charcoal text-white disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            )}
            <input
              type="text"
              placeholder="Optional note about this outcome..."
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              className="w-full text-xs border border-amari-border rounded px-2 py-1.5"
            />
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

function FocusContactCard({ prospect }: { prospect: PartnerProspect }) {
  const [enrichmentNote, setEnrichmentNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setEnrichmentNote(null);
    setLoading(true);
    (async () => {
      try {
        const data = await getPartnerActivity(prospect.contactId);
        if (cancelled) return;
        const note = data.events.find(
          (e) => e.type === 'note' && (e.body || '').trim().startsWith('Enrichment'),
        );
        if (note) setEnrichmentNote((note.body || '').replace(/^Enrichment[^:]*:\s*/, ''));
      } catch {
        // Enrichment is nice-to-have — silent failure is OK
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prospect.contactId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-serif text-amari-charcoal">{displayName(prospect.fullName)}</h2>
        <p className="text-sm text-amari-text-muted mt-0.5">
          {prospect.category === 'trainer' ? 'Personal Trainer' : prospect.category}
          {prospect.partnerSource && ` · ${prospect.partnerSource}`}
        </p>
      </div>

      {prospect.phone && (
        <a
          href={`tel:${prospect.phone}`}
          className="block text-2xl font-medium text-amari-accent-warm hover:underline"
        >
          {prospect.phone}
        </a>
      )}

      {/* Business info — facility, role, has-PT, website */}
      {(prospect.partnerFacility || prospect.partnerFacilityRole || prospect.hasPtOnStaff === 'Yes' || prospect.hasPtOnStaff === 'No' || prospect.website) && (
        <p className="text-sm text-amari-charcoal">
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
          {prospect.website && (
            <a href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
               target="_blank" rel="noopener noreferrer"
               className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
              {hostnameOf(prospect.website)} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </p>
      )}

      {/* Sheet data — Garrett's curated context */}
      {(prospect.sheetStatus || prospect.sheetNotes) && (
        <div>
          {prospect.sheetStatus && (
            <p className="text-sm text-amari-charcoal font-medium">📋 {prospect.sheetStatus}</p>
          )}
          {prospect.sheetNotes && (
            <p className="text-sm italic text-amari-text-secondary mt-1">"{prospect.sheetNotes}"</p>
          )}
        </div>
      )}

      {/* Enrichment summary — THE pitch hook */}
      <div className="bg-amari-light-sand rounded p-4">
        <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-2">Pitch context</h3>
        {loading ? (
          <p className="text-sm text-amari-text-muted flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading enrichment...
          </p>
        ) : enrichmentNote ? (
          <p className="text-sm text-amari-charcoal whitespace-pre-wrap leading-relaxed">{enrichmentNote}</p>
        ) : (
          <p className="text-sm text-amari-text-muted italic">No enrichment recorded. Wing it from the sheet data above.</p>
        )}
      </div>

      {/* Touch history */}
      <p className="text-xs text-amari-text-muted">
        {prospect.touchCount > 0
          ? `${prospect.touchCount} touch${prospect.touchCount === 1 ? '' : 'es'} so far`
          : 'Never touched before'}
        {prospect.partnerLastSignal && ` · last: ${SIGNAL_LABEL[prospect.partnerLastSignal]}`}
        {prospect.lastActivityAt && ` · ${relativeDays(prospect.lastActivityAt)}`}
      </p>
    </div>
  );
}

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
  const [outcomeNote, setOutcomeNote] = useState('');
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);
  const [outcomeError, setOutcomeError] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [pendingDeferred, setPendingDeferred] = useState(false);

  const done = index >= queue.length;
  const prospect = done ? null : queue[index];

  const advance = () => {
    setIndex((i) => i + 1);
    setOutcomeNote('');
    setFollowupDate('');
    setPendingDeferred(false);
    setOutcomeError('');
  };

  const handleOutcome = async (signal: PartnerLastSignal) => {
    if (!prospect) return;
    if (signal === 'deferred' && !followupDate) {
      setPendingDeferred(true);
      return;
    }
    setOutcomeSubmitting(true);
    setOutcomeError('');
    try {
      await recordPartnerOutcome({
        contactId: prospect.contactId,
        signal,
        note: outcomeNote.trim() || undefined,
        followupAt: signal === 'deferred' ? followupDate : undefined,
      });
      // Optimistic local update so the browse view reflects it after exit
      onProspectUpdated(prospect.contactId, {
        partnerLastSignal: signal,
        partnerLastSignalAt: new Date().toISOString(),
        touchCount: (prospect.touchCount ?? 0) + 1,
      });
      setCompletedCount((c) => c + 1);
      advance();
    } catch (err) {
      setOutcomeError(err instanceof Error ? err.message : 'Failed to record outcome');
    } finally {
      setOutcomeSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-amari-bone-white z-[70] flex flex-col">
      {/* Top bar — progress + skip + exit */}
      <div className="border-b border-amari-border px-4 py-3 flex items-center justify-between bg-white">
        <div>
          <p className="text-sm font-medium text-amari-charcoal">
            {done ? 'Done!' : `${index + 1} of ${queue.length}`}
          </p>
          <p className="text-[11px] text-amari-text-muted">
            {completedCount} recorded · {Math.max(0, queue.length - index)} left
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!done && (
            <button
              onClick={advance}
              className="text-xs text-amari-text-muted hover:text-amari-charcoal px-2 py-1.5"
            >
              Skip →
            </button>
          )}
          <button
            onClick={onExit}
            className="p-1.5 text-amari-charcoal hover:bg-amari-light-sand rounded"
            aria-label="Exit focus mode"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {done ? (
        /* Celebration / done screen */
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
      ) : (
        <>
          {/* Scrollable contact area */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="max-w-2xl mx-auto">
              {prospect && <FocusContactCard prospect={prospect} />}
            </div>
          </div>

          {/* Outcome capture — note + buttons grouped together so the row doesn't read as orphaned */}
          <div className="border-t border-amari-border bg-white px-3 py-3 safe-area-bottom max-w-2xl mx-auto w-full">
            <p className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5 px-0.5">
              What happened on this call?
            </p>
            <input
              type="text"
              placeholder="Note (optional)"
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              className="w-full text-sm border border-amari-border rounded px-3 py-2 mb-2"
            />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {OUTCOME_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleOutcome(b.id)}
                  disabled={outcomeSubmitting}
                  className="shrink-0 px-3.5 py-2.5 rounded text-sm font-medium border border-amari-border text-amari-charcoal bg-white hover:bg-amari-light-sand disabled:opacity-50"
                >
                  {b.label}
                </button>
              ))}
            </div>
            {pendingDeferred && (
              <div className="bg-amari-light-sand rounded p-3 mt-2">
                <label className="text-xs text-amari-charcoal block mb-1">When should we revisit?</label>
                <input
                  type="date"
                  value={followupDate}
                  onChange={(e) => setFollowupDate(e.target.value)}
                  className="text-xs border border-amari-border rounded px-2 py-1 mr-2"
                />
                <button
                  onClick={() => handleOutcome('deferred')}
                  disabled={!followupDate || outcomeSubmitting}
                  className="text-xs px-2 py-1 rounded bg-amari-charcoal text-white disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            )}
            {outcomeError && (
              <p className="text-xs text-red-700 mt-2">{outcomeError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page

type SortMode = 'priority' | 'oldest-contact' | 'newest-contact' | 'least-touched' | 'most-touched' | 'just-touched';

const SORT_LABEL: Record<SortMode, string> = {
  'priority': 'Priority',
  'oldest-contact': 'Oldest contact',
  'newest-contact': 'Newest contact',
  'least-touched': 'Fewest touches',
  'most-touched': 'Most touches',
  'just-touched': 'Just touched',
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
        p.email, p.website, p.instagram,
        p.partnerFacility, p.partnerFacilityType, p.partnerFacilityRole,
        p.sheetStatus, p.sheetNotes, p.sheetInstagram,
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
    const counts: Record<PartnerCategory, number> = { golf: 0, tennis: 0, trainer: 0, unknown: 0 };
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
    if (topStage === 'closed' && closedSubStage !== 'all') {
      v = v.filter((p) => (p.partnerStage || 'no-outreach') === closedSubStage);
    }
    if (topStage === 'in-progress' && recencyFilter !== 'all') {
      const threshold = Number(recencyFilter);
      v = v.filter((p) => {
        const d = daysSince(p.lastActivityAt);
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
      const pa = priorityScore(a);
      const pb = priorityScore(b);
      if (pa !== pb) return pb - pa;
      const da = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const db = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return da - db;
    });
  }, [prospectsAfterVerification, topStage, categoryFilter, closedSubStage, recencyFilter, sortMode]);

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
          onOutcomeRecorded={() => { load(); }}
        />
      )}
    </div>
  );
}
