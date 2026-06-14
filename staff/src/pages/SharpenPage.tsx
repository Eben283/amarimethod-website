import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, X, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getSharpen, mutateSharpen, ApiError, type SharpenCard, type SharpenCategory } from '../lib/api';

// "Sharpen" — bite-sized, scroll-this-instead-of-Instagram card feed for getting
// better at the CALL (framing, objections, discovery, the ask). One card per
// screen, snap-scroll. Content is curated (locked positioning + technique + real
// calls), grown in the morning loop — never generic sales-bro filler.

const CATS: { value: SharpenCategory; label: string; chip: string }[] = [
  { value: 'frame', label: 'Framing', chip: 'bg-amari-accent-warm/15 text-amari-charcoal' },
  { value: 'objection', label: 'Objection', chip: 'bg-amari-charcoal text-white' },
  { value: 'discovery', label: 'Discovery', chip: 'bg-amari-light-sand text-amari-charcoal' },
  { value: 'close', label: 'The ask', chip: 'bg-green-100 text-green-800' },
  { value: 'real-call', label: 'From your calls', chip: 'bg-blue-100 text-blue-800' },
];
const chipFor = (c: SharpenCategory) => CATS.find((x) => x.value === c) ?? CATS[0];

export default function SharpenPage() {
  const { logout } = useAuth();
  const [cards, setCards] = useState<SharpenCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ category: SharpenCategory; title: string; body: string }>({ category: 'frame', title: '', body: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCards((await getSharpen()).cards);
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof ApiError ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (input: Parameters<typeof mutateSharpen>[0]) => {
    setBusy(true);
    try {
      setCards((await mutateSharpen(input)).cards);
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [logout]);

  const addCard = async () => {
    if (!draft.title.trim() && !draft.body.trim()) return;
    await run({ action: 'add', category: draft.category, title: draft.title.trim(), body: draft.body.trim() });
    setDraft({ category: 'frame', title: '', body: '' });
    setAdding(false);
  };

  return (
    <div className="flex h-[calc(100dvh-4.5rem)] flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amari-accent-warm" />
          <div>
            <h1 className="text-lg font-semibold text-amari-charcoal">Sharpen</h1>
            <p className="text-[11px] text-amari-text-muted">2 min here beats 2 min scrolling — get better at the calls.</p>
          </div>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-amari-border p-2 text-amari-text-muted hover:bg-amari-light-sand" aria-label="Add a card">
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}

      {adding && (
        <div className="mx-4 mb-2 space-y-2 rounded-xl border border-amari-border bg-white p-3">
          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <button key={c.value} type="button" onClick={() => setDraft((d) => ({ ...d, category: c.value }))}
                className={`rounded-full px-2 py-0.5 text-[11px] ${draft.category === c.value ? c.chip : 'bg-amari-light-sand/60 text-amari-text-muted'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Headline (the hook)…"
            className="w-full rounded-lg border border-amari-border px-2 py-1.5 text-sm text-amari-charcoal focus:outline-none focus:ring-1 focus:ring-amari-accent-warm" />
          <textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder="The move / the lesson…" rows={3}
            className="w-full rounded-lg border border-amari-border px-2 py-1.5 text-sm text-amari-charcoal focus:outline-none focus:ring-1 focus:ring-amari-accent-warm" />
          <button type="button" onClick={addCard} disabled={busy} className="staff-btn-secondary px-3 py-1 text-xs">Add card</button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-amari-text-muted" /></div>
      ) : cards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-amari-text-muted">
          No cards yet. Tap + to add one — or we'll seed them from your real calls.
        </div>
      ) : (
        <div className="flex-1 snap-y snap-mandatory overflow-y-auto">
          {cards.map((c) => {
            const cat = chipFor(c.category);
            return (
              <section key={c.id} className="group relative flex min-h-[60vh] snap-start flex-col justify-center px-6 py-8">
                <span className={`mb-3 w-fit rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cat.chip}`}>{cat.label}</span>
                {c.title && <h2 className="text-xl font-semibold leading-snug text-amari-charcoal">{c.title}</h2>}
                {c.body && <p className="mt-3 text-base leading-relaxed text-amari-text-muted">{c.body}</p>}
                <button type="button" onClick={() => run({ action: 'delete', id: c.id })} disabled={busy}
                  className="absolute right-4 top-6 text-amari-text-muted opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" aria-label="Delete card">
                  <X className="h-4 w-4" />
                </button>
              </section>
            );
          })}
          <div className="h-8" />
        </div>
      )}
    </div>
  );
}
