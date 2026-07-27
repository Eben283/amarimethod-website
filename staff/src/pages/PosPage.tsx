import { ArrowLeft, Check, Loader2, Plus, Save, Search, Send, ShoppingBag, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, createPosSale, getPosSale, previewPosCheckoutText, savePosSale, searchContacts, type PosClient, type PosDraftLineInput, type PosPaymentLegInput, type PosPaymentMethod, type PosSale, type PosTextPreview } from '../lib/api';
import type { ContactListItem } from '../types/staff';

const CATALOG = [
  ['initial-in-person', 'Initial — in person', 22500], ['initial-virtual', 'Initial — virtual', 22500],
  ['4-session-series', '4-session series', 72000], ['8-session-series', '8-session series', 129500],
  ['12-week-practice', '12-week practice', 550000], ['upgrade-initial-to-4', 'Initial → 4 upgrade', 49500],
  ['upgrade-initial-to-8', 'Initial → 8 upgrade', 107000], ['upgrade-4-to-8', '4 → 8 upgrade', 57500],
  ['living-practice', 'Living Practice', 34700], ['follow-up', 'Single follow-up', 19000],
] as const;

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const draftStorageKey = 'amari_staff_pos_draft';

function toDraftCart(sale: PosSale): PosDraftLineInput[] {
  return sale.cart.map((line) => line.kind === 'catalog'
    ? { productKey: line.productKey || undefined, quantity: line.quantity }
    : { customLabel: line.label, customReason: line.reason || '', customAmountCents: line.unitAmountCents, quantity: line.quantity });
}

function toDraftLegs(sale: PosSale): PosPaymentLegInput[] {
  return sale.paymentLegs.map(({ method, amountCents }) => ({ method, amountCents }));
}

function calculateTotal(cart: PosDraftLineInput[]) {
  return cart.reduce((sum, line) => {
    const price = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[2] || 0 : line.customAmountCents || 0;
    return sum + price * (line.quantity || 1);
  }, 0);
}

export default function PosPage() {
  const navigate = useNavigate();
  const [clientSearch, setClientSearch] = useState('');
  const [matches, setMatches] = useState<ContactListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<PosClient | null>(null);
  const [cart, setCart] = useState<PosDraftLineInput[]>([]);
  const [legs, setLegs] = useState<PosPaymentLegInput[]>([]);
  const [sale, setSale] = useState<PosSale | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [customDollars, setCustomDollars] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<PosTextPreview | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const total = useMemo(() => calculateTotal(cart), [cart]);
  const allocation = useMemo(() => legs.reduce((sum, leg) => sum + (Number(leg.amountCents) || 0), 0), [legs]);

  useEffect(() => {
    const id = localStorage.getItem(draftStorageKey);
    if (!id) return;
    void getPosSale(id).then(({ sale: loaded }) => {
      setSale(loaded); setClient(loaded.client); setCart(toDraftCart(loaded)); setLegs(toDraftLegs(loaded));
    }).catch(() => localStorage.removeItem(draftStorageKey));
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (clientSearch.trim().length < 2) { setMatches([]); return; }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      void searchContacts(clientSearch.trim()).then(setMatches).catch(() => setMatches([])).finally(() => setSearching(false));
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [clientSearch]);

  function selectClient(contact: ContactListItem) {
    setClient({ id: contact.id, name: contact.name, phone: contact.phone || null });
    setClientSearch(''); setMatches([]); setNotice('');
  }

  function addCatalog(productKey: string) {
    setCart((current) => [...current, { productKey, quantity: 1 }]); setPreview(null);
  }

  function addCustom() {
    const amountCents = Math.round(Number(customDollars) * 100);
    if (!customLabel.trim() || !customReason.trim() || !Number.isSafeInteger(amountCents) || amountCents < 1) { setNotice('Add a label, category/reason, and valid custom dollar amount.'); return; }
    setCart((current) => [...current, { customLabel: customLabel.trim(), customReason: customReason.trim(), customAmountCents: amountCents, quantity: 1 }]);
    setCustomLabel(''); setCustomReason(''); setCustomDollars(''); setNotice(''); setPreview(null);
  }

  function updateQuantity(index: number, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return;
    setCart((current) => current.map((line, i) => i === index ? { ...line, quantity } : line)); setPreview(null);
  }

  function removeLine(index: number) { setCart((current) => current.filter((_, i) => i !== index)); setPreview(null); }

  function setPrimaryAllocation(method: PosPaymentMethod) {
    setLegs(total ? [{ method, amountCents: total }] : []); setPreview(null);
  }

  function addSplitAllocation() {
    setLegs((current) => {
      if (!total || current.length >= 6) return current;
      if (!current.length) return [{ method: 'hsa-card', amountCents: 0 }, { method: 'checkout-link', amountCents: total }];
      const currentlyAllocated = current.reduce((sum, leg) => sum + (Number(leg.amountCents) || 0), 0);
      return [...current, { method: 'checkout-link', amountCents: Math.max(total - currentlyAllocated, 0) }];
    });
    setPreview(null);
  }

  async function saveDraft() {
    if (!client) { setNotice('Select a client before saving the cart.'); return; }
    if (!cart.length) { setNotice('Add at least one item to the cart.'); return; }
    if (legs.length && allocation !== total) { setNotice('Payment allocations must equal the total before saving.'); return; }
    setBusy(true); setNotice('');
    try {
      const result = sale
        ? await savePosSale({ id: sale.id, version: sale.version, client, cart, paymentLegs: legs })
        : await createPosSale({ client, cart, paymentLegs: legs });
      setSale(result.sale); localStorage.setItem(draftStorageKey, result.sale.id); setNotice('Saved cart. No payment or message has been created.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this cart.');
    } finally { setBusy(false); }
  }

  async function prepareText() {
    if (!sale) { setNotice('Save the cart first so the checkout text has an audit record.'); return; }
    setBusy(true); setNotice('');
    try {
      const result = await previewPosCheckoutText(sale.id);
      setSale(result.sale); setPreview(result.preview); setNotice('Preview recorded. Sending remains disabled.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not prepare the text preview.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div><button type="button" onClick={() => navigate('/')} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-amari-text-secondary"><ArrowLeft size={15} /> Operations</button><p className="staff-mlabel">Internal draft checkout</p><h1 className="mt-2 text-4xl text-amari-charcoal">Staff POS</h1><p className="mt-2 max-w-xl text-sm text-amari-text-secondary">Build and save a precise cart now. Payments and checkout texts remain inactive until separately approved.</p></div>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-800">Inactive</span>
      </header>

      {notice && <div className="mb-4 rounded-xl border border-amari-border bg-white px-4 py-3 text-sm text-amari-text-secondary">{notice}</div>}
      <section className="staff-card mb-4"><p className="staff-mlabel">1 · Client</p>{client ? <div className="mt-3 flex items-center justify-between gap-3"><div><strong className="block text-amari-charcoal">{client.name}</strong><span className="text-xs text-amari-text-muted">{client.phone || 'No phone on record'}</span></div><button type="button" onClick={() => setClient(null)} className="text-xs font-semibold text-amari-accent-warm">Change</button></div> : <><div className="relative mt-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-amari-text-muted" size={17} /><input className="staff-input pl-9" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search an existing client" autoComplete="off" /></div>{searching && <p className="mt-2 text-xs text-amari-text-muted">Searching…</p>}{matches.length > 0 && <div className="mt-2 divide-y divide-amari-border rounded-lg border border-amari-border">{matches.map((contact) => <button type="button" key={contact.id} onClick={() => selectClient(contact)} className="flex w-full items-center justify-between px-3 py-3 text-left hover:bg-amari-light-sand"><span><strong className="block text-sm">{contact.name}</strong><small className="text-amari-text-muted">{contact.phone || contact.email || 'No contact detail'}</small></span><Plus size={16} /></button>)}</div>}</>}</section>

      <section className="staff-card mb-4"><p className="staff-mlabel">2 · Catalog</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{CATALOG.map(([key, label, amount]) => <button key={key} type="button" onClick={() => addCatalog(key)} className="flex items-center justify-between rounded-xl border border-amari-border bg-white px-3 py-3 text-left hover:bg-amari-light-sand"><span className="text-sm font-semibold text-amari-charcoal">{label}</span><span className="text-sm text-amari-text-secondary">{money(amount)}</span></button>)}</div><div className="mt-4 grid gap-2 border-t border-amari-border pt-4 sm:grid-cols-2"><input className="staff-input" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="Custom amount label" /><input className="staff-input" value={customReason} onChange={(event) => setCustomReason(event.target.value)} placeholder="Category or reason" /><input className="staff-input" inputMode="decimal" value={customDollars} onChange={(event) => setCustomDollars(event.target.value)} placeholder="$0.00" /><button type="button" onClick={addCustom} className="staff-btn-secondary"><Plus size={16} /> Add</button></div></section>

      <section className="staff-card mb-4"><div className="flex items-end justify-between gap-4"><div><p className="staff-mlabel">3 · Cart</p><h2 className="mt-1 text-xl text-amari-charcoal">{cart.length ? `${cart.length} item${cart.length === 1 ? '' : 's'}` : 'No items yet'}</h2></div><strong className="text-2xl text-amari-charcoal">{money(total)}</strong></div>{cart.length > 0 && <div className="mt-4 divide-y divide-amari-border">{cart.map((line, index) => { const label = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[1] : line.customLabel; const unit = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[2] || 0 : line.customAmountCents || 0; return <div key={`${line.productKey || line.customLabel}-${index}`} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><strong className="block truncate text-sm text-amari-charcoal">{label}</strong><small className="text-amari-text-muted">{money(unit)} each</small></div><input aria-label={`Quantity for ${label}`} className="w-14 rounded-lg border border-amari-border px-2 py-2 text-center text-sm" type="number" min="1" max="20" value={line.quantity || 1} onChange={(event) => updateQuantity(index, Number(event.target.value))} /><strong className="w-20 text-right text-sm">{money(unit * (line.quantity || 1))}</strong><button type="button" onClick={() => removeLine(index)} className="p-2 text-amari-text-muted" aria-label={`Remove ${label}`}><Trash2 size={16} /></button></div>; })}</div>}</section>

      <section className="staff-card mb-4"><p className="staff-mlabel">4 · Payment plan</p><p className="mt-2 text-sm text-amari-text-secondary">Record the intended payment split exactly. This does not attempt a payment.</p><div className="mt-3 flex flex-wrap gap-2">{([['checkout-link', 'Checkout link'], ['hsa-card', 'HSA card'], ['saved-card', 'Saved card'], ['cash', 'Cash']] as const).map(([method, label]) => <button key={method} type="button" onClick={() => setPrimaryAllocation(method)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${legs.length === 1 && legs[0].method === method ? 'border-amari-charcoal bg-amari-charcoal text-white' : 'border-amari-border bg-white text-amari-text-secondary'}`}>{label}</button>)}<button type="button" onClick={addSplitAllocation} disabled={!total || legs.length >= 6} className="rounded-lg border border-dashed border-amari-border bg-white px-3 py-2 text-sm font-semibold text-amari-text-secondary"><Plus className="mr-1 inline" size={14} /> Split payment</button></div>{legs.length > 0 && <div className="mt-4 space-y-2">{legs.map((leg, index) => <div key={`${leg.method}-${index}`} className="grid grid-cols-[1fr_130px_38px] gap-2"><select className="staff-input" value={leg.method} onChange={(event) => setLegs((current) => current.map((value, i) => i === index ? { ...value, method: event.target.value as PosPaymentMethod } : value))}>{['checkout-link', 'hsa-card', 'saved-card', 'cash', 'other'].map((method) => <option key={method} value={method}>{method.replace('-', ' ')}</option>)}</select><input className="staff-input" aria-label={`Amount for payment ${index + 1}`} type="number" min="0.00" step="0.01" value={(leg.amountCents / 100).toFixed(2)} onChange={(event) => setLegs((current) => current.map((value, i) => i === index ? { ...value, amountCents: Math.max(0, Math.round(Number(event.target.value) * 100) || 0) } : value))} /><button type="button" onClick={() => setLegs((current) => current.filter((_, i) => i !== index))} className="rounded-lg border border-amari-border text-amari-text-muted" aria-label={`Remove payment ${index + 1}`}><Trash2 className="mx-auto" size={15} /></button></div>)}<p className={`text-xs font-semibold ${allocation === total ? 'text-emerald-700' : 'text-amber-700'}`}>{allocation === total ? <><Check className="mr-1 inline" size={14} /> Allocated exactly: {money(total)}</> : `Allocated ${money(allocation)} · ${money(Math.abs(total - allocation))} ${allocation < total ? 'remaining' : 'over'}`}</p></div>}</section>

      <section className="staff-card"><p className="staff-mlabel">5 · Save & checkout text</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void saveDraft()} disabled={busy} className="staff-btn-primary">{busy ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} {sale ? 'Save changes' : 'Save cart'}</button><button type="button" onClick={() => void prepareText()} disabled={busy || !sale} className="staff-btn-secondary"><Send size={16} /> Preview checkout text</button></div>{preview && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Preview only · nothing was sent</p><p className="mt-2 text-sm text-amber-950">To {preview.recipient}</p><p className="mt-2 rounded-lg bg-white p-3 text-sm text-amari-charcoal">{preview.message}</p><p className="mt-2 text-xs text-amber-800">A future activation must refresh consent/DND, create a secure Stripe Checkout session, and record the sender audit event before this can send.</p></div>}{sale && <p className="mt-4 text-xs text-amari-text-muted">Saved {new Date(sale.updatedAt).toLocaleString()} · {sale.audit.length} audit events · {sale.id}</p>}</section>
    </main>
  );
}
