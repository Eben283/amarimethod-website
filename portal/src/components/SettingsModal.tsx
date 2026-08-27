import { useEffect, useState, type CSSProperties } from 'react';
import { updateReminderPreference, ApiError } from '../lib/api';

type Pref = 'all' | 'some' | 'none';

const OPTIONS: { value: Pref; label: string; desc: string }[] = [
  { value: 'all', label: 'All reminders', desc: 'A confirmation, a reminder the day before, and reminders an hour before by email and text.' },
  { value: 'some', label: 'Just the important one', desc: 'A confirmation, plus a single text reminder an hour before your session.' },
  { value: 'none', label: 'No reminders', desc: "Only your booking confirmation. You'll keep track of the rest." },
];

interface Props {
  current: Pref;
  onClose: () => void;
  onSaved: () => void;
}

const optionStyle = (selected: boolean): CSSProperties => ({
  textAlign: 'left',
  padding: '14px 16px',
  borderRadius: 10,
  cursor: 'pointer',
  border: selected ? '2px solid #EBA584' : '1px solid rgba(0,0,0,0.15)',
  background: selected ? 'rgba(235,165,132,0.08)' : '#fff',
  width: '100%',
});

export default function SettingsModal({ current, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<Pref>(current);
  const [saving, setSaving] = useState<Pref | null>(null);
  const [savedValue, setSavedValue] = useState<Pref | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function choose(value: Pref) {
    setError(null);
    setSaving(value);
    try {
      await updateReminderPreference(value);
      setSelected(value);
      setSavedValue(value);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="cp-screen cp-with-modal" style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div className="cp-modal-scrim" onClick={saving ? undefined : onClose} aria-hidden="true" />
      <div className="cp-modal cp-modal-sm" role="dialog" aria-label="Reminder settings">
        <header className="cp-modal-head">
          <div>
            <span className="cp-mono">Reminders</span>
            <h2 className="cp-modal-title">Appointment reminders</h2>
          </div>
          <button type="button" className="cp-modal-close" aria-label="Close" onClick={onClose} disabled={!!saving}>✕</button>
        </header>
        <div className="cp-modal-body">
          <p className="cp-modal-prose">
            How many reminders would you like before each session? This only changes reminders —
            you'll still get receipts and important messages.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {OPTIONS.map((o) => {
              const isSel = selected === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => choose(o.value)}
                  disabled={!!saving}
                  style={optionStyle(isSel)}
                  data-testid={`reminder-${o.value}`}
                >
                  <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{o.label}</span>
                    {saving === o.value ? (
                      <span style={{ fontSize: 13, opacity: 0.6 }}>Saving…</span>
                    ) : savedValue === o.value ? (
                      <span style={{ fontSize: 13, color: '#3a7d44' }}>Saved ✓</span>
                    ) : isSel ? (
                      <span style={{ fontSize: 13, opacity: 0.6 }}>Current</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4, fontWeight: 400 }}>{o.desc}</div>
                </button>
              );
            })}
          </div>
          {error && <p style={{ color: 'var(--cp-err)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
