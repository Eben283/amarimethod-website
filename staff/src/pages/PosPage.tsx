import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPosSale,
  getPosSale,
  previewPosCheckoutText,
  savePosSale,
  searchContacts,
  type PosClient,
  type PosDraftLineInput,
  type PosPaymentLegInput,
  type PosPaymentMethod,
  type PosSale,
  type PosTextPreview,
} from "../lib/api";
import type { ContactListItem } from "../types/staff";
import "./PosPage.css";

const CATALOG = [
  ["initial-in-person", "Initial — in person", 22500, "Single sessions"],
  ["initial-virtual", "Initial — virtual", 22500, "Single sessions"],
  ["4-session-series", "4-session series", 72000, "Series"],
  ["8-session-series", "8-session series", 129500, "Series"],
  ["12-week-practice", "The 12-Week Amari Practice", 550000, "Practice"],
  ["upgrade-initial-to-4", "Initial → 4 upgrade", 49500, "Upgrades"],
  ["upgrade-initial-to-8", "Initial → 8 upgrade", 107000, "Upgrades"],
  ["upgrade-4-to-8", "4 → 8 upgrade", 57500, "Upgrades"],
  ["entrainment", "Entrainment", 9000, "Upgrades"],
  ["living-practice", "Living Practice", 34700, "Upgrades"],
  ["follow-up", "Single follow-up", 19000, "Single sessions"],
] as const;

const paymentLabels: Record<PosPaymentMethod, string> = {
  "checkout-link": "Checkout link",
  "hsa-card": "HSA / FSA card",
  "saved-card": "Saved card",
  cash: "Cash",
  other: "Other payment",
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const draftStorageKey = "amari_staff_pos_draft";

function toDraftCart(sale: PosSale): PosDraftLineInput[] {
  return sale.cart.map((line) =>
    line.kind === "catalog"
      ? { productKey: line.productKey || undefined, quantity: line.quantity }
      : { customLabel: line.label, customReason: line.reason || "", customAmountCents: line.unitAmountCents, quantity: line.quantity },
  );
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
  const [clientSearch, setClientSearch] = useState("");
  const [matches, setMatches] = useState<ContactListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<PosClient | null>(null);
  const [cart, setCart] = useState<PosDraftLineInput[]>([]);
  const [legs, setLegs] = useState<PosPaymentLegInput[]>([]);
  const [sale, setSale] = useState<PosSale | null>(null);
  const [category, setCategory] = useState<(typeof CATALOG)[number][3]>("Practice");
  const [productQuery, setProductQuery] = useState("");
  const [quickAccess, setQuickAccess] = useState(true);
  const [showCustomSale, setShowCustomSale] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [customDollars, setCustomDollars] = useState("");
  const [checkoutStep, setCheckoutStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<PosTextPreview | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const total = useMemo(() => calculateTotal(cart), [cart]);
  const allocation = useMemo(() => legs.reduce((sum, leg) => sum + (Number(leg.amountCents) || 0), 0), [legs]);
  const products = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    return CATALOG.filter(([, label, , group]) =>
      query ? `${label} ${group}`.toLowerCase().includes(query) : group === category,
    );
  }, [category, productQuery]);

  useEffect(() => {
    const id = localStorage.getItem(draftStorageKey);
    if (!id) return;
    void getPosSale(id)
      .then(({ sale: loaded }) => {
        setSale(loaded);
        setClient(loaded.client);
        setCart(toDraftCart(loaded));
        setLegs(toDraftLegs(loaded));
      })
      .catch(() => localStorage.removeItem(draftStorageKey));
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (clientSearch.trim().length < 2) {
      setMatches([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      void searchContacts(clientSearch.trim())
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [clientSearch]);

  function selectClient(contact: ContactListItem) {
    setClient({ id: contact.id, name: contact.name, phone: contact.phone || null });
    setClientSearch("");
    setMatches([]);
    setNotice("");
  }

  function addCatalog(productKey: string) {
    setCart((current) => [...current, { productKey, quantity: 1 }]);
    setPreview(null);
  }

  function openCategory(nextCategory: (typeof CATALOG)[number][3]) {
    setCategory(nextCategory);
    setProductQuery("");
    setShowCustomSale(false);
    setQuickAccess(false);
  }

  function openCustomSale() {
    setProductQuery("");
    setShowCustomSale(true);
    setQuickAccess(false);
  }

  function addCustomSale() {
    const amountCents = Math.round(Number(customDollars) * 100);
    if (!customLabel.trim() || !customReason.trim() || !Number.isSafeInteger(amountCents) || amountCents < 1) {
      setNotice("Add a label, reason, and valid dollar amount.");
      return;
    }
    setCart((current) => [...current, { customLabel: customLabel.trim(), customReason: customReason.trim(), customAmountCents: amountCents, quantity: 1 }]);
    setCustomLabel("");
    setCustomReason("");
    setCustomDollars("");
    setNotice("");
    setPreview(null);
  }

  function updateQuantity(index: number, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return;
    setCart((current) => current.map((line, i) => (i === index ? { ...line, quantity } : line)));
    setPreview(null);
  }

  function removeLine(index: number) {
    setCart((current) => current.filter((_, i) => i !== index));
    setPreview(null);
  }

  function beginCheckout() {
    if (!cart.length) {
      setNotice("Add at least one product before checkout.");
      return;
    }
    setNotice("");
    setCheckoutStep(true);
  }

  function setPrimaryAllocation(method: PosPaymentMethod) {
    setLegs(total ? [{ method, amountCents: total }] : []);
    setPreview(null);
  }

  function addSplitAllocation() {
    setLegs((current) => {
      if (!total || current.length >= 2) return current;
      if (!current.length) return [{ method: "hsa-card", amountCents: 0 }, { method: "checkout-link", amountCents: total }];
      return [...current, { method: "hsa-card", amountCents: 0 }];
    });
    setPreview(null);
  }

  function updateSplitAmount(index: number, amountCents: number) {
    setLegs((current) => {
      const next = current.map((leg, i) => (i === index ? { ...leg, amountCents } : leg));
      if (next.length === 2) {
        const otherIndex = index === 0 ? 1 : 0;
        next[otherIndex] = { ...next[otherIndex], amountCents: Math.max(total - amountCents, 0) };
      }
      return next;
    });
    setPreview(null);
  }

  function useOnePayment() {
    setLegs(total ? [{ method: legs[0]?.method || "checkout-link", amountCents: total }] : []);
    setPreview(null);
  }

  async function saveDraft() {
    if (!client) {
      setNotice("Select a client to continue.");
      return;
    }
    if (legs.length && allocation !== total) {
      setNotice("Payment amounts need to equal the cart total.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = sale
        ? await savePosSale({ id: sale.id, version: sale.version, client, cart, paymentLegs: legs })
        : await createPosSale({ client, cart, paymentLegs: legs });
      setSale(result.sale);
      localStorage.setItem(draftStorageKey, result.sale.id);
      setNotice("Checkout draft saved. No payment or message has been created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this checkout draft.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareText() {
    if (!sale) {
      setNotice("Save this checkout draft first.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await previewPosCheckoutText(sale.id);
      setSale(result.sale);
      setPreview(result.preview);
      setNotice("Preview recorded. Sending remains disabled.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not prepare the text preview.");
    } finally {
      setBusy(false);
    }
  }

  const cartLines = (
    <div className="pos-cart-lines">
      {cart.length ? cart.map((line, index) => {
        const label = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[1] : line.customLabel;
        const unit = line.productKey ? CATALOG.find(([key]) => key === line.productKey)?.[2] || 0 : line.customAmountCents || 0;
        return (
          <div className="pos-cart-line" key={`${line.productKey || line.customLabel}-${index}`}>
            <div>
              <span>{line.quantity || 1}</span>
              <p><strong>{label}</strong><small>{money(unit)} each</small></p>
            </div>
            <div>
              <input aria-label={`Quantity for ${label}`} type="number" min="1" max="20" value={line.quantity || 1} onChange={(event) => updateQuantity(index, Number(event.target.value))} />
              <b>{money(unit * (line.quantity || 1))}</b>
              <button type="button" onClick={() => removeLine(index)} aria-label={`Remove ${label}`}>×</button>
            </div>
          </div>
        );
      }) : <p className="pos-empty">Select products to begin.</p>}
    </div>
  );

  if (checkoutStep) {
    return (
      <main className="pos-shell">
        <div className="pos-checkout-layout">
          <section className="pos-checkout-main">
            <button type="button" className="pos-back" onClick={() => setCheckoutStep(false)}>← Products</button>
            <h1>Checkout</h1>
            {notice && <div className="pos-notice">{notice}</div>}
            <section className="pos-client">
              <div className="pos-client__head">
                <h2>{client ? client.name : "Add client"}</h2>
                {client && <button type="button" onClick={() => setClient(null)} className="pos-quiet">Change</button>}
              </div>
              {!client && <div className="pos-search"><span>⌕</span><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search by name, email, or phone" autoComplete="off" /></div>}
              {searching && <p className="pos-searching">Searching clients…</p>}
              {matches.length > 0 && <div className="pos-client-results">{matches.map((contact) => <button type="button" key={contact.id} onClick={() => selectClient(contact)}><span className="pos-avatar">{contact.name.slice(0, 2).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.phone || contact.email || "No contact detail"}</small></span><b>→</b></button>)}</div>}
            </section>
            <section className="pos-payment">
              <p className="pos-label">Payment method</p>
              <div className="pos-methods">
                {([ ["checkout-link", "Checkout link"], ["hsa-card", "HSA / FSA card"], ["saved-card", "Saved card"], ["cash", "Cash"] ] as const).map(([method, label]) => <button key={method} type="button" onClick={() => setPrimaryAllocation(method)} className={legs.length === 1 && legs[0].method === method ? "is-active" : ""}>{label}</button>)}
                <button type="button" onClick={addSplitAllocation} disabled={!total || legs.length >= 2}>＋ Two payment methods</button>
              </div>
              {legs.length === 1 && <p className="pos-payment-choice">{paymentLabels[legs[0].method]} · {money(total)}</p>}
              {legs.length > 1 && <div className="pos-legs"><p>Enter the amount for each payment.</p>{legs.map((leg, index) => <div key={`${leg.method}-${index}`} style={{ gridTemplateColumns: "minmax(0, 1fr) 116px" }}><select aria-label={`Payment method ${index + 1}`} value={leg.method} onChange={(event) => setLegs((current) => current.map((value, i) => i === index ? { ...value, method: event.target.value as PosPaymentMethod } : value))}>{Object.entries(paymentLabels).map(([method, label]) => <option key={method} value={method}>{label}</option>)}</select><input aria-label={`Amount for payment ${index + 1}`} type="number" min="0.00" step="0.01" value={(leg.amountCents / 100).toFixed(2)} onChange={(event) => updateSplitAmount(index, Math.max(0, Math.round(Number(event.target.value) * 100) || 0))} /></div>)}{allocation !== total && <p className="is-warning">{money(Math.abs(total - allocation))} {allocation < total ? "remaining" : "over"}</p>}<button type="button" className="pos-one-payment" onClick={useOnePayment}>Use one payment instead</button></div>}
            </section>
            {preview && <section className="pos-text-preview"><p className="pos-label">Preview only · no message sent</p><h3>To {preview.recipient} · {money(preview.amountCents)}</h3><blockquote>{preview.message}</blockquote></section>}
          </section>
          <aside className="pos-cart-pane">
            <div className="pos-cart-head"><div><p className="pos-label">Cart</p><h2>{cart.length} {cart.length === 1 ? "product" : "products"}</h2></div><strong>{money(total)}</strong></div>
            {cartLines}
            <div className="pos-cart-total"><span>Total</span><strong>{money(total)}</strong></div>
            <button type="button" className="pos-checkout-bar" onClick={() => void saveDraft()} disabled={busy || !cart.length}>{busy ? "Saving…" : "Save checkout draft"}<span>{money(total)} →</span></button>
            {sale && <button type="button" className="pos-preview-link" onClick={() => void prepareText()} disabled={busy}>Preview checkout text</button>}
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="pos-shell">
      {notice && <div className="pos-notice">{notice}</div>}
      <div className="pos-layout">
        <section className="pos-products-pane">
          <div className="pos-pane-head">
            <div><p className="pos-label">{quickAccess ? "Quick access" : "Products"}</p><h1>{quickAccess ? "Start a sale" : "Products"}</h1></div>
            <label className="pos-product-search"><span>⌕</span><input value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setQuickAccess(false); setShowCustomSale(false); }} placeholder="Search products" /><kbd>⌘ K</kbd></label>
          </div>
          {quickAccess ? <div className="pos-quick-access">
            <button type="button" className="pos-quick-tile pos-quick-tile--practice" onClick={() => addCatalog("12-week-practice")}><span>12</span><strong>Amari Practice</strong><small>Add the 12-week practice</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--series" onClick={() => openCategory("Series")}><span>↗</span><strong>Series</strong><small>4- and 8-session options</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--upgrades" onClick={() => openCategory("Upgrades")}><span>＋</span><strong>Upgrades</strong><small>Continuation and add-ons</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--sessions" onClick={() => openCategory("Single sessions")}><span>○</span><strong>Single sessions</strong><small>Initials and follow-ups</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--custom" onClick={openCustomSale}><span>＋</span><strong>Custom sale</strong><small>Labelled custom amount</small></button>
          </div> : <>
            <div className="pos-catalog-tools"><button type="button" onClick={() => { setQuickAccess(true); setProductQuery(""); setShowCustomSale(false); }}>← Quick access</button><div className="pos-categories">{(["Practice", "Series", "Upgrades", "Single sessions"] as const).map((name) => <button className={category === name && !productQuery && !showCustomSale ? "is-active" : ""} type="button" onClick={() => openCategory(name)} key={name}>{name}</button>)}</div></div>
            {showCustomSale ? <div className="pos-custom-sale"><p className="pos-label">Custom sale</p><h2>Add a labelled amount</h2><input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="What is this for?" /><input value={customReason} onChange={(event) => setCustomReason(event.target.value)} placeholder="Reason or category" /><input inputMode="decimal" value={customDollars} onChange={(event) => setCustomDollars(event.target.value)} placeholder="$0.00" /><button type="button" onClick={addCustomSale}>Add to cart →</button></div> : <><div className="pos-products">{products.map(([key, label, amount, group]) => <button type="button" className={`pos-product ${key === "12-week-practice" ? "pos-product--featured" : ""}`} key={key} onClick={() => addCatalog(key)} aria-label={`Add ${label} for ${money(amount)}`}><div className="pos-product__mark">{key === "12-week-practice" ? "12" : group === "Upgrades" ? "↗" : "A"}</div><p>{group}</p><h3>{label}</h3>{key === "12-week-practice" && <span>24 sessions</span>}<footer><strong>{money(amount)}</strong></footer></button>)}</div>{!products.length && <p className="pos-no-products">No products match “{productQuery}”.</p>}</>}
          </>}
        </section>
        <aside className="pos-cart-pane">
          <div className="pos-cart-head"><div><p className="pos-label">Cart</p><h2>{cart.length} {cart.length === 1 ? "product" : "products"}</h2></div><strong>{money(total)}</strong></div>
          {cartLines}
          <div className="pos-cart-total"><span>Total</span><strong>{money(total)}</strong></div>
          <button type="button" className="pos-checkout-bar" onClick={beginCheckout} disabled={!cart.length}>Checkout products<span>{money(total)} →</span></button>
        </aside>
      </div>
    </main>
  );
}
