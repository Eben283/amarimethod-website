import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPosSale, getPosSale, previewPosCheckoutText, savePosSale, searchContacts, type PosClient, type PosDraftLineInput, type PosPaymentLegInput, type PosPaymentMethod, type PosSale, type PosTextPreview } from '../lib/api';
import type { ContactListItem } from '../types/staff';
import './PosPage.css';

const CATALOG = [
  ['initial-in-person', 'Initial — in person', 22500, 'Single sessions'], ['initial-virtual', 'Initial — virtual', 22500, 'Single sessions'],
  ['4-session-series', '4-session series', 72000, 'Series'], ['8-session-series', '8-session series', 129500, 'Series'],
  ['12-week-practice', 'The 12-Week Amari Practice', 550000, 'Practice'], ['upgrade-initial-to-4', 'Initial → 4 upgrade', 49500, 'Upgrades'],
  ['upgrade-initial-to-8', 'Initial → 8 upgrade', 107000, 'Upgrades'], ['upgrade-4-to-8', '4 → 8 upgrade', 57500, 'Upgrades'],
  ['living-practice', 'Living Practice', 34700, 'Practice'], ['follow-up', 'Single follow-up', 19000, 'Single sessions'],
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
  const [category, setCategory] = useState<typeof CATALOG[number][3]>('Practice');
  const [showCustom, setShowCustom] = useState(false);
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

  function addCatalog(productKey: string) { setCart((current) => [...current, { productKey, quantity: 1 }]); setPreview(null); }

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
  function setPrimaryAllocation(method: PosPaymentMethod) { setLegs(total ? [{ method, amountCents: total }] : []); setPreview(null); }
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
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save this cart.'); }
    finally { setBusy(false); }
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

  const stage = !client ? 1 : !cart.length ? 2 : !legs.length ? 3 : 4;

  return (
    <main className="pos-shell">
      <header className="pos-topbar">
        <button type="button" onClick={() => navigate('/')} className="pos-brand"><span className="pos-brand__mark">A</span><span>Amari <em>Method</em></span></button>
        <div className="pos-topbar__right"><span className="pos-status"><i /> Draft workspace</span><span className="pos-operator">Staff · inactive</span></div>
      </header>

      <section className="pos-intro">
        <p>Staff POS · safeguarded checkout</p>
        <h1>A sale before<br />a payment attempt.</h1>
        <span>Build one truthful cart, allocate exact amounts, and keep fulfillment locked until a future verified payment flow exists.</span>
      </section>

      <section className="pos-frame">
        <header className="pos-frame__head"><span><i /> Internal staff workspace</span><div>{[1, 2, 3, 4].map((step) => <b className={stage >= step ? 'is-active' : ''} key={step}>{step}</b>)}</div><span>Inactive · no payments</span></header>
        <div className="pos-canvas">
          {notice && <div className="pos-notice">{notice}</div>}
          <section className="pos-client">
            <div className="pos-client__head"><div><p className="pos-label">01 · existing identity</p><h2>{client ? client.name : 'Who is this sale for?'}</h2><span>{client ? `${client.phone || 'No phone on record'} · existing client only` : 'Every sale begins with one existing client. No anonymous checkout.'}</span></div>{client && <button type="button" onClick={() => setClient(null)} className="pos-quiet">Change client</button>}</div>
            {!client && <div className="pos-search"><span>⌕</span><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search by name, email, or phone" autoComplete="off" /><kbd>⌘ K</kbd></div>}
            {searching && <p className="pos-searching">Searching existing clients…</p>}
            {matches.length > 0 && <div className="pos-client-results">{matches.map((contact) => <button type="button" key={contact.id} onClick={() => selectClient(contact)}><span className="pos-avatar">{contact.name.slice(0, 2).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.phone || contact.email || 'No contact detail'}</small></span><b>→</b></button>)}</div>}
          </section>

          <section className="pos-workspace">
            <div className="pos-catalog">
              <div className="pos-section-head"><div><p className="pos-label">02 · catalog</p><h2>Build the sale.</h2></div><span>Server-owned prices</span></div>
              <div className="pos-categories">{(['Practice', 'Series', 'Upgrades', 'Single sessions'] as const).map((name) => <button className={category === name ? 'is-active' : ''} type="button" onClick={() => setCategory(name)} key={name}>{name}</button>)}<button type="button" onClick={() => setShowCustom((value) => !value)}>＋ {showCustom ? 'Close custom sale' : 'Custom sale'}</button></div>
              <div className="pos-products">
                {CATALOG.filter(([, , , group]) => group === category).map(([key, label, amount, group]) => <article className={`pos-product ${key === '12-week-practice' ? 'pos-product--featured' : ''}`} key={key}><div className="pos-product__mark">{key === '12-week-practice' ? '12' : group === 'Upgrades' ? '↗' : 'A'}</div><p>{group}</p><h3>{label}</h3><span>{key === '12-week-practice' ? '24 sessions · Living Practice access' : key.includes('upgrade') ? 'Eligibility review before payment' : 'Catalog product'}</span><footer><strong>{money(amount)}</strong><button type="button" onClick={() => addCatalog(key)}>{cart.some((line) => line.productKey === key) ? 'Add another' : 'Add'} <b>→</b></button></footer></article>)}
              </div>
              {showCustom && <div className="pos-custom" id="pos-custom-sale"><p className="pos-label">Separate custom sale · no fulfillment</p><div><input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="Custom amount label" /><input value={customReason} onChange={(event) => setCustomReason(event.target.value)} placeholder="Category or reason" /><input inputMode="decimal" value={customDollars} onChange={(event) => setCustomDollars(event.target.value)} placeholder="$0.00" /><button type="button" onClick={addCustom}>Add custom line <b>→</b></button></div></div>}
            </div>

            <aside className="pos-sale-card">
              <div className="pos-sale-card__inner">
                <div className="pos-sale-card__head"><div><p className="pos-label">Current sale</p><h2>{sale ? `Sale · ${sale.status}` : 'Sale · Draft'}</h2></div><span>{cart.length} {cart.length === 1 ? 'line' : 'lines'}</span></div>
                <div className="pos-cart-lines">{cart.length ? cart.map((line, index) => { const label = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[1] : line.customLabel; const unit = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[2] || 0 : line.customAmountCents || 0; return <div className="pos-cart-line" key={`${line.productKey || line.customLabel}-${index}`}><div><span>{line.quantity || 1}</span><p><strong>{label}</strong><small>{line.productKey ? 'Catalog product' : `${line.customReason} · custom sale`} · {money(unit)} each</small></p></div><div><input aria-label={`Quantity for ${label}`} type="number" min="1" max="20" value={line.quantity || 1} onChange={(event) => updateQuantity(index, Number(event.target.value))} /><b>{money(unit * (line.quantity || 1))}</b><button type="button" onClick={() => removeLine(index)} aria-label={`Remove ${label}`}>×</button></div></div>; }) : <p className="pos-empty">Choose a catalog product or add a carefully labelled custom sale.</p>}</div>
                <div className="pos-total"><span>Total due</span><strong>{money(total)}</strong></div>
                <div className="pos-lock">◌ No sessions or access are granted from this draft.</div>
              </div>
            </aside>
          </section>

          {cart.length > 0 && <section className="pos-payment">
            <div className="pos-payment__summary"><p className="pos-label">03 · exact payment allocation</p><h2>Split the exact balance.</h2><span>Each eventual checkout will be limited to its own exact amount.</span><strong>{money(total)}</strong></div>
            <div className="pos-payment__body"><div className="pos-methods">{([['checkout-link', 'Checkout link'], ['hsa-card', 'HSA / FSA card'], ['saved-card', 'Saved card'], ['cash', 'Cash']] as const).map(([method, label]) => <button key={method} type="button" onClick={() => setPrimaryAllocation(method)} className={legs.length === 1 && legs[0].method === method ? 'is-active' : ''}>{label}</button>)}<button type="button" onClick={addSplitAllocation} disabled={!total || legs.length >= 6}>＋ Split payment</button></div>{legs.length > 0 && <div className="pos-legs">{legs.map((leg, index) => <div key={`${leg.method}-${index}`}><span>0{index + 1}</span><select value={leg.method} onChange={(event) => setLegs((current) => current.map((value, i) => i === index ? { ...value, method: event.target.value as PosPaymentMethod } : value))}>{['checkout-link', 'hsa-card', 'saved-card', 'cash', 'other'].map((method) => <option key={method} value={method}>{method.replace('-', ' ')}</option>)}</select><input aria-label={`Amount for payment ${index + 1}`} type="number" min="0.00" step="0.01" value={(leg.amountCents / 100).toFixed(2)} onChange={(event) => setLegs((current) => current.map((value, i) => i === index ? { ...value, amountCents: Math.max(0, Math.round(Number(event.target.value) * 100) || 0) } : value))} /><button type="button" onClick={() => setLegs((current) => current.filter((_, i) => i !== index))} aria-label={`Remove payment ${index + 1}`}>×</button></div>)}<p className={allocation === total ? 'is-exact' : 'is-warning'}>{allocation === total ? `✓ Allocated exactly: ${money(total)}` : `Allocated ${money(allocation)} · ${money(Math.abs(total - allocation))} ${allocation < total ? 'remaining' : 'over'}`}</p></div>}</div>
          </section>}

          {cart.length > 0 && <section className="pos-actions"><div><p className="pos-label">04 · record safely</p><h2>{sale ? 'Save the new draft state.' : 'Save before any message preview.'}</h2><span>Saving creates no payment, checkout link, text, or GHL change.</span></div><div><button type="button" onClick={() => void saveDraft()} disabled={busy}>{busy ? 'Saving…' : sale ? 'Save changes' : 'Save as draft'} <b>→</b></button><button type="button" onClick={() => void prepareText()} disabled={busy || !sale}>Preview checkout text</button></div></section>}
          {preview && <section className="pos-text-preview"><p className="pos-label">Preview only · no message sent</p><h3>To {preview.recipient} · {money(preview.amountCents)}</h3><blockquote>{preview.message}</blockquote><span>A future sender must refresh consent and DND, create a secure checkout, and record a final sender audit event.</span></section>}
          {sale && <p className="pos-audit">Saved {new Date(sale.updatedAt).toLocaleString()} · {sale.audit.length} audit events · {sale.id}</p>}
        </div>
      </section>
    </main>
  );
}
