import { useState, useEffect, useCallback } from 'react';
import { ListTodo, Plus, Minus, X, Check, Circle, Loader2, Star, Target, Pin } from 'lucide-react';
import { getTasks, mutateTask, ApiError, type StaffDay } from '../lib/api';

// "Garrett's Day" — the directive surface on the Schedule tab. ADHD-shaped:
//  - GOAL line (the why, in his currency: helping people, not revenue)
//  - BOOKED-today counter — the real win to chase; a tap = someone helped
//  - a PINNED RULE (every call ends with a text) — a standing reflex, NOT a
//    checkbox that never completes
//  - short, checkable TASKS with a ⭐ "start here" so there's one obvious move
// Eben + Garrett edit the same shared list; this is NOT auto-fed.
export default function GarrettDay() {
  const [day, setDay] = useState<StaffDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingField, setEditingField] = useState<'goal' | 'rule' | null>(null);
  const [fieldText, setFieldText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDay(await getTasks());
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Every mutation returns the authoritative state, so we just swap it in.
  const run = useCallback(async (input: Parameters<typeof mutateTask>[0]) => {
    setBusy(true);
    try {
      setDay(await mutateTask(input));
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await run({ action: 'add', text });
  };

  const saveTaskEdit = async (id: string) => {
    const text = editText.trim();
    setEditingId(null);
    if (text && text !== day?.tasks.find((t) => t.id === id)?.text) await run({ action: 'edit', id, text });
  };

  const saveField = async (field: 'goal' | 'rule') => {
    const text = fieldText.trim();
    setEditingField(null);
    const current = field === 'goal' ? day?.goal : day?.rule;
    if (text !== current) await run({ action: field === 'goal' ? 'set-goal' : 'set-rule', text });
  };

  const startFieldEdit = (field: 'goal' | 'rule') => {
    setEditingField(field);
    setFieldText((field === 'goal' ? day?.goal : day?.rule) || '');
  };

  if (loading || !day) {
    return (
      <div className="staff-card mb-4 p-4">
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-amari-text-muted" /></div>
      </div>
    );
  }

  // Incomplete first (by creation), done sink to the bottom — quiet, no-guilt.
  const sorted = [...day.tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const doneCount = day.tasks.filter((t) => t.done).length;
  const startHereId = sorted.find((t) => !t.done)?.id; // the one obvious next move

  return (
    <div className="staff-card mb-4 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-amari-accent-warm" />
          <h2 className="text-sm font-semibold text-amari-charcoal">Garrett's Day</h2>
        </div>
        {day.tasks.length > 0 && <span className="text-xs text-amari-text-muted">{doneCount} of {day.tasks.length} done</span>}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {/* GOAL — the why, in his currency. Tap to edit. */}
      <div className="mb-3 flex items-start gap-2">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-amari-accent-warm" />
        {editingField === 'goal' ? (
          <input
            autoFocus value={fieldText}
            onChange={(e) => setFieldText(e.target.value)}
            onBlur={() => saveField('goal')}
            onKeyDown={(e) => { if (e.key === 'Enter') saveField('goal'); if (e.key === 'Escape') setEditingField(null); }}
            className="flex-1 border-b border-amari-accent-warm bg-transparent text-sm font-medium text-amari-charcoal focus:outline-none"
          />
        ) : (
          <span onClick={() => startFieldEdit('goal')} className="flex-1 cursor-text text-sm font-medium text-amari-charcoal">
            {day.goal || <span className="text-amari-text-muted">Set today's goal…</span>}
          </span>
        )}
      </div>

      {/* BOOKED today — the real win. A tap = someone helped. */}
      <div className="mb-3 flex items-center justify-between rounded-xl bg-amari-accent-warm/10 px-3 py-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-amari-text-muted">Booked today</p>
          <p className="text-2xl font-bold leading-none text-amari-charcoal">{day.bookedToday}</p>
        </div>
        <div className="flex items-center gap-2">
          {day.bookedToday > 0 && (
            <button type="button" onClick={() => run({ action: 'booked-dec' })} disabled={busy}
              className="rounded-full border border-amari-border p-1.5 text-amari-text-muted hover:bg-white disabled:opacity-50" aria-label="Undo a booking">
              <Minus className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={() => run({ action: 'booked-inc' })} disabled={busy}
            className="rounded-lg bg-amari-accent-warm px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            +1 booked
          </button>
        </div>
      </div>

      {/* RULE — a standing reflex, pinned, never a checkbox. Tap to edit. */}
      {(day.rule || editingField === 'rule') && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amari-light-sand/60 px-2.5 py-1.5">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amari-text-muted" />
          {editingField === 'rule' ? (
            <input
              autoFocus value={fieldText}
              onChange={(e) => setFieldText(e.target.value)}
              onBlur={() => saveField('rule')}
              onKeyDown={(e) => { if (e.key === 'Enter') saveField('rule'); if (e.key === 'Escape') setEditingField(null); }}
              className="flex-1 border-b border-amari-accent-warm bg-transparent text-xs text-amari-charcoal focus:outline-none"
            />
          ) : (
            <span onClick={() => startFieldEdit('rule')} className="flex-1 cursor-text text-xs text-amari-charcoal">{day.rule}</span>
          )}
        </div>
      )}

      {/* TASKS — checkable, ⭐ start-here on the first undone one. */}
      <ul className="space-y-1">
        {sorted.map((t) => (
          <li key={t.id} className="group flex items-start gap-2">
            <button type="button" onClick={() => run({ action: 'toggle', id: t.id })} disabled={busy}
              className="mt-0.5 shrink-0 text-amari-text-muted hover:text-amari-accent-warm disabled:opacity-50"
              aria-label={t.done ? 'Mark not done' : 'Mark done'}>
              {t.done ? <Check className="h-4 w-4 text-amari-accent-warm" /> : <Circle className="h-4 w-4" />}
            </button>

            {!t.done && t.id === startHereId && (
              <Star className="mt-0.5 h-4 w-4 shrink-0 fill-amari-accent-warm text-amari-accent-warm" aria-label="Start here" />
            )}

            {editingId === t.id ? (
              <input
                autoFocus value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={() => saveTaskEdit(t.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTaskEdit(t.id); if (e.key === 'Escape') setEditingId(null); }}
                className="flex-1 border-b border-amari-accent-warm bg-transparent text-sm text-amari-charcoal focus:outline-none"
              />
            ) : (
              <span onClick={() => { setEditingId(t.id); setEditText(t.text); }}
                className={`flex-1 cursor-text text-sm ${t.done ? 'text-amari-text-muted line-through' : t.id === startHereId ? 'font-medium text-amari-charcoal' : 'text-amari-charcoal'}`}>
                {t.text}
              </span>
            )}

            {t.addedBy && (
              <span className="mt-0.5 shrink-0 rounded-full bg-amari-light-sand px-1.5 text-[10px] text-amari-text-muted">{t.addedBy[0]?.toUpperCase()}</span>
            )}
            <button type="button" onClick={() => run({ action: 'delete', id: t.id })} disabled={busy}
              className="mt-0.5 shrink-0 text-amari-text-muted opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 disabled:opacity-50" aria-label="Delete task">
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {day.tasks.length === 0 && <li className="py-1 text-xs text-amari-text-muted">Nothing yet — add what Garrett's on today.</li>}
      </ul>

      {/* add — one line, one tap */}
      <div className="mt-2 flex items-center gap-2">
        <Plus className="h-4 w-4 shrink-0 text-amari-text-muted" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Add a task…"
          className="flex-1 bg-transparent text-sm text-amari-charcoal placeholder:text-amari-text-muted focus:outline-none"
        />
        {draft.trim() && <button type="button" onClick={add} disabled={busy} className="staff-btn-secondary px-2 py-0.5 text-xs">Add</button>}
      </div>

      {doneCount > 0 && (
        <button type="button" onClick={() => run({ action: 'clear-done' })} disabled={busy}
          className="mt-2 text-[11px] text-amari-text-muted hover:text-amari-charcoal disabled:opacity-50">
          Clear {doneCount} done
        </button>
      )}
    </div>
  );
}
