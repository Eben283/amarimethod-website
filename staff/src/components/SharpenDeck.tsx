import { useState, useEffect, useCallback } from 'react';
import { Zap, Shuffle, ChevronRight, Plus, X, Loader2 } from 'lucide-react';
import { getSharpen, mutateSharpen, ApiError, type SharpenCard, type SharpenCategory } from '../lib/api';

// "Sharpen" — a shuffle-through card DECK on the Schedule/Today tab (not its own
// tab, not a full-screen reel). One card faces up; Next/Shuffle to flick through
// the deck — like riffling index cards. The "scroll this instead of Instagram"
// thing, sitting in the normal page scroll. Content is curated + grown from real
// calls (see staff-sharpen.js); never generic sales-bro filler.

const CHIP: Record<SharpenCategory, { label: string; cls: string }> = {
  frame: { label: 'Framing', cls: 'bg-amari-accent-warm/15 text-amari-charcoal' },
  objection: { label: 'Objection', cls: 'bg-amari-charcoal text-white' },
  discovery: { label: 'Discovery', cls: 'bg-amari-light-sand text-amari-charcoal' },
  close: { label: 'The ask', cls: 'bg-green-100 text-green-800' },
  'real-call': { label: 'From your calls', cls: 'bg-blue-100 text-blue-800' },
};
const CATS = Object.keys(CHIP) as SharpenCategory[];

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Show a small FRESH set each day, not the whole pile — better a few good cards
// than 25 that blur together. A date-seeded shuffle picks today's set (stable
// through the day, different each day), cycling the whole pool over time.
const DAILY_COUNT = 5;
function todaysSet(list: SharpenCard[]): SharpenCard[] {
  if (list.length <= DAILY_COUNT) return list;
  const day = Math.floor(Date.now() / 86_400_000);
  const a = [...list];
  let seed = day + 1;
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, DAILY_COUNT);
}

// Abstract, light, brand-warm backgrounds so each card looks distinct (waves,
// stars, blobs, gradients) — charcoal text stays readable on all of them.
const BACKGROUNDS: string[] = [
  'linear-gradient(135deg,#faf4ec 0%,#f1e2d2 100%)',
  'radial-gradient(circle at 18% 22%, rgba(235,165,132,.20), transparent 45%), radial-gradient(circle at 82% 78%, rgba(235,165,132,.13), transparent 42%), #faf4ec',
  'radial-gradient(1.6px 1.6px at 20% 28%, rgba(58,58,58,.18), transparent 60%), radial-gradient(1.6px 1.6px at 68% 52%, rgba(58,58,58,.13), transparent 60%), radial-gradient(1.6px 1.6px at 44% 80%, rgba(58,58,58,.11), transparent 60%), #f8f2eb',
  'linear-gradient(135deg,#eef2f5 0%,#e3ebf1 100%)',
  'linear-gradient(160deg,#fcf0e6 0%,#f6dac6 100%)',
  'repeating-radial-gradient(circle at 50% -30%, rgba(235,165,132,.10) 0 14px, transparent 14px 30px), #faf4ec',
];
function bgFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BACKGROUNDS[h % BACKGROUNDS.length];
}

export default function SharpenDeck() {
  const [cards, setCards] = useState<SharpenCard[]>([]);
  const [deck, setDeck] = useState<SharpenCard[]>([]);
  const [pos, setPos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ category: SharpenCategory; title: string; body: string }>({ category: 'frame', title: '', body: '' });

  // Deck = today's fresh set (rotates daily), in a shuffled order.
  const reshuffle = useCallback((list: SharpenCard[]) => { setDeck(shuffled(todaysSet(list))); setPos(0); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { cards } = await getSharpen();
      setCards(cards);
      reshuffle(cards);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [reshuffle]);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (input: Parameters<typeof mutateSharpen>[0]) => {
    setBusy(true);
    try {
      const { cards } = await mutateSharpen(input);
      setCards(cards);
      reshuffle(cards);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [reshuffle]);

  const next = () => { if (deck.length) setPos((p) => (p + 1) % deck.length); };

  const addCard = async () => {
    if (!draft.title.trim() && !draft.body.trim()) return;
    await run({ action: 'add', category: draft.category, title: draft.title.trim(), body: draft.body.trim() });
    setDraft({ category: 'frame', title: '', body: '' });
    setAdding(false);
  };

  const card = deck[pos];

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amari-accent-warm" />
          <h2 className="text-sm font-semibold text-amari-charcoal">Sharpen</h2>
          <span className="text-[11px] text-amari-text-muted">— a minute beats scrolling</span>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-amari-border p-1.5 text-amari-text-muted hover:bg-amari-light-sand" aria-label="Add a card">
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {adding && (
        <div className="mb-2 space-y-2 rounded-xl border border-amari-border bg-white p-3">
          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <button key={c} type="button" onClick={() => setDraft((d) => ({ ...d, category: c }))}
                className={`rounded-full px-2 py-0.5 text-[11px] ${draft.category === c ? CHIP[c].cls : 'bg-amari-light-sand/60 text-amari-text-muted'}`}>
                {CHIP[c].label}
              </button>
            ))}
          </div>
          <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Headline (the hook)…"
            className="w-full rounded-lg border border-amari-border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amari-accent-warm" />
          <textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} placeholder="The move / the lesson…" rows={2}
            className="w-full rounded-lg border border-amari-border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amari-accent-warm" />
          <button type="button" onClick={addCard} disabled={busy} className="staff-btn-secondary px-3 py-1 text-xs">Add card</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-amari-text-muted" /></div>
      ) : !card ? (
        <p className="rounded-xl border border-dashed border-amari-border px-4 py-6 text-center text-xs text-amari-text-muted">
          No cards yet — tap + to add one, or we'll seed them from your real calls.
        </p>
      ) : (
        <>
          {/* the card — each gets its own abstract background */}
          <div className="group relative rounded-2xl border border-amari-border p-4 shadow-sm" style={{ background: bgFor(card.id) }}>
            <span className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${CHIP[card.category].cls}`}>{CHIP[card.category].label}</span>
            {card.title && <h3 className="text-base font-semibold leading-snug text-amari-charcoal">{card.title}</h3>}
            {card.body && <p className="mt-2 text-sm leading-relaxed text-amari-text-muted">{card.body}</p>}
            <button type="button" onClick={() => run({ action: 'delete', id: card.id })} disabled={busy}
              className="absolute right-3 top-3 text-amari-text-muted opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" aria-label="Delete card">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* deck controls */}
          <div className="mt-2 flex items-center justify-between">
            <button type="button" onClick={() => reshuffle(cards)} disabled={busy || deck.length < 2}
              className="inline-flex items-center gap-1 text-xs text-amari-text-muted hover:text-amari-charcoal disabled:opacity-40">
              <Shuffle className="h-3.5 w-3.5" /> Shuffle
            </button>
            <span className="text-[11px] text-amari-text-muted">{pos + 1} / {deck.length}</span>
            <button type="button" onClick={next} disabled={deck.length < 2}
              className="inline-flex items-center gap-1 rounded-lg border border-amari-border px-3 py-1.5 text-xs font-medium text-amari-charcoal hover:bg-amari-light-sand disabled:opacity-40">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
