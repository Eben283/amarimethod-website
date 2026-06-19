import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Gift } from 'lucide-react';
import { getDayData } from '../lib/api';
import type { TodayAppointment } from '../types/staff';

// "Today's sell moments" — surfaces the 8-pack opportunities hiding in today's
// schedule, computed from data each appointment already carries (Eben 2026-06-18:
// the Today view never flagged Zach's renewal or a new trainer's pitch). Two cases:
//   - RENEWAL: a client on a paid pack at their last/zero session → pitch the next.
//   - PITCH:   a first-timer's gifted/initial session (no pack yet) → offer the 8-pack.
// (Cancellation-recovery is a separate follow-up — cancelled events are filtered out
//  of staff-data and often deleted in GHL, so they need a trace mechanism first.)

type MomentKind = 'renewal' | 'pitch';
interface Moment { kind: MomentKind; appt: TodayAppointment; label: string; why: string; }

const CALL_RE = /discovery call|15.?min(ute)?|consultation|pain assessment/i;
const FREE_RE = /discovery call|pain assessment|15.?min(ute)?|consultation|partner|gift/i;
const isCall = (a: TodayAppointment) => CALL_RE.test(a.title) || CALL_RE.test(a.calendarName);
const isFreeSession = (a: TodayAppointment) => FREE_RE.test(a.title) || FREE_RE.test(a.calendarName);
const isPaidSeries = (a: TodayAppointment) => /\d\s*-?\s*session|series/i.test(a.seriesType || '');

function classify(a: TodayAppointment): Moment | null {
  // Renewal: on a paid pack and down to their last (1) or out (0) — pitch the next
  // pack today, before they walk. (Zach's case — he hit zero and re-upped in person.)
  if (isPaidSeries(a) && a.sessionsRemaining <= 1) {
    return {
      kind: 'renewal', appt: a, label: 'Renewal',
      why: a.sessionsRemaining <= 0
        ? 'Out of sessions — pitch the next pack today.'
        : 'Last session in the pack — pitch the next one before they walk.',
    };
  }
  // First-timer with no pack yet (a gifted / initial in-person session, not a
  // 15-min discovery call) → after they feel the work, offer the 8-pack.
  if (a.sessionsCompleted === 0 && isFreeSession(a) && !isCall(a)) {
    return {
      kind: 'pitch', appt: a, label: 'Pack pitch',
      why: 'First session — after they feel the work, offer the 8-pack.',
    };
  }
  return null;
}

export default function MoneyMoments() {
  const navigate = useNavigate();
  const [moments, setMoments] = useState<Moment[]>([]);

  useEffect(() => {
    let live = true;
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    getDayData(today)
      .then((appts) => { if (live) setMoments((appts || []).map(classify).filter(Boolean) as Moment[]); })
      .catch(() => { /* silent — never block the Today view on a sell-moment fetch */ });
    return () => { live = false; };
  }, []);

  if (moments.length === 0) return null;

  return (
    <div className="mb-3 rounded-xl border border-amari-accent-warm/40 bg-amari-accent-warm/5 p-3">
      <p className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-amari-accent-warm">
        <TrendingUp className="h-3 w-3" /> Today&apos;s sell moments
      </p>
      <div className="space-y-1.5">
        {moments.map((m, i) => (
          <button
            key={`${m.appt.id}-${i}`}
            type="button"
            onClick={() => navigate(`/client/${m.appt.contactId}?appointment=${m.appt.id}`)}
            className="flex w-full items-start gap-2 rounded-lg border border-amari-border bg-white px-3 py-2 text-left hover:bg-amari-light-sand"
          >
            {m.kind === 'renewal'
              ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              : <Gift className="mt-0.5 h-4 w-4 shrink-0 text-amari-accent-warm" />}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-amari-charcoal">
                {m.appt.contactName} · <span className="text-amari-accent-warm">{m.label}</span>
              </span>
              <span className="block text-xs text-amari-text-muted">{m.why}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
