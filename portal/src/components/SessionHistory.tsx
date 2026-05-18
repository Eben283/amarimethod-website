import type { Appointment } from '../types/portal';
import { getMonth, getDay, formatTime, formatDate } from '../lib/utils';

interface SessionHistoryProps {
  appointments: Appointment[];
}

function detectFormat(apt: Appointment): 'Virtual' | 'In-person' {
  const t = (apt.appointmentType || apt.title || '').toLowerCase();
  if (t.includes('virtual') || t.includes('zoom') || t.includes('online')) return 'Virtual';
  return 'In-person';
}

function statusLabel(s: Appointment['status']): { label: string; cls: string } {
  switch (s) {
    case 'completed':
    case 'showed':
      return { label: 'Completed', cls: 'cp-completed' };
    case 'cancelled':
      return { label: 'Cancelled', cls: 'cp-cancelled' };
    case 'no_show':
      return { label: 'Missed', cls: 'cp-noshow' };
    case 'confirmed':
      // Past confirmed = session ran, Garrett didn't mark complete yet
      return { label: 'Completed', cls: 'cp-completed' };
    default:
      return { label: 'Completed', cls: 'cp-completed' };
  }
}

export default function SessionHistory({ appointments }: SessionHistoryProps) {
  // No-shows hidden from client view per Eben's decision (not punitive).
  const visible = appointments.filter(a => a.status !== 'no_show');
  const completedCount = visible.filter(a => a.status === 'completed' || a.status === 'showed' || a.status === 'confirmed').length;

  return (
    <section className="cp-history">
      <div className="cp-section-head">
        <h3 className="cp-section-h">Session history</h3>
        <span className="cp-mono">
          {visible.length === 0
            ? 'None yet'
            : `${completedCount} session${completedCount === 1 ? '' : 's'}`}
        </span>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: '28px 24px', textAlign: 'center', color: 'var(--cp-mute)', fontSize: 13 }}>
          Your past sessions will appear here.
        </div>
      ) : (
        <ul className="cp-hist-rows">
          {visible.slice(0, 10).map((appt) => {
            const status = statusLabel(appt.status);
            const format = detectFormat(appt);
            return (
              <li key={appt.id} className="cp-hist-row">
                <div className="cp-date">
                  <span className="cp-date-m">{getMonth(appt.startTime)}</span>
                  <span className="cp-date-d">{getDay(appt.startTime)}</span>
                </div>
                <div className="cp-hist-body">
                  <span className="cp-hist-title">{appt.title || appt.appointmentType || 'Session'}</span>
                  <span className="cp-hist-meta">{formatDate(appt.startTime)} · {formatTime(appt.startTime)} · {format}</span>
                </div>
                <div className="cp-hist-right">
                  <span className={'cp-status ' + status.cls}>{status.label}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
