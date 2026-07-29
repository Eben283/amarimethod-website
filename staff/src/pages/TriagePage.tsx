import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Check, ChevronLeft, ExternalLink, Loader2, RefreshCw, UserRound,
} from 'lucide-react';
import { dismissException, getExceptions, ApiError, type TriageItem } from '../lib/api';

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

function agoLabel(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function kindClass(kind: TriageItem['kind']) {
  if (kind === 'break') return 'border-red-200 bg-red-50/70';
  if (kind === 'money') return 'border-amber-200 bg-amber-50/60';
  return 'border-amari-border bg-white';
}

export default function TriagePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TriageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getExceptions();
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load triage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  async function dismiss(item: TriageItem) {
    setBusyId(item.id);
    try {
      await dismissException(item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark handled');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-16">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="mb-4 inline-flex items-center gap-1 text-sm text-amari-text-muted"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Operations
      </button>

      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amari-lake">Staff triage</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-amari-charcoal">Needs you</h1>
        <p className="mt-1 text-sm text-amari-text-muted">
          Production breaks that already wrote an alert — plain English, then open or mark handled.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { setLoading(true); void load(); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => navigate('/balances')}
          className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
        >
          Balances
        </button>
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
        >
          Clients
        </button>
        <button
          type="button"
          onClick={() => navigate('/pos')}
          className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
        >
          POS
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 py-16 justify-center text-amari-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-amari-border bg-white px-5 py-10 text-center">
          <Check className="mx-auto mb-2 h-6 w-6 text-emerald-600" aria-hidden="true" />
          <p className="font-medium text-amari-charcoal">Nothing in the break inbox</p>
          <p className="mt-1 text-sm text-amari-text-muted">
            When a payment or fulfill step fails in production, it shows up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className={`rounded-2xl border px-4 py-3.5 ${kindClass(item.kind)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-amari-text-muted">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{item.kind}</span>
                    {item.at && <span>· {agoLabel(item.at)}</span>}
                  </div>
                  <h2 className="mt-1 text-[1.02rem] font-semibold leading-snug text-amari-charcoal">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-sm text-amari-text-muted">{item.blurb}</p>
                  <p className="mt-1 text-xs text-amari-text-muted/80">{item.source}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.actions.includes('open_client') && item.contactId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/client/${item.contactId}`)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amari-charcoal px-3 py-2 text-sm font-semibold text-white"
                  >
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    Open person
                  </button>
                )}
                {item.actions.includes('open_ghl') && item.contactId && (
                  <a
                    href={ghlContactUrl(item.contactId)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
                  >
                    Open GHL <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
                {item.actions.includes('open_balances') && (
                  <button
                    type="button"
                    onClick={() => navigate('/balances')}
                    className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
                  >
                    Balances
                  </button>
                )}
                {item.actions.includes('open_pos') && (
                  <button
                    type="button"
                    onClick={() => navigate('/pos')}
                    className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
                  >
                    POS
                  </button>
                )}
                {item.actions.includes('dismiss') && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void dismiss(item)}
                    className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium text-amari-text-muted disabled:opacity-50"
                  >
                    {busyId === item.id ? 'Saving…' : 'Mark handled'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
