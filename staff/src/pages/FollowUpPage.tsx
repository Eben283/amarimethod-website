import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Loader2, ExternalLink, AlertCircle, Phone, MessageSquare,
  Voicemail, CheckCircle2, Clock, MoonStar, Ban, ChevronDown, ChevronUp,
  Mail, StickyNote, Calendar, Globe, Reply, Send,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getPartnerProspects, getConversations, getPartnerActivity,
  recordPartnerOutcome, addNote, ApiError,
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

// Cadence thresholds — PLACEHOLDERS, tunable to Garrett's actual (slower) rhythm.
const VM_FOLLOWUP_DAYS = 3;
const TALKED_FOLLOWUP_DAYS = 1;
const LINK_FOLLOWUP_DAYS = 3;
const OFFPLATFORM_FOLLOWUP_DAYS = 3;
const NOANSWER_RETRY_DAYS = 1;
const QUIET_NUDGE_DAYS = 3;
const END_OF_ROPE_TOUCHES = 6;

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

type RowKind = 'act' | 'waiting' | 'aside' | 'converted';
type ActionKind = 'call' | 'text' | 'reback' | 'decide';

interface Derived {
  kind: RowKind;
  urgency: number;
  why: string;
  action: ActionKind | null;
  asideReason?: string;
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
  return `${d}d ago`;
}

// Not every inbound message needs a reply. "Thanks", "we'll be in touch", 👍 are
// conversation-closers — terminal, no action. GHL flags any inbound-last message
// as needs-reply, so we filter closers out of the urgent tier. Imperfect on
// purpose — backed by a one-tap "No reply needed" on each row, and the Messages
// tab still shows everything as the safety net.
const CLOSER_RE = /\b(thank you|thanks|thx|ty|appreciate it|much appreciated|sounds good|sounds great|will do|we'?ll be in touch|be in touch|likewise|same to you|talk soon|see you|see ya|no worries|got it|perfect|great|awesome|wonderful)\b/i;
const QUESTION_RE = /\?|\b(can|could|would|when|what|where|how|why|which|do you|are you|is there|reschedul|cancel|change|price|cost|available|book|question)\b/i;
function isCloser(text: string | null | undefined): boolean {
  if (!text) return true;            // empty/unknown inbound = nothing actionable
  const t = text.trim();
  if (!t) return true;
  if (t.length > 80) return false;   // long messages probably say something
  if (QUESTION_RE.test(t)) return false; // a question always needs a reply
  return CLOSER_RE.test(t);
}

// The Act Now engine: one reason per prospect, derived from GHL signals.
function derive(p: PartnerProspect): Derived {
  if (p.isActivePartner || p.partnerStage === 'partner' || p.partnerStage === 'session-booked') {
    return { kind: 'converted', urgency: 0, why: 'Booked — now a client.', action: null };
  }
  if (p.partnerStage === 'dropped') {
    return { kind: 'aside', urgency: 0, why: '', action: null, asideReason: 'Not a fit' };
  }
  if (p.partnerStage === 'future-potential') {
    const due = p.partnerFollowupAt ? new Date(p.partnerFollowupAt).getTime() <= Date.now() : true;
    if (due) return { kind: 'act', urgency: 92, action: 'reback', why: 'Snoozed lead is back — worth another look.' };
    return { kind: 'aside', urgency: 0, why: '', action: null, asideReason: `Snoozed until ${friendlyDate(p.partnerFollowupAt)}` };
  }

  const d = daysSince(lastTouchAt(p));
  const sig = p.partnerLastSignal;

  // New / untouched ranks BELOW warm in-progress follow-ups (urgency < the
  // talked/voicemail/link tiers): the leak we're fixing is dropped follow-through,
  // and Garrett over-indexes on fresh first calls. No arrival date in the feed
  // yet, so we can't bump genuinely-fresh leads for speed-to-lead — all untouched
  // sit in one low tier above only the end-of-rope decision.
  if (!sig && (p.touchCount ?? 0) === 0) {
    return { kind: 'act', urgency: 45, action: 'call', why: 'New lead — first contact (after your follow-ups).' };
  }
  if ((p.touchCount ?? 0) >= END_OF_ROPE_TOUCHES) {
    return { kind: 'act', urgency: 38, action: 'decide', why: `${p.touchCount} touches, no traction — keep trying, or set aside?` };
  }

  const due = (t: number) => d === null || d >= t;
  const waiting = (label: string): Derived => ({ kind: 'waiting', urgency: 0, why: label, action: null });

  switch (sig) {
    case 'no-answer':
      return due(NOANSWER_RETRY_DAYS)
        ? { kind: 'act', urgency: 62, action: 'call', why: `Called ${ago(d)}, no answer — give them another call.` }
        : waiting('Just called');
    case 'voicemail':
      return due(VM_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 70, action: 'text', why: `Voicemail ${ago(d)} — a text here is good.` }
        : waiting('Voicemail left, giving it a beat');
    case 'talked':
      return due(TALKED_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 76, action: 'text', why: `Talked ${ago(d)} — text them the next step while it's warm.` }
        : waiting('Just talked');
    case 'link-sent':
      return due(LINK_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 66, action: 'text', why: `Sent the link ${ago(d)}, not booked — a text nudge is good.` }
        : waiting('Link just sent');
    case 'linkedin-msg':
    case 'linkedin-req':
    case 'instagram-msg':
    case 'in-person':
      return due(OFFPLATFORM_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 55, action: 'text', why: `Reached out ${ago(d)} — a text follow-up is good.` }
        : waiting('Recently reached out');
    case 'not-interested':
      return { kind: 'aside', urgency: 0, why: '', action: null, asideReason: 'Not interested' };
    default:
      return due(QUIET_NUDGE_DAYS)
        ? { kind: 'act', urgency: 50, action: 'text', why: `Quiet ${ago(d)} — a text check-in is good.` }
        : waiting('Recently touched');
  }
}

// Unified worklist item: an unanswered reply OR a prospect needing a touch.
type ReplyItem = { kind: 'reply'; conv: ConversationSummary; isClient: boolean };
type ProspectItem = { kind: 'prospect'; p: PartnerProspect; d: Derived };
type ActItem = ReplyItem | ProspectItem;

const URGENCY_DOT: Record<ActionKind, string> = {
  reback: 'bg-amari-accent-warm', call: 'bg-emerald-500', text: 'bg-amari-accent-warm', decide: 'bg-amber-500',
};
const ACTION_LABEL: Record<ActionKind, string> = {
  reback: 'Re-reach', call: 'Call', text: 'Text', decide: 'Decide',
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prospectsRes, convoRes] = await Promise.all([
        getPartnerProspects(),
        getConversations('needs_reply').catch(() => ({ conversations: [] as ConversationSummary[] })),
      ]);
      setProspects(prospectsRes.prospects);
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

  const derived = useMemo(
    () => prospects.map((p) => ({ p, d: derive(p) })),
    [prospects],
  );

  // 1) Unanswered replies — always top. (Messages folded in.)
  const replyItems = useMemo<ReplyItem[]>(() => {
    return conversations
      .filter((c) => c.needsReply && !isCloser(c.lastMessagePreview) && !dismissedReplies.has(c.contactId))
      .sort((a, b) => new Date(b.lastMessageDate ?? 0).getTime() - new Date(a.lastMessageDate ?? 0).getTime())
      .map((conv) => ({
        kind: 'reply' as const,
        conv,
        // A non-prospect who messaged is treated as a client; partners are clients too.
        isClient: prospectMap.get(conv.contactId)?.isActivePartner ?? !prospectMap.has(conv.contactId),
      }));
  }, [conversations, prospectMap, dismissedReplies]);

  // 2) Prospects needing a touch — minus anyone already surfaced as a reply.
  const prospectActNow = useMemo<ProspectItem[]>(() => {
    const replyIds = new Set(replyItems.map((r) => r.conv.contactId));
    return derived
      .filter((r) => r.d.kind === 'act' && !replyIds.has(r.p.contactId))
      .sort((a, b) => b.d.urgency - a.d.urgency)
      .map((r) => ({ kind: 'prospect' as const, p: r.p, d: r.d }));
  }, [derived, replyItems]);

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
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to record');
    } finally {
      setBusyId(null);
    }
  }, [logout]);

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

      <div className="mb-4 flex gap-1 rounded-xl bg-amari-light-sand p-1">
        <Tab active={view === 'act'} onClick={() => setView('act')} label={`Act Now (${counts.replies + counts.act})`} icon={Clock} />
        <Tab active={view === 'aside'} onClick={() => setView('aside')} label={`Set Aside (${counts.aside})`} icon={MoonStar} />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
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
}

function ActRow({ item, expanded, activity, busy, noteDraft, onToggle, onOutcome, onNoteChange, onSaveNote, onDismiss }: ActRowProps) {
  const isReply = item.kind === 'reply';
  const contactId = isReply ? item.conv.contactId : item.p.contactId;
  const name = displayName(isReply ? item.conv.contactName : item.p.fullName) || 'Unknown';
  const isClient = isReply ? item.isClient : item.p.isActivePartner;
  const industry = !isReply && item.p.category !== 'unknown' ? item.p.category : '';

  return (
    <div className={`rounded-xl border bg-white ${isClient ? 'border-l-4 border-l-amari-accent-warm border-amari-border' : 'border-amari-border'}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-2 p-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isReply
              ? <Reply className="h-3.5 w-3.5 shrink-0 text-amari-accent-warm" />
              : item.d.action && <span className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[item.d.action]}`} />}
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
              <p className="mt-1 text-sm text-amari-charcoal">{item.d.why}</p>
              <p className="mt-0.5 text-[11px] text-amari-text-muted">Last touch: {ago(daysSince(lastTouchAt(item.p)))}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isReply
            ? <span className="rounded-lg bg-amari-accent-warm px-2.5 py-1 text-xs font-medium text-white">Reply</span>
            : item.d.action && <span className="rounded-lg bg-amari-charcoal px-2.5 py-1 text-xs font-medium text-white">{ACTION_LABEL[item.d.action]}</span>}
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
          <Chip icon={MessageSquare} label="Sent link" busy={busy} onClick={() => onOutcome('link-sent')} />
          <ActionSelect icon={MoonStar} label="Snooze…" busy={busy} options={SNOOZE_OPTIONS}
            onPick={(v) => onOutcome('deferred', { days: Number(v) })} />
          <ActionSelect icon={Ban} label="Set aside…" busy={busy} options={SETASIDE_OPTIONS}
            onPick={(v) => { const o = SETASIDE_OPTS[v]; if (o) onOutcome(o.signal, { note: o.note, days: o.days }); }} />
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-amari-border px-3 py-3">
          {isReply ? (
            <a href={ghlContactUrl(contactId)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-amari-charcoal px-3 py-1.5 text-xs font-medium text-white">
              <ExternalLink className="h-3.5 w-3.5" /> Reply in GHL
            </a>
          ) : (
            <>
              <SuggestedTexts p={item.p} d={item.d} />
              <Details p={item.p} />
            </>
          )}

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
                      {e.body && <span className="truncate text-amari-text-muted">— {e.body}</span>}
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
      {p.rundown && <p className="text-amari-text-muted">{p.rundown}</p>}
      <div className="flex flex-col gap-1">
        {p.phone && <DetailLine icon={Phone} value={p.phone} href={`tel:${p.phone}`} />}
        {p.email && <DetailLine icon={Mail} value={p.email} href={`mailto:${p.email}`} />}
        {p.website && <DetailLine icon={Globe} value={p.website} href={p.website.startsWith('http') ? p.website : `https://${p.website}`} />}
      </div>
      {(p.partnerFacility || p.partnerFacilityRole) && (
        <p className="text-xs text-amari-text-muted">
          {p.partnerFacility}{p.partnerFacility && p.partnerFacilityRole ? ' · ' : ''}{p.partnerFacilityRole}
        </p>
      )}
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

function CopyText({ text }: { text: string }) {
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
      <span className="block text-sm text-amari-charcoal">{text}</span>
      <span className={`mt-1 block text-[11px] ${copied ? 'text-emerald-600' : 'text-amari-text-muted'}`}>
        {copied ? '✓ Copied' : 'Tap to copy'}
      </span>
    </button>
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
