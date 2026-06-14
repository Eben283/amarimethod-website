import { useState, useEffect, useCallback } from 'react';
import { ListTodo, Plus, X, Check, Circle, Loader2 } from 'lucide-react';
import { getTasks, mutateTask, ApiError, type StaffTask } from '../lib/api';

// "Garrett's Day" — the manually-curated directive list on the Schedule tab.
// ADHD-friendly on purpose: short, one tap to done, edit in place, forgiving
// (done items drop to the bottom + a one-tap "clear done"), minimal controls.
// Eben + Garrett edit the same shared list; this is NOT auto-fed.
export default function GarrettDay() {
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { tasks } = await getTasks();
      setTasks(tasks);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Every mutation returns the authoritative list, so we just swap it in.
  const run = useCallback(async (input: Parameters<typeof mutateTask>[0]) => {
    setBusy(true);
    try {
      const { tasks } = await mutateTask(input);
      setTasks(tasks);
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

  const saveEdit = async (id: string) => {
    const text = editText.trim();
    setEditingId(null);
    if (text && text !== tasks.find((t) => t.id === id)?.text) {
      await run({ action: 'edit', id, text });
    }
  };

  // Incomplete first (by creation), done sink to the bottom — the quiet,
  // no-guilt roll-over.
  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="staff-card mb-4 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-amari-accent-warm" />
          <h2 className="text-sm font-semibold text-amari-charcoal">Garrett's Day</h2>
        </div>
        {tasks.length > 0 && (
          <span className="text-xs text-amari-text-muted">
            {doneCount} of {tasks.length} done
          </span>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-amari-text-muted" /></div>
      ) : (
        <ul className="space-y-1">
          {sorted.map((t) => (
            <li key={t.id} className="group flex items-start gap-2">
              <button
                type="button"
                onClick={() => run({ action: 'toggle', id: t.id })}
                disabled={busy}
                className="mt-0.5 shrink-0 text-amari-text-muted hover:text-amari-accent-warm disabled:opacity-50"
                aria-label={t.done ? 'Mark not done' : 'Mark done'}
              >
                {t.done
                  ? <Check className="h-4 w-4 text-amari-accent-warm" />
                  : <Circle className="h-4 w-4" />}
              </button>

              {editingId === t.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => saveEdit(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(t.id); if (e.key === 'Escape') setEditingId(null); }}
                  className="flex-1 border-b border-amari-accent-warm bg-transparent text-sm text-amari-charcoal focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => { setEditingId(t.id); setEditText(t.text); }}
                  className={`flex-1 cursor-text text-sm ${t.done ? 'text-amari-text-muted line-through' : 'text-amari-charcoal'}`}
                >
                  {t.text}
                </span>
              )}

              {/* who added — tiny, so the morning review knows whose item it is */}
              {t.addedBy && (
                <span className="mt-0.5 shrink-0 rounded-full bg-amari-light-sand px-1.5 text-[10px] text-amari-text-muted">
                  {t.addedBy[0]?.toUpperCase()}
                </span>
              )}
              <button
                type="button"
                onClick={() => run({ action: 'delete', id: t.id })}
                disabled={busy}
                className="mt-0.5 shrink-0 text-amari-text-muted opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 disabled:opacity-50"
                aria-label="Delete task"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}

          {tasks.length === 0 && (
            <li className="py-1 text-xs text-amari-text-muted">Nothing yet — add what Garrett's on today.</li>
          )}
        </ul>
      )}

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
        {draft.trim() && (
          <button type="button" onClick={add} disabled={busy} className="staff-btn-secondary px-2 py-0.5 text-xs">Add</button>
        )}
      </div>

      {doneCount > 0 && (
        <button
          type="button"
          onClick={() => run({ action: 'clear-done' })}
          disabled={busy}
          className="mt-2 text-[11px] text-amari-text-muted hover:text-amari-charcoal disabled:opacity-50"
        >
          Clear {doneCount} done
        </button>
      )}
    </div>
  );
}
