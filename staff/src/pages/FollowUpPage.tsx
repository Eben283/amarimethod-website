import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw, Loader2, ExternalLink, AlertCircle, Phone, MessageSquare,
  Voicemail, CheckCircle2, Clock, MoonStar, Ban, ChevronDown, ChevronUp,
  Mail, StickyNote, Calendar, Globe, Reply, Send, Sparkles, Search, Pencil, Check, X,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getPartnerProspects, getConversations, getPartnerActivity,
  recordPartnerOutcome, addNote, buildFollowupBrief, updateContactField, getCallCoach,
  getOutreachCoach, sendFollowupText, sendFollowupEmail, ApiError,
  type FollowupBrief, type EditableFieldKey, type CallCoach, type OutreachCoach,
} from '../lib/api';
import { suggestedTexts } from '../lib/followupCopy';
import type {
  PartnerProspect, PartnerLastSignal, PartnerActivityEvent, ConversationSummary,
} from '../types/staff';

// ── FOLLOW-UP / COMMUNICATION SURFACE ─────────────────────────────────────────
// The single place for "who do I need to communicate with, and what's the next
// move" — prospects AND clients. Replaces Outreach + Messages. A ranked worklist,
// not a database to filter; full detail one tap away. See the spec:
// ops/drafts/followup-comms-surface-spec.md (in the amari-method-docs repo).
//
// Ranking (top → bottom): unanswered inbound replies → hot momentum → timed
// follow-ups due → scheduled returns → end-of-rope decision. Everything else is
// Waiting (cooling off, counted) or Set Aside (parked, reversible).
//
// GHL is the only sender — this page records outcomes + deep-links to the GHL
// thread to actually call/text. It sends no messages itself.
//
// Still placeholder (edit later): per-stage copy-paste variations (Garrett's
// words), auto-emails (GHL workflows, fix-advisor first), inline field editing,
// Garrett's real cadence intervals, full IA promotion to primary nav.

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

// Cadence thresholds + the frequency boost moved SERVER-SIDE (functions/api/
// staff-partner-prospects.js) so the Act-Now decision lives in one place. The UI
// no longer computes it — it reads `p.derived`. (Was duplicated here; removed
// 2026-06-14 to kill the two-copies drift.)

// Daily proactive worklist size. Target ~15 calls/day; 30 gives Garrett options
// without surfacing the whole backlog (hundreds) as an overwhelming wall.
const ACT_NOW_CAP = 30;

const SNOOZE_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '7', label: '1 week' },
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
];
const SETASIDE_OPTIONS = [
  { value: 'not-a-fit', label: 'Not a fit' },
  { value: 'not-interested', label: 'Not interested' },
  { value: 'talked-in-person', label: 'Talked in person' },
  { value: 'save-for-later', label: 'Save for later (other campaign)' },
];
// Maps a set-aside reason → the outcome it records. Every reason keeps the
// contact (never deletes); the note preserves WHY for the audit/Set-Aside view.
const SETASIDE_OPTS: Record<string, { signal: PartnerLastSignal; note?: string; days?: number }> = {
  'not-a-fit':        { signal: 'skip', note: 'Not a fit' },
  'not-interested':   { signal: 'not-interested' },
  'talked-in-person': { signal: 'skip', note: 'Talked in person — not pursuing' },
  'save-for-later':   { signal: 'deferred', days: 90, note: 'Saved for a different campaign' },
};
// Signals that record an actual touch (bump last-signal + timer). skip / note /
// deferred change stage/schedule but aren't "touches".
const TOUCH_LIKE = new Set<PartnerLastSignal>(['no-answer', 'voicemail', 'talked', 'link-sent', 'linkedin-msg', 'linkedin-req', 'instagram-msg', 'in-person']);

// "Sent link" dropdown — records WHICH link Garrett sent (no send happens). The
// note lands in the activity timeline so the coach knows what's gone out.
const LINK_SENT_OPTIONS = [
  { value: 'partnership-session', label: 'Partnership Session Link' },
  { value: 'partnership-toolkit', label: 'Partnership Toolkit' },
];
const LINK_SENT_LABEL: Record<string, string> = {
  'partnership-session': 'Partnership Session Link',
  'partnership-toolkit': 'Partnership Toolkit',
};
// Off-platform touches bundled into one dropdown. value === the outcome signal.
const OTHER_CHANNEL_OPTIONS = [
  { value: 'linkedin-msg', label: 'LinkedIn DM' },
  { value: 'linkedin-req', label: 'LinkedIn connect' },
  { value: 'instagram-msg', label: 'Instagram DM' },
  { value: 'in-person', label: 'In-person' },
];

type RowKind = 'act' | 'waiting' | 'aside' | 'converted';
type ActionKind = 'call' | 'text' | 'email' | 'reback' | 'decide';

interface Derived {
  kind: RowKind;
  urgency: number;
  why: string;
  action: ActionKind | null;
  asideReason?: string;
  // Engagement tier from the server (2=replied/talked, 1=we reached out, 0=never
  // touched). A small bonus lets an engaged contact edge out a same-urgency one we
  // only one-way-touched. Optional for back-compat with cards generated pre-2026-06-17.
  warmth?: number;
}

// ── Day-of-week outreach weighting ──────────────────────────────────────────
// Calls & texts land differently by weekday — reach people when they're both
// reachable AND not annoyed to hear from you. Email is low-intrusion, so it is
// NEVER weighted; only 'call'/'text' actions shift. Each number is an urgency
// delta (urgencies run ~38–92): + floats a row up today, − lets it wait for a
// better day. Tune any cell freely. dow: 0=Sun … 6=Sat.
type OutreachType = 'phys' | 'talk' | 'trainer' | 'golf' | 'tennis' | 'business' | 'other';

const DAY_WEIGHTS: Record<number, { all?: number } & Partial<Record<OutreachType, number>>> = {
  0: { all: -50 },                                                              // Sun — email day; calls/texts rest
  1: { golf: 15, tennis: 15, business: 10 },                                    // Mon — golf/tennis off; business plans week
  2: {}, 3: {}, 4: {},                                                          // Tue–Thu — core window, neutral
  5: { trainer: 5, phys: 5, talk: -10, business: -10, golf: -10, tennis: -10 }, // Fri — clinical/desk folks winding down
  6: { phys: 20, trainer: 5, talk: -30, business: -30, golf: -30, tennis: -30 },// Sat — PTs/gyms open; therapists/business off; golf/tennis slammed
};

function outreachType(p: PartnerProspect): OutreachType {
  if (p.partnerFacilityRole === 'Physical Therapist') return 'phys';
  switch (p.category) {
    case 'therapist': return 'talk';
    case 'trainer': return 'trainer';
    case 'golf': return 'golf';
    case 'tennis': return 'tennis';
    case 'business': return 'business';
    default: return 'other';
  }
}

// Urgency delta for a row given today's weekday. Only calls/texts are weighted.
function dayWeight(action: ActionKind | null, p: PartnerProspect, dow: number): number {
  if (action !== 'call' && action !== 'text') return 0;
  const w = DAY_WEIGHTS[dow] || {};
  return (w.all ?? 0) + (w[outreachType(p)] ?? 0);
}

// Short, friendly hint for a row the weekday moved (null = no hint).
function dayHint(delta: number, dow: number): string | null {
  if (delta <= -40) return dow === 0 ? 'Email day — this call/text can wait' : 'Better another day';
  if (delta <= -20) return 'Not the best day for this one';
  if (delta >= 15) return 'Good day to reach this one';
  return null;
}

// One-line "why today looks like this" for the date bar.
function dayBanner(dow: number): string {
  switch (dow) {
    case 0: return 'Email day — calls & texts can wait till tomorrow';
    case 1: return 'Golf & tennis pros are reachable today (their day off)';
    case 5: return 'Trainers & physical therapists good · desk/clinical folks winding down';
    case 6: return 'Good for physical therapists · talk therapists & desk folks can wait';
    default: return 'Core outreach day — everyone in range';
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function lastTouchAt(p: PartnerProspect): string | null {
  const a = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : null;
  const b = p.partnerLastSignalAt ? new Date(p.partnerLastSignalAt).getTime() : null;
  if (a === null && b === null) return null;
  return new Date(Math.max(a ?? 0, b ?? 0)).toISOString();
}

function friendlyDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function displayName(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.trim();
  if (!t) return '';
  if (/[A-Z]/.test(t)) return t;
  return t.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function ago(d: number | null): string {
  if (d === null) return 'never';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

// Not every inbound message needs a reply. "Thanks", "we'll be in touch", 👍 are
// conversation-closers — terminal, no action. GHL flags any inbound-last message
// as needs-reply, so we filter closers out of the urgent tier. Imperfect on
// purpose — backed by a one-tap "No reply needed" on each row. (The old Messages
// tab is gone, so a real QUESTION is never suppressed — here or in the dropped-skip
// below — via QUESTION_RE.)
const CLOSER_RE = /\b(thank you|thanks|thx|ty|appreciate it|much appreciated|sounds good|sounds great|will do|we'?ll be in touch|be in touch|likewise|same to you|talk soon|see you|see ya|no worries|got it|perfect|great|awesome|wonderful)\b/i;
const QUESTION_RE = /\?|\b(can|could|would|when|what|where|how|why|which|do you|are you|is there|reschedul|cancel|change|price|cost|available|book|question)\b/i;
function isCloser(text: string | null | undefined): boolean {
  if (!text) return false;           // empty (e.g. an inbound call/MMS, no body) — surface it, never silently suppress
  const t = text.trim();
  if (!t) return false;
  if (t.length > 80) return false;   // long messages probably say something
  if (QUESTION_RE.test(t)) return false; // a question always needs a reply
  return CLOSER_RE.test(t);
}

// The Act Now decision now lives in ONE place: the server (functions/api/
// staff-partner-prospects.js → deriveActNow), returned per prospect as `p.derived`.
// The UI just reads it (see the `derived` useMemo). This avoids the old two-copies
// drift. If the server ever omits it, we fall back to a safe "waiting" (no action).
const DERIVED_FALLBACK: Derived = { kind: 'waiting', urgency: 0, why: '', action: null };

// Unified worklist item: an unanswered reply OR a prospect needing a touch.
type ReplyItem = { kind: 'reply'; conv: ConversationSummary; isClient: boolean };
type ProspectItem = { kind: 'prospect'; p: PartnerProspect; d: Derived; weight?: number; hint?: string | null };
type ActItem = ReplyItem | ProspectItem;

const URGENCY_DOT: Record<ActionKind, string> = {
  reback: 'bg-amari-accent-warm', call: 'bg-emerald-500', text: 'bg-amari-accent-warm', email: 'bg-sky-500', decide: 'bg-amber-500',
};
const ACTION_LABEL: Record<ActionKind, string> = {
  reback: 'Re-reach', call: 'Call', text: 'Text', email: 'Email', decide: 'Decide',
};

const ACTIVITY_ICON: Record<PartnerActivityEvent['type'], typeof Phone> = {
  call: Phone, sms: MessageSquare, email: Mail, signal: CheckCircle2, note: StickyNote, appointment: Calendar,
};

export default function FollowUpPage() {
  const { logout } = useAuth();
  const [prospects, setProspects] = useState<PartnerProspect[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'act' | 'aside'>('act');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, PartnerActivityEvent[] | 'loading' | 'error'>>({});
  const [noteDraft, setNoteDraft] = useState('');
  const [dismissedReplies, setDismissedReplies] = useState<Set<string>>(new Set()); // session-only "no reply needed"
  // Session-only "I just handled this person" — a send or an outcome action drops
  // them from Act Now immediately, so you don't see ghosts of people you've worked
  // until the cadence snapshot catches up (≤3h). Cleared on reload.
  const [handledIds, setHandledIds] = useState<Set<string>>(new Set());
  const markHandled = useCallback((id: string) => setHandledIds((s) => { const n = new Set(s); n.add(id); return n; }), []);
  const [query, setQuery] = useState('');
  const [showRubric, setShowRubric] = useState(false);
  const [coachDataAt, setCoachDataAt] = useState<string | null>(null); // freshness stamp

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prospectsRes, convoRes] = await Promise.all([
        getPartnerProspects(),
        getConversations('needs_reply').catch(() => ({ conversations: [] as ConversationSummary[] })),
      ]);
      setProspects(prospectsRes.prospects);
      setCoachDataAt(prospectsRes.coachDataAt ?? null);
      setConversations((convoRes as { conversations: ConversationSummary[] }).conversations || []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  const prospectMap = useMemo(
    () => new Map(prospects.map((p) => [p.contactId, p])),
    [prospects],
  );

  // Prefer the SERVER-computed Act-Now decision (engine-merge 2026-06-14) so the
  // UI and the coach pipeline share ONE due-decision. Falls back to the local
  // derive() if the server didn't send one (rollout-safe).
  const derived = useMemo(
    () => prospects.map((p) => ({ p, d: (p.derived as Derived | undefined) ?? DERIVED_FALLBACK })),
    [prospects],
  );

  // 1) Unanswered replies — always top. (Messages folded in.)
  const replyItems = useMemo<ReplyItem[]>(() => {
    return conversations
      .filter((c) => {
        if (!c.needsReply || isCloser(c.lastMessagePreview) || dismissedReplies.has(c.contactId) || handledIds.has(c.contactId)) return false;
        // Honor a PERSISTED disposition. A reply from someone you've already set
        // aside (not-a-fit / snoozed / future-potential) or who's already booked
        // shouldn't keep topping Act Now on a courtesy line ("Im good.").
        // Reuse the app's OWN decision (derived.kind, which already folds in every
        // aside/booked case) instead of a partial stage list — the old
        // dropped/not-interested-only check missed snoozed, so a deferred contact
        // kept resurfacing (the Steve Grubbs bug, 2026-06-17).
        const pp = prospectMap.get(c.contactId);
        const ppKind = (pp?.derived as Derived | undefined)?.kind;
        // ...UNLESS they sent a real question — a set-aside contact who re-engages
        // with a genuine ask must still surface (the only reply surface now; the
        // Messages tab is gone, so suppressing it = silent permanent loss).
        if (pp && (ppKind === 'aside' || ppKind === 'converted') && !QUESTION_RE.test(c.lastMessagePreview || '')) return false;
        return true;
      })
      .sort((a, b) => new Date(b.lastMessageDate ?? 0).getTime() - new Date(a.lastMessageDate ?? 0).getTime())
      .map((conv) => ({
        kind: 'reply' as const,
        conv,
        // A non-prospect who messaged is treated as a client; partners are clients too.
        isClient: prospectMap.get(conv.contactId)?.isActivePartner ?? !prospectMap.has(conv.contactId),
      }));
  }, [conversations, prospectMap, dismissedReplies, handledIds]);

  // Today's weekday drives the call/text weighting + the date bar. 0=Sun … 6=Sat.
  const todayDow = useMemo(() => new Date().getDay(), []);
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    [],
  );

  // 2) Prospects needing a touch — minus anyone already surfaced as a reply.
  //    Ranked by urgency PLUS today's day-of-week weight, so calls/texts that
  //    don't suit the day sink and the day-appropriate work floats up. Replies
  //    (above) stay pinned on top regardless.
  const prospectActNow = useMemo<ProspectItem[]>(() => {
    const replyIds = new Set(replyItems.map((r) => r.conv.contactId));
    // Engagement bonus: a contact who actually replied/talked (warmth 2) edges out a
    // same-urgency one we only one-way-touched (warmth 1), and a never-touched new
    // lead (warmth 0) sits a touch lower. Small on purpose — it breaks near-ties, it
    // never jumps a real urgency gap (so a due one-touch still beats a cooling warm one).
    const warmthBonus = (w?: number) => (w === 2 ? 10 : w === 0 ? -5 : 0);
    const score = (d: Derived, weight: number) => d.urgency + weight + warmthBonus(d.warmth);
    return derived
      .filter((r) => r.d.kind === 'act' && !replyIds.has(r.p.contactId) && !handledIds.has(r.p.contactId))
      .map((r) => {
        const weight = dayWeight(r.d.action, r.p, todayDow);
        return { kind: 'prospect' as const, p: r.p, d: r.d, weight, hint: dayHint(weight, todayDow) };
      })
      .sort((a, b) => score(b.d, b.weight ?? 0) - score(a.d, a.weight ?? 0))
      // Cap the proactive list at a day's worth. Target is ~15 calls/day; 30 gives
      // options without the full backlog (hundreds) becoming a wall. Replies are
      // pinned above this and never capped. The rest stays in the data, not the screen.
      .slice(0, ACT_NOW_CAP);
  }, [derived, replyItems, todayDow, handledIds]);

  const actItems = useMemo<ActItem[]>(() => [...replyItems, ...prospectActNow], [replyItems, prospectActNow]);
  const setAside = useMemo(() => derived.filter((r) => r.d.kind === 'aside'), [derived]);

  const counts = useMemo(() => ({
    replies: replyItems.length,
    act: prospectActNow.length,
    waiting: derived.filter((r) => r.d.kind === 'waiting').length,
    aside: setAside.length,
    converted: derived.filter((r) => r.d.kind === 'converted').length,
    total: derived.length,
  }), [replyItems, prospectActNow, derived, setAside]);

  // Search across ALL prospects (any bucket), like the Outreach search.
  const searchItems = useMemo<ProspectItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return derived
      .filter(({ p }) => [p.fullName, p.partnerFacility, p.category, p.companyName, p.city, p.email, p.phone]
        .some((v) => v && String(v).toLowerCase().includes(q)))
      .map((r) => ({ kind: 'prospect' as const, p: r.p, d: r.d }));
  }, [derived, query]);

  const toggleExpand = useCallback((contactId: string) => {
    setExpandedId((cur) => (cur === contactId ? null : contactId));
    setNoteDraft('');
    if (!activity[contactId]) {
      setActivity((a) => ({ ...a, [contactId]: 'loading' }));
      getPartnerActivity(contactId)
        .then((res) => setActivity((a) => ({ ...a, [contactId]: res.events })))
        .catch(() => setActivity((a) => ({ ...a, [contactId]: 'error' })));
    }
  }, [activity]);

  const onOutcome = useCallback(async (
    contactId: string,
    signal: PartnerLastSignal,
    opts?: { days?: number; note?: string },
  ) => {
    setBusyId(contactId);
    try {
      const followupAt = opts?.days != null
        ? new Date(Date.now() + opts.days * 86_400_000).toISOString()
        : undefined;
      const res = await recordPartnerOutcome({ contactId, signal, note: opts?.note, followupAt });
      // Optimistic local update from the authoritative result — do NOT refetch
      // here: GHL's /contacts/search index lags a write by a few seconds, so a
      // reload would briefly drop the just-changed contact (the "disappeared"
      // bug). The row recomputes its bucket instantly from this update instead.
      setProspects((ps) => ps.map((p) => {
        if (p.contactId !== contactId) return p;
        return {
          ...p,
          partnerStage: res.newStage ?? p.partnerStage,
          partnerFollowupAt: res.followupAt ?? p.partnerFollowupAt,
          ...(TOUCH_LIKE.has(signal) ? { partnerLastSignal: res.signal, partnerLastSignalAt: res.signalAt } : {}),
        };
      }));
      markHandled(contactId); // you acted → drop the card now, don't wait for the cadence refresh
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to record');
    } finally {
      setBusyId(null);
    }
  }, [logout, markHandled]);

  const onDismissReply = useCallback((contactId: string) => {
    setDismissedReplies((s) => { const next = new Set(s); next.add(contactId); return next; });
  }, []);

  const onSaveNote = useCallback(async (contactId: string) => {
    const text = noteDraft.trim();
    if (!text) return;
    setBusyId(contactId);
    try {
      await addNote(contactId, text);
      setNoteDraft('');
      setActivity((a) => { const next = { ...a }; delete next[contactId]; return next; });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setBusyId(null);
    }
  }, [noteDraft, logout]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-amari-charcoal">Follow-Up</h1>
          <p className="text-xs text-amari-text-muted">
            {counts.replies} to reply · {counts.act} to reach out · {counts.waiting} cooling off · {counts.total} in the funnel
          </p>
        </div>
        <button
          type="button" onClick={load} disabled={loading}
          className="rounded-lg border border-amari-border p-2 text-amari-text-muted hover:bg-amari-light-sand disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Date bar — today + how the weekday is weighting calls/texts. The list
          below reorders by this; nothing is blocked. */}
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-amari-border bg-amari-light-sand/60 px-3 py-2 text-xs">
        <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-amari-accent-warm" />
        <p className="text-amari-charcoal">
          <span className="font-semibold">{todayLabel}</span>
          <span className="text-amari-text-muted"> · {dayBanner(todayDow)}</span>
        </p>
      </div>

      {/* Freshness — loud if the coach pipeline stalled, so stale-but-plausible data
          doesn't pass as current. Only fires when the stamp is genuinely old (>12h). */}
      {coachDataAt && (Date.now() - new Date(coachDataAt).getTime() > 12 * 60 * 60 * 1000) && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Heads up — the coach data last refreshed {relTime(coachDataAt)}. The background refresh may have stalled, so who's booked or set aside could be out of date.
        </div>
      )}

      {/* search — find anyone across all buckets (same idea as Outreach) */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amari-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everyone…"
          className="w-full rounded-xl border border-amari-border py-2 pl-9 pr-9 text-sm text-amari-charcoal placeholder:text-amari-text-muted focus:outline-none focus:ring-1 focus:ring-amari-accent-warm"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-amari-text-muted hover:bg-amari-light-sand hover:text-amari-charcoal"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {query.trim() ? (
        searchItems.length === 0 ? (
          <Empty icon={Search} title="No matches" sub={`Nobody matches "${query.trim()}".`} />
        ) : (
          <div className="space-y-2">
            {searchItems.map((item) => (
              <ActRow
                key={`s-${item.p.contactId}`}
                item={item}
                expanded={expandedId === item.p.contactId}
                activity={activity[item.p.contactId]}
                busy={busyId === item.p.contactId}
                noteDraft={expandedId === item.p.contactId ? noteDraft : ''}
                onToggle={() => toggleExpand(item.p.contactId)}
                onOutcome={(sig, opts) => onOutcome(item.p.contactId, sig, opts)}
                onNoteChange={setNoteDraft}
                onSaveNote={() => onSaveNote(item.p.contactId)}
                onDismiss={() => onDismissReply(item.p.contactId)}
                onHandled={() => markHandled(item.p.contactId)}
              />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="mb-2 flex gap-1 rounded-xl bg-amari-light-sand p-1">
            <Tab active={view === 'act'} onClick={() => setView('act')} label={`Act Now (${counts.replies + counts.act})`} icon={Clock} />
            <Tab active={view === 'aside'} onClick={() => setView('aside')} label={`Set Aside (${counts.aside})`} icon={MoonStar} />
          </div>

          <button type="button" onClick={() => setShowRubric((v) => !v)}
            className="mb-3 inline-flex items-center gap-1 text-[11px] text-amari-text-muted hover:text-amari-charcoal">
            {showRubric ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Why this order?
          </button>
          {showRubric && (
            <div className="mb-3 rounded-lg border border-amari-border bg-amari-light-sand/50 p-3 text-xs text-amari-charcoal">
              <p className="mb-1 font-medium">How this list is ordered:</p>
              <ol className="list-decimal space-y-0.5 pl-4 text-amari-text-muted">
                <li>Replies waiting — someone wrote, unanswered</li>
                <li>Hot — just called (→ text) or just talked (→ next step)</li>
                <li>Follow-ups due — voicemail ~3d, link sent ~3d, quiet ~3d</li>
                <li>New leads — not contacted yet</li>
                <li>Out of cadence — decide: keep trying or set aside</li>
              </ol>
              <p className="mt-1 text-amari-text-muted">Hidden until due: cooling-off (just touched) and snoozed.</p>
              <p className="mt-1 text-amari-text-muted">Today's weekday nudges calls/texts up or down by who's reachable (see the date bar) — nothing is blocked, just reordered.</p>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-amari-charcoal" /></div>
          ) : view === 'act' ? (
            actItems.length === 0 ? (
              <Empty icon={CheckCircle2} title="Nothing needs you right now" sub="No unanswered messages, no follow-ups due. Nice." />
            ) : (
              <div className="space-y-2">
                {actItems.map((item) => {
                  const contactId = item.kind === 'reply' ? item.conv.contactId : item.p.contactId;
                  return (
                    <ActRow
                      key={`${item.kind}-${contactId}`}
                      item={item}
                      expanded={expandedId === contactId}
                      activity={activity[contactId]}
                      busy={busyId === contactId}
                      noteDraft={expandedId === contactId ? noteDraft : ''}
                      onToggle={() => toggleExpand(contactId)}
                      onOutcome={(sig, opts) => onOutcome(contactId, sig, opts)}
                      onNoteChange={setNoteDraft}
                      onSaveNote={() => onSaveNote(contactId)}
                      onDismiss={() => onDismissReply(contactId)}
                      onHandled={() => markHandled(contactId)}
                    />
                  );
                })}
              </div>
            )
          ) : setAside.length === 0 ? (
            <Empty icon={MoonStar} title="Nothing set aside" sub="Snoozed and not-a-fit leads show up here." />
          ) : (
            <div className="space-y-2">
              {setAside.map(({ p, d }) => (
                <div key={p.contactId} className="flex items-center justify-between rounded-xl border border-amari-border bg-white p-3">
                  <div className="min-w-0">
                    <span className="truncate font-medium text-amari-charcoal">{displayName(p.fullName) || 'Unknown'}</span>
                    <p className="text-[11px] text-amari-text-muted">{d.asideReason}</p>
                  </div>
                  <a href={ghlContactUrl(p.contactId)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand">
                    <ExternalLink className="h-3.5 w-3.5" /> GHL
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── unified row (reply or prospect), expandable ──────────────────────────────
interface ActRowProps {
  item: ActItem;
  expanded: boolean;
  activity: PartnerActivityEvent[] | 'loading' | 'error' | undefined;
  busy: boolean;
  noteDraft: string;
  onToggle: () => void;
  onOutcome: (signal: PartnerLastSignal, opts?: { days?: number; note?: string }) => void;
  onNoteChange: (v: string) => void;
  onSaveNote: () => void;
  onDismiss: () => void;
  onHandled: () => void;
}

function ActRow({ item, expanded, activity, busy, noteDraft, onToggle, onOutcome, onNoteChange, onSaveNote, onDismiss, onHandled }: ActRowProps) {
  const isReply = item.kind === 'reply';
  const contactId = isReply ? item.conv.contactId : item.p.contactId;
  const name = displayName(isReply ? item.conv.contactName : item.p.fullName) || 'Unknown';
  const isClient = isReply ? item.isClient : item.p.isActivePartner;
  const industry = !isReply && item.p.category !== 'unknown' ? item.p.category : '';

  // Fetch the PROACTIVE outreach coach (headline why-now + the editable/sendable
  // drafts) for PROSPECT cards only. Reply cards don't use it — the proactive
  // draft is the wrong message for someone mid-conversation; they answer with the
  // call-coach's in-context Suggested reply instead (CoachPanel below).
  const [coach, setCoach] = useState<OutreachCoach | null | 'loading'>('loading');
  useEffect(() => {
    if (isReply) { setCoach(null); return; }
    let live = true;
    getOutreachCoach(contactId).then((c) => { if (live) setCoach(c); }).catch(() => { if (live) setCoach(null); });
    return () => { live = false; };
  }, [contactId, isReply]);
  const coachWhy = coach && coach !== 'loading' ? coach.whyNow : null;
  // The channel pill MUST match the why-line. The coach record carries both the
  // why-now AND the channel (written together, so they agree) — so when a coach
  // record exists, the pill comes from it, not the older signal-derived action
  // which could disagree (e.g. Dana: coach says "call", derive said "text").
  // Falls back to the derived action for contacts with no coach record.
  const coachChannel = coach && coach !== 'loading' ? coach.channel : null;
  const derivedAction: ActionKind | null = item.kind === 'prospect' ? item.d.action : null;
  const effAction: ActionKind | null = (coachChannel as ActionKind) || derivedAction;

  return (
    <div className={`rounded-xl border bg-white ${isClient ? 'border-l-4 border-l-amari-accent-warm border-amari-border' : 'border-amari-border'}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-2 p-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isReply
              ? <Reply className="h-3.5 w-3.5 shrink-0 text-amari-accent-warm" />
              : effAction && <span className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[effAction]}`} />}
            <span className="truncate font-medium text-amari-charcoal">{name}</span>
            {isClient && <span className="shrink-0 rounded-full bg-amari-accent-warm/15 px-2 py-0.5 text-[11px] text-amari-charcoal">client</span>}
            {industry && <span className="shrink-0 rounded-full bg-amari-light-sand px-2 py-0.5 text-[11px] capitalize text-amari-text-muted">{industry}</span>}
          </div>
          {isReply ? (
            <>
              <p className="mt-1 line-clamp-2 text-sm text-amari-charcoal">{item.conv.lastMessagePreview || 'Sent you a message'}</p>
              <p className="mt-0.5 text-[11px] text-amari-text-muted">Replied {relTime(item.conv.lastMessageDate)} · {item.conv.lastMessageType || 'message'}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-amari-charcoal">{coachWhy || item.d.why}</p>
              {item.kind === 'prospect' && item.hint && (
                <p className="mt-0.5 text-[11px] italic text-amari-text-muted">{item.hint}</p>
              )}
              <p className="mt-0.5 text-[11px] text-amari-text-muted">Last touch: {ago(daysSince(lastTouchAt(item.p)))}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isReply
            ? <span className="rounded-lg bg-amari-accent-warm px-2.5 py-1 text-xs font-medium text-white">Reply</span>
            : effAction && <span className="rounded-lg bg-amari-charcoal px-2.5 py-1 text-xs font-medium text-white">{ACTION_LABEL[effAction]}</span>}
          {expanded ? <ChevronUp className="h-4 w-4 text-amari-text-muted" /> : <ChevronDown className="h-4 w-4 text-amari-text-muted" />}
        </div>
      </button>

      {/* reply quick actions — reply in GHL, or clear it if nothing's needed */}
      {isReply && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          <a href={ghlContactUrl(contactId)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand">
            <ExternalLink className="h-3.5 w-3.5" /> Reply in GHL
          </a>
          <button type="button" onClick={onDismiss}
            className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-text-muted hover:bg-amari-light-sand">
            <CheckCircle2 className="h-3.5 w-3.5" /> No reply needed
          </button>
          {/* Categorize the reply itself — a reply is an interaction to triage too
              (a soft "no" like "Im good" → Not a fit). INTENTIONAL (Eben 2026-06-17):
              do NOT strip these in a future "declutter" pass. These only record an
              outcome; no chip sends a text (the only text sender is the inline field). */}
          <Chip icon={Ban} label="Not a fit" busy={busy} onClick={() => onOutcome('skip', { note: 'Not a fit' })} />
          <ActionSelect icon={X} label="Set aside…" busy={busy} options={SETASIDE_OPTIONS}
            onPick={(v) => { const o = SETASIDE_OPTS[v]; if (o) onOutcome(o.signal, { note: o.note, days: o.days }); }} />
          <ActionSelect icon={MoonStar} label="Snooze…" busy={busy} options={SNOOZE_OPTIONS}
            onPick={(v) => onOutcome('deferred', { days: Number(v) })} />
        </div>
      )}

      {/* quick triage — prospects only (replies you handle in GHL) */}
      {!isReply && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          <a href={ghlContactUrl(contactId)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand">
            <ExternalLink className="h-3.5 w-3.5" /> Open in GHL
          </a>
          <Chip icon={Voicemail} label="Left voicemail" busy={busy} onClick={() => onOutcome('voicemail')} />
          <Chip icon={Phone} label="Talked" busy={busy} onClick={() => onOutcome('talked')} />
          {/* records which link Garrett sent (no send) — note shows in activity */}
          <ActionSelect icon={MessageSquare} label="Sent link…" busy={busy} options={LINK_SENT_OPTIONS}
            onPick={(v) => onOutcome('link-sent', { note: `Sent ${LINK_SENT_LABEL[v] ?? v}` })} />
          {/* off-platform touches GHL can't see — one dropdown, record so the timeline + timer reflect them */}
          <ActionSelect icon={Users} label="Other channel…" busy={busy} options={OTHER_CHANNEL_OPTIONS}
            onPick={(v) => onOutcome(v as PartnerLastSignal)} />
          <ActionSelect icon={MoonStar} label="Snooze…" busy={busy} options={SNOOZE_OPTIONS}
            onPick={(v) => onOutcome('deferred', { days: Number(v) })} />
          <ActionSelect icon={Ban} label="Set aside…" busy={busy} options={SETASIDE_OPTIONS}
            onPick={(v) => { const o = SETASIDE_OPTS[v]; if (o) onOutcome(o.signal, { note: o.note, days: o.days }); }} />
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-amari-border px-3 py-3">
          {/* Prospects get the proactive outreach drafts; replies get only the
              in-context Suggested reply (in CoachPanel) — Reply in GHL already
              sits in the quick-action row above, so no duplicate here. */}
          {!isReply && (
            <>
              <OutreachCoachPanel coach={coach} contactId={contactId} onHandled={onHandled} />
              {/* No cloud draft, but the recommended move is a text → fall back to a
                  static suggested draft so a "text" card is never a dead-end with
                  nothing to send (Eben 2026-06-17). Cloud-draft contacts already show
                  OutreachCoachPanel above; this only fills the gap. */}
              {coach !== 'loading' && !coach && effAction === 'text' && (
                <SuggestedDraftFallback p={item.p} onHandled={onHandled} />
              )}
              <Details p={item.p} />
            </>
          )}

          <CoachPanel contactId={contactId} onHandled={onHandled} />

          {/* activity timeline */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">Recent activity</p>
            {activity === 'loading' || activity === undefined ? (
              <Loader2 className="h-4 w-4 animate-spin text-amari-text-muted" />
            ) : activity === 'error' ? (
              <p className="text-xs text-amari-text-muted">Couldn't load activity.</p>
            ) : activity.length === 0 ? (
              <p className="text-xs text-amari-text-muted">No recent activity.</p>
            ) : (
              <ul className="space-y-1.5">
                {activity.slice(0, 12).map((e, i) => {
                  const Icon = ACTIVITY_ICON[e.type] ?? StickyNote;
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs text-amari-charcoal">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amari-text-muted" />
                      <span className="shrink-0 text-amari-text-muted">{friendlyDate(e.date)}</span>
                      <span className="capitalize">{e.signal || e.type}{e.direction ? ` · ${e.direction}` : ''}</span>
                      {e.body && <span className="min-w-0 break-words text-amari-text-muted">— {e.body}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* note (second-stage) */}
          <div>
            <textarea
              value={noteDraft}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Add a note…"
              rows={2}
              className="w-full resize-none rounded-lg border border-amari-border p-2 text-sm text-amari-charcoal placeholder:text-amari-text-muted focus:outline-none focus:ring-1 focus:ring-amari-accent-warm"
            />
            <button
              type="button" onClick={onSaveNote} disabled={busy || !noteDraft.trim()}
              className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> Save note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Expanded prospect detail (replaces Outreach's modal info).
function Details({ p }: { p: PartnerProspect }) {
  const socials = [
    p.linkedinUrl && { label: 'LinkedIn', url: p.linkedinUrl },
    p.instagram && { label: 'Instagram', url: p.instagram.startsWith('http') ? p.instagram : `https://instagram.com/${p.instagram.replace(/^@/, '')}` },
    ...((p.otherUrls || '').split(';').map((u) => u.trim()).filter(Boolean).map((u) => ({ label: 'Web', url: u.startsWith('http') ? u : `https://${u}` }))),
  ].filter(Boolean) as { label: string; url: string }[];

  return (
    <div className="space-y-2 text-sm text-amari-charcoal">
      <EditableField key={`${p.contactId}-rundown`} contactId={p.contactId} field="partnerRundown" label="story" value={p.rundown} multiline />
      <div className="flex flex-col gap-1">
        {p.phone && <DetailLine icon={Phone} value={p.phone} href={`tel:${p.phone}`} />}
        {p.email && <DetailLine icon={Mail} value={p.email} href={`mailto:${p.email}`} />}
        {p.website && <DetailLine icon={Globe} value={p.website} href={p.website.startsWith('http') ? p.website : `https://${p.website}`} />}
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <EditableField key={`${p.contactId}-facility`} contactId={p.contactId} field="partnerFacility" label="facility" value={p.partnerFacility} />
        <EditableField key={`${p.contactId}-role`} contactId={p.contactId} field="partnerFacilityRole" label="role" value={p.partnerFacilityRole} />
      </div>
      {socials.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {socials.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2 py-1 text-xs text-amari-charcoal hover:bg-amari-light-sand">
              <ExternalLink className="h-3 w-3" /> {s.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Garrett-voice texts for this prospect — tap to copy, paste into the GHL thread.
// Copy lives in src/lib/followupCopy.ts (edit there).
// "Build brief": Claude returns who-they-are + talking points + drafts tailored
// to this person + their thread. Drafted, never sent. On failure, falls back to
// the static saved texts. Button-triggered (one model call per tap).
// Shows the daily call-coach output for this contact (recording → transcript →
// Claude). Lazy: only mounts when a card is expanded. Silent if there's none.
// The outreach coach: who / why-now / message from the local generator (cadence
// + thread + Garrett's voice). Shows at the top of the expanded card with the
// ready-to-send message to copy. Silent if there's no record for this contact.
// Takes the coach record as a prop (fetched once by ActRow so the headline can use
// the same whyNow). The whyNow is shown as the card headline now, so it's not
// repeated here — just the label + the editable/sendable messages.
// Fallback draft for a "text" card with no cloud coach record — reuses the static
// per-category suggested copy + the same editable Send box, so a "text" action
// always has something to send instead of being a dead-end.
function SuggestedDraftFallback({ p, onHandled }: { p: PartnerProspect; onHandled?: () => void }) {
  const texts = suggestedTexts(p);
  if (!texts.length) return null;
  return (
    <div className="rounded-lg border border-amari-border bg-amari-light-sand/40 p-3">
      <p className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">
        <Sparkles className="h-3 w-3" /> Suggested text
      </p>
      <div className="space-y-1.5">
        {texts.map((t, i) => (
          <EditSendText key={i} contactId={p.contactId} text={t} channel="text" onSent={onHandled} />
        ))}
      </div>
    </div>
  );
}

function OutreachCoachPanel({ coach, contactId, onHandled }: { coach: OutreachCoach | null | 'loading'; contactId: string; onHandled?: () => void }) {
  if (coach === 'loading' || !coach) return null;
  return (
    <div className="rounded-lg border border-amari-accent-warm/40 bg-amari-accent-warm/5 p-3">
      <p className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-amari-accent-warm">
        <Sparkles className="h-3 w-3" /> Coach{coach.bucket ? ` · ${coach.bucket.replace(/-/g, ' ')}` : ''}
      </p>
      <div className="space-y-1.5">
        {(coach.variations?.length ? coach.variations : [coach.message]).map((t, i) => (
          <EditSendText key={i} contactId={contactId} text={t} channel={coach.channel} onSent={onHandled} />
        ))}
        <EditSendEmail
          contactId={contactId}
          defaultSubject="A note from Garrett"
          defaultBody={coach.message || ''}
          onSent={onHandled}
        />
      </div>
    </div>
  );
}

function CoachPanel({ contactId, onHandled }: { contactId: string; onHandled?: () => void }) {
  const [coach, setCoach] = useState<CallCoach | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    getCallCoach(contactId).then((c) => { if (live) setCoach(c); });
    return () => { live = false; };
  }, [contactId]);
  if (coach === 'loading' || !coach || !coach.coaching) return null;
  const c = coach.coaching;
  return (
    <div className="rounded-lg border border-amari-border bg-amari-light-sand/40 p-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">
        Call coach{coach.hasAudio ? ' · from recording' : ''} · {coach.date}
      </p>
      {c.summary && <p className="text-sm text-amari-charcoal">{c.summary}</p>}
      {/* Ready-to-send reply, grounded in the thread — editable + sendable in-app.
          Surfaces when the contact's latest message needs an answer (esp. reply cards). */}
      {c.suggestedReply && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-medium text-amari-accent-warm">Suggested reply</p>
          <EditSendText contactId={contactId} text={c.suggestedReply} channel="text" onSent={onHandled} />
        </div>
      )}
      {c.whatWorked?.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[11px] font-medium text-emerald-700">What worked</p>
          <ul className="list-disc pl-4 text-xs text-amari-charcoal">{c.whatWorked.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {c.whatToImprove?.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[11px] font-medium text-amber-700">To improve</p>
          <ul className="list-disc pl-4 text-xs text-amari-charcoal">{c.whatToImprove.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {c.nextStep && <p className="mt-1.5 text-xs text-amari-charcoal"><span className="font-medium">Next:</span> {c.nextStep}</p>}
    </div>
  );
}

function BriefPanel({ p, d }: { p: PartnerProspect; d: Derived }) {
  const [brief, setBrief] = useState<FollowupBrief | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  if (!d.action || d.action === 'decide') return null;

  const run = () => {
    setStatus('loading');
    buildFollowupBrief(p.contactId, {
      name: p.fullName, firstName: p.firstName, category: p.category,
      facility: p.partnerFacility, facilityRole: p.partnerFacilityRole,
      company: p.companyName, city: p.city, state: p.state, rundown: p.rundown,
      lastSignal: p.partnerLastSignal, lastSignalAt: p.partnerLastSignalAt,
    })
      .then((b) => { setBrief(b); setStatus('idle'); })
      .catch(() => setStatus('error'));
  };

  if (brief) {
    return (
      <div className="space-y-2">
        {brief.talkingPoints.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">Talking points</p>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-amari-charcoal">
              {brief.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
        )}
        {brief.drafts.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">Drafts — tap to copy, paste in GHL</p>
            <div className="space-y-1.5">
              {brief.drafts.map((dr, i) => <CopyText key={i} text={dr.text} channel={dr.channel} />)}
            </div>
          </div>
        )}
        <button type="button" onClick={run}
          className="inline-flex items-center gap-1 text-[11px] text-amari-text-muted hover:text-amari-charcoal">
          <RefreshCw className="h-3 w-3" /> Rebuild
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={run} disabled={status === 'loading'}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amari-charcoal px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
        {status === 'loading'
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…</>
          : <><Sparkles className="h-3.5 w-3.5" /> Draft what to say</>}
      </button>
      {status === 'error' && (
        <>
          <p className="text-xs text-red-600">Couldn't build the brief. Showing saved texts.</p>
          <SuggestedTexts p={p} d={d} />
        </>
      )}
    </div>
  );
}

function SuggestedTexts({ p, d }: { p: PartnerProspect; d: Derived }) {
  if (d.action !== 'text' && d.action !== 'reback') return null;
  const texts = suggestedTexts(p);
  if (!texts.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">
        Texts to send — tap to copy, paste in GHL
      </p>
      <div className="space-y-1.5">
        {texts.map((t, i) => <CopyText key={i} text={t} />)}
      </div>
    </div>
  );
}

function CopyText({ text, channel }: { text: string; channel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text)
          .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })
          .catch(() => {});
      }}
      className="block w-full rounded-lg border border-amari-border p-2.5 text-left hover:bg-amari-light-sand"
    >
      {channel && <span className="mb-1 inline-block rounded-full bg-amari-light-sand px-2 py-0.5 text-[10px] uppercase tracking-wide text-amari-text-muted">{channel}</span>}
      <span className="block text-sm text-amari-charcoal">{text}</span>
      <span className={`mt-1 block text-[11px] ${copied ? 'text-emerald-600' : 'text-amari-text-muted'}`}>
        {copied ? '✓ Copied' : 'Tap to copy'}
      </span>
    </button>
  );
}

// Editable message + Send. Garrett can tweak the wording, then send the text right
// from the card (via the same GHL send path as the VM/Talked chips) — no copy-paste.
function EditSendText({ contactId, text, channel, onSent }: { contactId: string; text: string; channel?: string; onSent?: () => void }) {
  const [val, setVal] = useState(text);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Synchronous send-lock: a double-click fires two onClicks before React re-renders
  // with status==='sending', so the state check alone has a real double-send window.
  // A ref flips immediately, so the second click is a no-op. We also remember the
  // exact text we sent, so Send only re-enables for a GENUINELY different message.
  const sendingRef = useRef(false);
  const sentValRef = useRef<string | null>(null);
  // Auto-grow to fit the whole message — no scrollbar inside the box.
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, [val]);
  const send = async () => {
    const msg = val.trim();
    if (!msg || sendingRef.current) return;      // sync guard — closes the double-tap race
    if (msg === sentValRef.current) return;       // already sent this exact text
    sendingRef.current = true;
    setStatus('sending');
    try {
      const res = await sendFollowupText(contactId, msg);
      sentValRef.current = msg;
      setSentTo(res?.sentTo ?? null);
      setStatus('sent');
      // Record the send as a touch so the engine sees it (no more "call them" right
      // after a text). Idempotent: the server's 5-min send-dedupe gates the SMS, so a
      // deduped re-send returns deduped:true and we skip the touch — no double-count.
      // Fire-and-forget: a failed touch-record must not break the (already sent) UX.
      if (!res?.deduped) recordPartnerOutcome({ contactId, signal: 'texted' }).catch(() => {});
      onSent?.(); // drop the card from Act Now now — you handled them
    } catch {
      setStatus('error');
    } finally {
      sendingRef.current = false;
    }
  };
  const sentThisText = status === 'sent' && val.trim() === sentValRef.current;
  return (
    <div className="rounded-lg border border-amari-border p-2.5">
      {channel && <span className="mb-1 inline-block rounded-full bg-amari-light-sand px-2 py-0.5 text-[10px] uppercase tracking-wide text-amari-text-muted">{channel}</span>}
      <textarea
        ref={ref}
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          // Re-enable Send only when the text actually changes after a send/error —
          // editing to a NEW message is a legit new send; identical text stays locked.
          if (status === 'error') setStatus('idle');
          else if (status === 'sent' && e.target.value.trim() !== sentValRef.current) setStatus('idle');
        }}
        rows={3}
        className="w-full resize-y overflow-hidden rounded border border-amari-border bg-white p-2 text-sm text-amari-charcoal"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" onClick={send} disabled={status === 'sending' || sentThisText || !val.trim()}
          className="rounded-lg bg-amari-accent-warm px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {status === 'sending' ? 'Sending…' : sentThisText ? '✓ Sent' : 'Send text'}
        </button>
        <button type="button"
          onClick={() => { navigator.clipboard?.writeText(val).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
          className="rounded-lg border border-amari-border px-3 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        {sentThisText && <span className="text-xs text-amari-text-muted">Sent{sentTo ? ` to ${sentTo}` : ''}</span>}
        {status === 'error' && <span className="text-xs text-red-600">Didn't send — try again</span>}
      </div>
    </div>
  );
}

// Plain-text → safe HTML for the email body: escape, paragraph on blank lines,
// <br> on single newlines. Keeps Garrett's line breaks without trusting raw input.
function bodyToHtml(s: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return s.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

// Editable subject + body + Send email. The email twin of EditSendText — Garrett tweaks
// the wording, then sends THROUGH GHL (logged on the timeline, traceable) with the same
// synchronous double-send lock. Body is plain text in the box; converted to HTML on send.
function EditSendEmail({ contactId, defaultSubject, defaultBody, onSent }: { contactId: string; defaultSubject: string; defaultBody: string; onSent?: () => void }) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const sentKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, [body]);
  const key = `${subject.trim()} ${body.trim()}`;
  const send = async () => {
    const subj = subject.trim();
    const msg = body.trim();
    if (!subj || !msg || sendingRef.current) return;   // sync guard — closes the double-tap race
    if (key === sentKeyRef.current) return;             // already sent this exact email
    sendingRef.current = true;
    setStatus('sending');
    try {
      const res = await sendFollowupEmail(contactId, subj, bodyToHtml(msg));
      sentKeyRef.current = key;
      setSentTo(res?.sentTo ?? null);
      setStatus('sent');
      // Record the send as a touch so the engine sees it. Idempotent via the server's
      // 5-min send-dedupe (deduped:true → skip the touch). Fire-and-forget.
      if (!res?.deduped) recordPartnerOutcome({ contactId, signal: 'emailed' }).catch(() => {});
      onSent?.(); // drop the card from Act Now now — you handled them
    } catch {
      setStatus('error');
    } finally {
      sendingRef.current = false;
    }
  };
  const sentThis = status === 'sent' && key === sentKeyRef.current;
  const onEdit = () => { if (status === 'error') setStatus('idle'); else if (status === 'sent' && key !== sentKeyRef.current) setStatus('idle'); };
  return (
    <div className="rounded-lg border border-amari-border p-2.5">
      <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-amari-light-sand px-2 py-0.5 text-[10px] uppercase tracking-wide text-amari-text-muted">
        <Mail className="h-3 w-3" /> Email
      </span>
      <input
        type="text"
        value={subject}
        onChange={(e) => { setSubject(e.target.value); onEdit(); }}
        placeholder="Subject"
        className="mb-1.5 w-full rounded border border-amari-border bg-white px-2 py-1.5 text-sm font-medium text-amari-charcoal"
      />
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => { setBody(e.target.value); onEdit(); }}
        rows={6}
        className="w-full resize-y overflow-hidden rounded border border-amari-border bg-white p-2 text-sm text-amari-charcoal"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" onClick={send} disabled={status === 'sending' || sentThis || !subject.trim() || !body.trim()}
          className="rounded-lg bg-amari-accent-warm px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {status === 'sending' ? 'Sending…' : sentThis ? '✓ Sent' : 'Send email'}
        </button>
        {sentThis && <span className="text-xs text-amari-text-muted">Sent{sentTo ? ` to ${sentTo}` : ''}</span>}
        {status === 'error' && <span className="text-xs text-red-600">Didn't send — try again</span>}
      </div>
    </div>
  );
}

// Inline-editable field — click the pencil to edit, saves to GHL via
// updateContactField. Optimistic: shows the new value immediately.
function EditableField({ contactId, field, label, value, multiline }: {
  contactId: string; field: EditableFieldKey; label: string; value: string | null; multiline?: boolean;
}) {
  const [val, setVal] = useState(value || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateContactField(contactId, field, draft.trim());
      setVal(draft.trim());
      setEditing(false);
    } catch { /* leave the editor open so the text isn't lost */ } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="flex items-start gap-1">
        {multiline
          ? <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
              className="w-full resize-none rounded-lg border border-amari-border p-2 text-sm text-amari-charcoal focus:outline-none focus:ring-1 focus:ring-amari-accent-warm" />
          : <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-lg border border-amari-border px-2 py-1 text-sm text-amari-charcoal focus:outline-none focus:ring-1 focus:ring-amari-accent-warm" />}
        <button type="button" onClick={save} disabled={saving}
          className="shrink-0 rounded-lg border border-amari-border p-1.5 text-emerald-600 disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => { setDraft(val); setEditing(false); }}
          className="shrink-0 rounded-lg border border-amari-border p-1.5 text-amari-text-muted"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  return (
    <div className="group flex items-start gap-1.5">
      <span className={val ? 'text-amari-charcoal' : 'italic text-amari-text-muted'}>{val || `No ${label} yet`}</span>
      <button type="button" onClick={() => { setDraft(val); setEditing(true); }}
        className="mt-0.5 shrink-0 text-amari-text-muted opacity-60 hover:opacity-100" aria-label={`Edit ${label}`}>
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

function DetailLine({ icon: Icon, value, href }: { icon: typeof Phone; value: string; href: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-2 text-amari-charcoal hover:underline">
      <Icon className="h-3.5 w-3.5 shrink-0 text-amari-text-muted" /> <span className="truncate">{value}</span>
    </a>
  );
}

function Chip({ icon: Icon, label, busy, onClick }: { icon: typeof Phone; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-text-muted hover:bg-amari-light-sand disabled:opacity-40">
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

// A chip-styled dropdown — pick an option and it fires onPick, then resets.
// Used for Snooze (durations) and Set aside (reasons) so the choice is explicit.
function ActionSelect({
  icon: Icon, label, options, busy, onPick,
}: {
  icon: typeof Phone; label: string; busy: boolean;
  options: { value: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2 py-1.5 text-xs text-amari-text-muted">
      <Icon className="h-3.5 w-3.5" />
      <select
        defaultValue="" disabled={busy}
        onChange={(e) => { const v = e.target.value; if (v) { onPick(v); e.currentTarget.value = ''; } }}
        className="bg-transparent pr-1 text-xs text-amari-text-muted focus:outline-none disabled:opacity-40"
      >
        <option value="" disabled>{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

function Tab({ active, onClick, label, icon: Icon }: { active: boolean; onClick: () => void; label: string; icon: typeof Clock }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${active ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function Empty({ icon: Icon, title, sub }: { icon: typeof Clock; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Icon className="h-8 w-8 text-amari-text-muted" />
      <p className="font-medium text-amari-charcoal">{title}</p>
      <p className="text-sm text-amari-text-muted">{sub}</p>
    </div>
  );
}
