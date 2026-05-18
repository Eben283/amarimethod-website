import { useEffect, useState } from 'react';
import { cancelAppointment } from '../lib/api';
import type { Appointment } from '../types/portal';

interface Props {
  appointment: Appointment;
  onClose: () => void;
  onSuccess: () => void;
}

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
}

function formatDateLine(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function CancelModal({ appointment, onClose, onSuccess }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const hrs = hoursUntil(appointment.startTime);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await cancelAppointment(appointment.id, appointment.title || 'Session');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="cp-screen cp-with-modal" style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div className="cp-modal-scrim" onClick={submitting ? undefined : onClose} aria-hidden="true" />
      <div className="cp-modal cp-modal-sm" role="dialog" aria-label="Cancel session">
        <header className="cp-modal-head">
          <div>
            <span className="cp-mono">Cancel</span>
            <h2 className="cp-modal-title">Cancel <em>{appointment.title || 'this session'}</em>?</h2>
          </div>
          <button type="button" className="cp-modal-close" aria-label="Close" onClick={onClose} disabled={submitting}>✕</button>
        </header>

        <div className="cp-modal-body">
          <p className="cp-modal-prose">You're cancelling <b>{formatDateLine(appointment.startTime)}</b> with Dr. Garrett.</p>
          <p className="cp-modal-prose">
            {hrs >= 24
              ? "You're more than 24 hours out, so there's no charge. If your schedule changed, rescheduling is usually the better option."
              : hrs >= 2
                ? "Within 24 hours of the session — a 50% charge applies. If you can't make it, let Dr. Garrett know directly so we can sort it out."
                : "Within 2 hours of the session — the full fee applies. Email Dr. Garrett directly if something urgent came up."}
          </p>

          <div className="cp-modal-policy">
            <div><span className="cp-policy-glyph">→</span><span><b>More than 24hrs out</b><span>No charge.</span></span></div>
            <div><span className="cp-policy-glyph">→</span><span><b>Within 24hrs</b><span>50% of the session fee.</span></span></div>
            <div><span className="cp-policy-glyph">→</span><span><b>Within 2hrs / no-show</b><span>Full session fee.</span></span></div>
          </div>

          <label className="cp-modal-reason">
            <span className="cp-mono">Tell Dr. Garrett why <span className="cp-mute">· optional</span></span>
            <textarea
              rows={3}
              placeholder="Travel, conflict, feeling worse — anything helps."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            />
          </label>

          {error && (
            <p style={{ color: 'var(--cp-err)', fontSize: 13, lineHeight: 1.5 }}>{error}</p>
          )}
        </div>

        <footer className="cp-modal-foot">
          <button type="button" className="cp-btn cp-btn-ghost" onClick={onClose} disabled={submitting}>Keep the session</button>
          <button type="button" className="cp-btn cp-btn-danger" onClick={handleConfirm} disabled={submitting}>
            <span>{submitting ? 'Cancelling…' : 'Cancel session'}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
