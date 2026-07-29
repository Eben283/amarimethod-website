import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarPlus, Check, ChevronLeft, ExternalLink, FileText,
  Link2, Loader2, RefreshCw, UserRound,
} from 'lucide-react';
import { dismissException, getExceptions, ApiError, type TriageItem } from '../lib/api';
import BookForSomeoneModal from '../components/BookForSomeoneModal';
import DeskActionModal from '../components/DeskActionModal';

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

function defaultSessionType(item: TriageItem) {
  const hay = `${item.title} ${item.product || ''}`.toLowerCase();
  if (hay.includes('partner')) return 'partner_initial';
  if (hay.includes('assessment')) return 'assessment';
  if (hay.includes('follow')) return 'followup_package_in_person';
  return 'assessment';
}

export default function TriagePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TriageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState<{ contactId?: string; contactName?: string; sessionType?: string } | null>(null);
  const [deskAction, setDeskAction] = useState<{ mode: 'paylink' | 'receipt'; contactId?: string; contactName?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getExceptions();
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load desk');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
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
      <button type="button" onClick={() => navigate('/')} className="mb-4 inline-flex items-center gap-1 text-sm text-amari-text-muted">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Operations
      </button>

      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amari-lake">Staff desk</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-amari-charcoal">This morning</h1>
        <p className="mt-1 text-sm text-amari-text-muted">
          Always-on staff moves, plus breaks the system already caught.
        </p>
      </header>

      <section className="mb-5 rounded-2xl border border-amari-border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-amari-charcoal">Always available</h2>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setBookOpen({})} className="rounded-xl border border-amari-border bg-slate-50 px-3 py-3 text-left">
            <CalendarPlus className="mb-1 h-4 w-4 text-amari-lake" aria-hidden="true" />
            <strong className="block text-sm">Book for someone</strong>
            <span className="text-xs text-amari-text-muted">Email / text / front desk</span>
          </button>
          <button type="button" onClick={() => setDeskAction({ mode: 'paylink' })} className="rounded-xl border border-amari-border bg-slate-50 px-3 py-3 text-left">
            <Link2 className="mb-1 h-4 w-4 text-amari-lake" aria-hidden="true" />
            <strong className="block text-sm">Send pay link</strong>
            <span className="text-xs text-amari-text-muted">They couldn’t finish checkout</span>
          </button>
          <button type="button" onClick={() => setDeskAction({ mode: 'receipt' })} className="rounded-xl border border-amari-border bg-slate-50 px-3 py-3 text-left">
            <FileText className="mb-1 h-4 w-4 text-amari-lake" aria-hidden="true" />
            <strong className="block text-sm">Resend receipt</strong>
            <span className="text-xs text-amari-text-muted">PDF / email issues</span>
          </button>
          <button type="button" onClick={() => navigate('/clients')} className="rounded-xl border border-amari-border bg-slate-50 px-3 py-3 text-left">
            <UserRound className="mb-1 h-4 w-4 text-amari-lake" aria-hidden="true" />
            <strong className="block text-sm">Open person</strong>
            <span className="text-xs text-amari-text-muted">Search contacts</span>
          </button>
        </div>
      </section>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-amari-charcoal">Needs you</h2>
          <p className="text-sm text-amari-text-muted">{items.length} open break{items.length === 1 ? '' : 's'}</p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); void load(); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-amari-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-amari-border bg-white px-5 py-10 text-center">
          <Check className="mx-auto mb-2 h-6 w-6 text-emerald-600" aria-hidden="true" />
          <p className="font-medium text-amari-charcoal">No breaks waiting</p>
          <p className="mt-1 text-sm text-amari-text-muted">Use the buttons above for email / text booking and receipts.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className={`rounded-2xl border px-4 py-3.5 ${kindClass(item.kind)}`}>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-amari-text-muted">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{item.kind}</span>
                {item.at && <span>· {agoLabel(item.at)}</span>}
              </div>
              <h3 className="mt-1 text-[1.02rem] font-semibold leading-snug text-amari-charcoal">{item.title}</h3>
              <p className="mt-1 text-sm text-amari-text-muted">{item.blurb}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.contactId && /no appointment|auto-book/i.test(`${item.title} ${item.blurb}`) && (
                  <button
                    type="button"
                    onClick={() => setBookOpen({
                      contactId: item.contactId || undefined,
                      sessionType: defaultSessionType(item),
                    })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amari-charcoal px-3 py-2 text-sm font-semibold text-white"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Book them
                  </button>
                )}
                {item.contactId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/client/${item.contactId}`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
                  >
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    Open person
                  </button>
                )}
                {item.contactId && (
                  <a
                    href={ghlContactUrl(item.contactId)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium"
                  >
                    Open GHL <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void dismiss(item)}
                  className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm font-medium text-amari-text-muted disabled:opacity-50"
                >
                  {busyId === item.id ? 'Saving…' : 'Mark handled'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {bookOpen && (
        <BookForSomeoneModal
          contactId={bookOpen.contactId}
          contactName={bookOpen.contactName}
          defaultSessionType={bookOpen.sessionType || 'assessment'}
          onClose={() => setBookOpen(null)}
          onBooked={() => { void load(); }}
        />
      )}
      {deskAction && (
        <DeskActionModal
          mode={deskAction.mode}
          contactId={deskAction.contactId}
          contactName={deskAction.contactName}
          onClose={() => setDeskAction(null)}
        />
      )}
    </main>
  );
}
