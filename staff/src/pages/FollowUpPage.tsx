import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Loader2, ExternalLink, AlertCircle, Phone, MessageSquare,
  Voicemail, CheckCircle2, Clock, MoonStar, Ban,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getPartnerProspects, recordPartnerOutcome, ApiError } from '../lib/api';
import type { PartnerProspect, PartnerLastSignal } from '../types/staff';

// ── FOLLOW-UP / COMMUNICATION SURFACE (v1, additive) ──────────────────────────
// A worklist, not a database to filter. Each row exists for ONE reason ("why now")
// and offers the next action. Built additively alongside the existing Outreach tab
// (PartnersPage) so it's fully reversible — see ops/drafts/followup-comms-surface-spec.md.
//
// What's NOT here yet (edit later):
//  • Inbound-reply prioritization (needs the conversations-direction merge).
//  • Auto-emails (GHL workflows — pending a fix-advisor pass; this page sends nothing).
//  • Garrett's real intervals + industry-segmented copy variations.
//  • "Bring back" from Set Aside writes no stage (no clean reactivate signal yet) — opens GHL.

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

// Cadence thresholds — PLACEHOLDERS, tunable to Garrett's actual rhythm (he runs
// slower than sales-optimal; coach mode nudges him forward, see spec).
const VM_FOLLOWUP_DAYS = 3;
const TALKED_FOLLOWUP_DAYS = 1;
const LINK_FOLLOWUP_DAYS = 3;
const OFFPLATFORM_FOLLOWUP_DAYS = 3;
const NOANSWER_RETRY_DAYS = 1;
const QUIET_NUDGE_DAYS = 3;
const END_OF_ROPE_TOUCHES = 6;       // ~3 VM / extras — refine with real caps
const SNOOZE_DAYS = 7;

type RowKind = 'act' | 'waiting' | 'aside' | 'converted';
type ActionKind = 'call' | 'text' | 'reback' | 'decide';

interface Derived {
  kind: RowKind;
  urgency: number;       // higher sorts first in Act Now
  why: string;          // the "why now" line, coach-framed
  action: ActionKind | null;
  asideReason?: string;  // shown in Set Aside view
}

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

// The engine: one reason per prospect, derived from GHL signals.
function derive(p: PartnerProspect): Derived {
  // Converted — they booked / are a partner. v1 keeps them out of the worklist
  // (client-mode comms is a later phase); we just count them.
  if (p.isActivePartner || p.partnerStage === 'partner' || p.partnerStage === 'session-booked') {
    return { kind: 'converted', urgency: 0, why: 'Booked — now a client.', action: null };
  }

  // Set aside — dropped / not interested.
  if (p.partnerStage === 'dropped') {
    return { kind: 'aside', urgency: 0, why: '', action: null, asideReason: 'Not a fit' };
  }

  // Snoozed (future-potential): back in the list once the date passes, else parked.
  if (p.partnerStage === 'future-potential') {
    const due = p.partnerFollowupAt ? new Date(p.partnerFollowupAt).getTime() <= Date.now() : true;
    if (due) {
      return { kind: 'act', urgency: 92, action: 'reback', why: 'Snoozed lead is back — worth another look.' };
    }
    return { kind: 'aside', urgency: 0, why: '', action: null, asideReason: `Snoozed until ${friendlyDate(p.partnerFollowupAt)}` };
  }

  const d = daysSince(lastTouchAt(p));
  const sig = p.partnerLastSignal;

  // Never contacted.
  if (!sig && (p.touchCount ?? 0) === 0) {
    return { kind: 'act', urgency: 80, action: 'call', why: 'New — not contacted yet.' };
  }

  // End of the rope — stop the nagging, ask for a decision instead.
  if ((p.touchCount ?? 0) >= END_OF_ROPE_TOUCHES) {
    return { kind: 'act', urgency: 38, action: 'decide', why: `${p.touchCount} touches, no traction — keep trying, or set aside?` };
  }

  const due = (threshold: number) => d === null || d >= threshold;
  const waiting = (label: string): Derived => ({ kind: 'waiting', urgency: 0, why: label, action: null });

  switch (sig) {
    case 'no-answer':
      return due(NOANSWER_RETRY_DAYS)
        ? { kind: 'act', urgency: 62, action: 'call', why: `Called ${ago(d)}, no answer — worth another try.` }
        : waiting('Just called');
    case 'voicemail':
      return due(VM_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 70, action: 'text', why: `Voicemail ${ago(d)} — a follow-up here is normal, not pushy.` }
        : waiting('Voicemail left, giving it a beat');
    case 'talked':
      return due(TALKED_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 76, action: 'text', why: `Talked ${ago(d)} — send the next step while it's warm.` }
        : waiting('Just talked');
    case 'link-sent':
      return due(LINK_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 66, action: 'text', why: `Link sent ${ago(d)}, not booked — a gentle nudge would feel natural.` }
        : waiting('Link just sent');
    case 'linkedin-msg':
    case 'linkedin-req':
    case 'instagram-msg':
    case 'in-person':
      return due(OFFPLATFORM_FOLLOWUP_DAYS)
        ? { kind: 'act', urgency: 55, action: 'text', why: `Reached out ${ago(d)} — time for a warm follow-up.` }
        : waiting('Recently reached out');
    case 'not-interested':
      return { kind: 'aside', urgency: 0, why: '', action: null, asideReason: 'Not interested' };
    default:
      // Working, touched before, signal unclear.
      return due(QUIET_NUDGE_DAYS)
        ? { kind: 'act', urgency: 50, action: 'text', why: `Quiet ${ago(d)} — a check-in would feel natural here.` }
        : waiting('Recently touched');
  }
}

const URGENCY_DOT: Record<ActionKind, string> = {
  reback: 'bg-amari-accent-warm',
  call: 'bg-emerald-500',
  text: 'bg-amari-accent-warm',
  decide: 'bg-amber-500',
};

const ACTION_LABEL: Record<ActionKind, string> = {
  reback: 'Re-reach', call: 'Call', text: 'Text', decide: 'Decide',
};

interface RowProps {
  p: PartnerProspect;
  d: Derived;
  busy: boolean;
  onOutcome: (p: PartnerProspect, signal: PartnerLastSignal) => void;
}

function Row({ p, d, busy, onOutcome }: RowProps) {
  const name = displayName(p.fullName);
  const industry = p.category && p.category !== 'unknown' ? p.category : '';
  const isClient = p.isActivePartner;
  const touch = ago(daysSince(lastTouchAt(p)));

  return (
    <div
      className={`rounded-xl border bg-white p-3 ${
        isClient ? 'border-l-4 border-l-amari-accent-warm border-amari-border' : 'border-amari-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {d.action && <span className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[d.action]}`} />}
            <span className="truncate font-medium text-amari-charcoal">{name || 'Unknown'}</span>
            {industry && (
              <span className="shrink-0 rounded-full bg-amari-light-sand px-2 py-0.5 text-[11px] capitalize text-amari-text-muted">
                {industry}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-amari-charcoal">{d.why}</p>
          <p className="mt-0.5 text-[11px] text-amari-text-muted">Last touch: {touch}</p>
        </div>
        {d.action && (
          <span className="shrink-0 rounded-lg bg-amari-charcoal px-2.5 py-1 text-xs font-medium text-white">
            {ACTION_LABEL[d.action]}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <a
          href={ghlContactUrl(p.contactId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open in GHL
        </a>
        <Chip icon={Voicemail} label="Voicemail" busy={busy} onClick={() => onOutcome(p, 'voicemail')} />
        <Chip icon={Phone} label="Talked" busy={busy} onClick={() => onOutcome(p, 'talked')} />
        <Chip icon={MessageSquare} label="Link sent" busy={busy} onClick={() => onOutcome(p, 'link-sent')} />
        <Chip icon={MoonStar} label={`Snooze ${SNOOZE_DAYS}d`} busy={busy} onClick={() => onOutcome(p, 'deferred')} />
        <Chip icon={Ban} label="Not a fit" busy={busy} onClick={() => onOutcome(p, 'skip')} />
      </div>
    </div>
  );
}

function Chip({
  icon: Icon, label, busy, onClick,
}: { icon: typeof Phone; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-text-muted hover:bg-amari-light-sand disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

export default function FollowUpPage() {
  const { logout } = useAuth();
  const [prospects, setProspects] = useState<PartnerProspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'act' | 'aside'>('act');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPartnerProspects();
      setProspects(res.prospects);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => prospects.map((p) => ({ p, d: derive(p) })),
    [prospects],
  );

  const actNow = useMemo(
    () => rows.filter((r) => r.d.kind === 'act').sort((a, b) => b.d.urgency - a.d.urgency),
    [rows],
  );
  const setAside = useMemo(() => rows.filter((r) => r.d.kind === 'aside'), [rows]);
  const counts = useMemo(() => ({
    act: rows.filter((r) => r.d.kind === 'act').length,
    waiting: rows.filter((r) => r.d.kind === 'waiting').length,
    aside: rows.filter((r) => r.d.kind === 'aside').length,
    converted: rows.filter((r) => r.d.kind === 'converted').length,
    total: rows.length,
  }), [rows]);

  const onOutcome = useCallback(async (p: PartnerProspect, signal: PartnerLastSignal) => {
    setBusyId(p.contactId);
    try {
      const followupAt = signal === 'deferred'
        ? new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString()
        : undefined;
      await recordPartnerOutcome({ contactId: p.contactId, signal, followupAt });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to record');
    } finally {
      setBusyId(null);
    }
  }, [load, logout]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-amari-charcoal">Follow-Up</h1>
          <p className="text-xs text-amari-text-muted">
            {counts.total} in the funnel · {counts.act} to act on · {counts.waiting} cooling off · {counts.converted} booked
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-amari-border p-2 text-amari-text-muted hover:bg-amari-light-sand disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl bg-amari-light-sand p-1">
        <Tab active={view === 'act'} onClick={() => setView('act')} label={`Act Now (${counts.act})`} icon={Clock} />
        <Tab active={view === 'aside'} onClick={() => setView('aside')} label={`Set Aside (${counts.aside})`} icon={MoonStar} />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-amari-charcoal" />
        </div>
      ) : view === 'act' ? (
        actNow.length === 0 ? (
          <Empty icon={CheckCircle2} title="Nothing needs you right now" sub="Cleared the list — nice." />
        ) : (
          <div className="space-y-2">
            {actNow.map(({ p, d }) => (
              <Row key={p.contactId} p={p} d={d} busy={busyId === p.contactId} onOutcome={onOutcome} />
            ))}
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
              <a
                href={ghlContactUrl(p.contactId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amari-border px-2.5 py-1.5 text-xs text-amari-charcoal hover:bg-amari-light-sand"
              >
                <ExternalLink className="h-3.5 w-3.5" /> GHL
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, label, icon: Icon }: { active: boolean; onClick: () => void; label: string; icon: typeof Clock }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${
        active ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'
      }`}
    >
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
