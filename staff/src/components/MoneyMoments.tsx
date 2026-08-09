import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Gift, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { getDayData } from '../lib/api';
import { memberWorkspacePath } from '../lib/member-workspace';
import type { TodayAppointment } from '../types/staff';

// "Today's sell moments" — surfaces the 8-pack opportunities hiding in today's
// schedule, computed from data each appointment already carries (Eben 2026-06-18).
//   - RENEWAL:  a client on a paid pack at their last/zero session → pitch the next,
//               WITH the re-up talk track (FOCUS 9) so the conversation has a spine.
//   - PITCH:    a first-timer's gifted/initial session (no pack yet) → offer the 8-pack.
//   - RECOVERY: a session CANCELLED today → reach out + reschedule (and keep the pitch
//               alive for a first-timer). NOTE: GHL sometimes DELETES a cancelled event
//               entirely (no trace) — those can't surface here; that needs a GHL
//               trace-on-cancel (tag the contact on cancel). This catches the ones that
//               remain as appointmentStatus=cancelled.

type MomentKind = 'renewal' | 'pitch' | 'recovery';
interface Moment { kind: MomentKind; appt: TodayAppointment; label: string; why: string; coaching?: string[]; }

// The re-up talk track (FOCUS 9, sharpen-focus-backlog.md). Technique placeholders, NOT
// Garrett's verified voice — the spine of the conversation, in his real wording when he
// has it. Lead with their win → future-state gap → continuation-as-default → cost of
// stopping → guarantee (not a discount) → ask + send the link same-day.
const RE_UP_BEATS = [
  'Get the yes on their progress first, they did the work: "that hip\'s moving a lot freer than six weeks ago, right? That\'s you, you put in the reps."',
  'Name the future-state gap: "the next stretch is where the new pattern starts holding on its own, the part most people quit right before it locks in."',
  'Make continuing the default, not a fresh decision: "natural next step is another eight, same rhythm we\'ve been on, not starting over."',
  'Cost of stopping (honest, "what I find", never fear): "if we stop here some of this slowly gives back, a new default takes reps to stick."',
  'Hesitation goes to the guarantee, not a discount: "same deal, we keep working till you feel it. The only way this doesn\'t pay off is stopping now."',
  'Ask plainly, send the link same-day: "want me to send over the next eight?" then the 8-Session link.',
];

const CALL_RE = /discovery call|15.?min(ute)?|consultation|pain assessment/i;
const FREE_RE = /discovery call|pain assessment|15.?min(ute)?|consultation|partner|gift/i;
const isCall = (a: TodayAppointment) => CALL_RE.test(a.title) || CALL_RE.test(a.calendarName);
const isFreeSession = (a: TodayAppointment) => FREE_RE.test(a.title) || FREE_RE.test(a.calendarName);
const isPaidSeries = (a: TodayAppointment) => /\d\s*-?\s*session|series/i.test(a.seriesType || '');
const isCancelled = (a: TodayAppointment) => (a.appointmentStatus || '').toLowerCase() === 'cancelled';

function classify(a: TodayAppointment): Moment | null {
  // Recovery: a session cancelled today → reach out, reschedule, keep the pitch alive.
  // (A new trainer's first session that cancels is the one we most don't want to lose.)
  if (isCancelled(a)) {
    const firstTimer = a.sessionsCompleted === 0 && isFreeSession(a) && !isCall(a);
    return {
      kind: 'recovery', appt: a, label: 'Cancelled',
      why: firstTimer
        ? 'Cancelled before their first session — reach out, reschedule, and keep the pack pitch alive.'
        : 'Cancelled today — reach out and get them back on the calendar.',
    };
  }
  // Renewal: on a paid pack and down to their last (1) or out (0) — pitch the next pack
  // today, before they walk (Zach's case). Carries the re-up talk track.
  if (isPaidSeries(a) && a.sessionsRemaining <= 1) {
    return {
      kind: 'renewal', appt: a, label: 'Renewal', coaching: RE_UP_BEATS,
      why: a.sessionsRemaining <= 0
        ? 'Out of sessions — pitch the next pack today.'
        : 'Last session in the pack — pitch the next one before they walk.',
    };
  }
  // First-timer with no pack yet (a gifted / initial in-person session, not a 15-min
  // discovery call) → after they feel the work, offer the 8-pack.
  if (a.sessionsCompleted === 0 && isFreeSession(a) && !isCall(a)) {
    return {
      kind: 'pitch', appt: a, label: 'Pack pitch',
      why: 'First session — after they feel the work, offer the 8-pack.',
    };
  }
  return null;
}

const ICON: Record<MomentKind, JSX.Element> = {
  renewal: <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />,
  pitch: <Gift className="mt-0.5 h-4 w-4 shrink-0 text-amari-accent-warm" />,
  recovery: <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />,
};

export default function MoneyMoments() {
  const navigate = useNavigate();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    // includeCancelled → so cancelled sessions can surface as a recovery moment.
    getDayData(today, undefined, true)
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
        {moments.map((m, i) => {
          const id = `${m.appt.id}-${i}`;
          const expanded = open === id;
          return (
            <div key={id} className="rounded-lg border border-amari-border bg-white">
              <button
                type="button"
                onClick={() => navigate(memberWorkspacePath(m.appt.contactId, 'session', m.appt.id))}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-amari-light-sand"
              >
                {ICON[m.kind]}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-amari-charcoal">
                    {m.appt.contactName} · <span className="text-amari-accent-warm">{m.label}</span>
                  </span>
                  <span className="block text-xs text-amari-text-muted">{m.why}</span>
                </span>
              </button>
              {m.coaching && (
                <div className="border-t border-amari-border/60 px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : id)}
                    className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} The re-up talk track
                  </button>
                  {expanded && (
                    <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-amari-charcoal">
                      {m.coaching.map((b, j) => <li key={j}>{b}</li>)}
                      <li className="list-none pt-1 text-[11px]  text-amari-text-muted">
                        Wording is technique, not Garrett&apos;s verified voice — say it his way.
                      </li>
                    </ol>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
