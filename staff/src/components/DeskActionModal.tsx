import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { ApiError, searchContacts, sendPayLink, sendReceipt, type PayLinkProduct } from '../lib/api';
import type { ContactListItem } from '../types/staff';

const PRODUCTS: { id: PayLinkProduct; label: string; price: string }[] = [
  { id: '8-session-series', label: '8-Pack', price: '$1,295' },
  { id: '4-session-series', label: '4-Pack', price: '$720' },
  { id: 'initial-in-person', label: 'Initial — In Person', price: '$225' },
  { id: 'initial-virtual', label: 'Initial — Virtual', price: '$225' },
  { id: 'follow-up', label: 'Follow-up', price: '$190' },
  { id: 'living-practice', label: 'Living Practice', price: '$347' },
];

type Mode = 'paylink' | 'receipt';

type Props = {
  mode: Mode;
  contactId?: string | null;
  contactName?: string | null;
  onClose: () => void;
};

export default function DeskActionModal({ mode, contactId: initialId = null, contactName: initialName = null, onClose }: Props) {
  const [contactId, setContactId] = useState<string | null>(initialId);
  const [contactName, setContactName] = useState(initialName || '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!query.trim() || contactId) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchContacts(query.trim())); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, contactId]);

  async function sendProduct(product: PayLinkProduct) {
    if (!contactId || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await sendPayLink(contactId, product);
      setStatus('Pay link sent by text.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send pay link.');
    } finally { setBusy(false); }
  }

  async function sendRec(channel: 'sms' | 'email') {
    if (!contactId || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await sendReceipt(contactId, channel);
      setStatus(channel === 'email' ? 'Receipt emailed.' : 'Receipt texted.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send receipt.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40 border-0" aria-label="Close" onClick={onClose} />
      <section className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amari-text-muted">Staff desk</p>
            <h2 className="text-xl font-semibold tracking-tight">{mode === 'paylink' ? 'Send pay link' : 'Resend receipt'}</h2>
          </div>
          <button type="button" className="p-1 text-amari-text-muted" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {!contactId ? (
          <div>
            <div className="flex items-center gap-2 rounded-xl border border-amari-border px-3">
              <Search size={16} className="text-amari-text-muted" />
              <input className="min-h-11 flex-1 border-0 outline-none" placeholder="Search person…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </div>
            {searching && <p className="mt-2 text-sm text-amari-text-muted"><Loader2 className="inline animate-spin" size={14} /> Searching…</p>}
            <ul className="mt-2 space-y-1">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-amari-border px-3 py-2 text-left"
                    onClick={() => {
                      setContactId(c.id);
                      setContactName(c.name || c.email || c.id);
                      setQuery('');
                      setResults([]);
                    }}
                  >
                    <strong className="block">{c.name || 'No name'}</strong>
                    <span className="text-xs text-amari-text-muted">{c.email || c.phone || c.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <div>
                <span className="text-[11px] text-amari-text-muted">For</span>
                <strong className="block">{contactName}</strong>
              </div>
              {!initialId && (
                <button type="button" className="text-sm font-semibold text-amari-lake" onClick={() => { setContactId(null); setContactName(''); setStatus(''); }}>
                  Change
                </button>
              )}
            </div>

            {error && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {status && <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{status}</div>}

            {mode === 'paylink' ? (
              <div className="space-y-2">
                {PRODUCTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void sendProduct(p.id)}
                    className="flex w-full items-center justify-between rounded-xl border border-amari-border px-3 py-2.5 text-left disabled:opacity-50"
                  >
                    <span className="font-semibold">{p.label}</span>
                    <span className="text-sm text-amari-text-muted">{p.price}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void sendRec('sms')} className="flex-1 rounded-xl bg-amari-charcoal px-3 py-3 font-semibold text-white disabled:opacity-50">
                  {busy ? 'Sending…' : 'Text receipt'}
                </button>
                <button type="button" disabled={busy} onClick={() => void sendRec('email')} className="flex-1 rounded-xl border border-amari-border px-3 py-3 font-semibold disabled:opacity-50">
                  Email receipt
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
