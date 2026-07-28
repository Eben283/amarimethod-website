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
  "hsa-card": "Card — HSA / FSA",
  "saved-card": "Saved card",
  "manual-card": "Card payment",
  cash: "Cash",
  other: "Other payment",
};

const splitPaymentOptions: Array<[PosPaymentMethod, string]> = [
  ["manual-card", "Card payment"],
  ["hsa-card", "HSA / FSA card"],
  ["checkout-link", "Checkout link"],
  ["cash", "Cash"],
  ["other", "Other payment"],
];

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
  const [newCustomerStep, setNewCustomerStep] = useState(false);
  const [newCustomerFirstName, setNewCustomerFirstName] = useState("");
  const [newCustomerLastName, setNewCustomerLastName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
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
  const [paymentStep, setPaymentStep] = useState(false);
  const [paymentAction, setPaymentAction] = useState<"checkout-link" | "cash" | "split" | null>(null);
  const [cashDollars, setCashDollars] = useState("");
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
    setClient({ id: contact.id, name: contact.name, phone: contact.phone || null, email: contact.email || null });
    setClientSearch("");
    setMatches([]);
    setNotice("");
  }

  function openNewCustomer() {
    setNotice("");
    setNewCustomerStep(true);
  }

  function cancelNewCustomer() {
    setNewCustomerFirstName("");
    setNewCustomerLastName("");
    setNewCustomerPhone("");
    setNewCustomerEmail("");
    setNotice("");
    setNewCustomerStep(false);
  }

  function saveNewCustomer() {
    const name = [newCustomerFirstName.trim(), newCustomerLastName.trim()].filter(Boolean).join(" ");
    const phone = newCustomerPhone.trim();
    const email = newCustomerEmail.trim().toLowerCase();
    if (!name || (!phone && !email)) {
      setNotice("Add a first name and at least a phone number or email address.");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice("Add a valid email address or leave it blank.");
      return;
    }
    setClient({ id: `draft_${crypto.randomUUID().replace(/-/g, "")}`, name, phone: phone || null, email: email || null });
    setClientSearch("");
    setMatches([]);
    cancelNewCustomer();
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
    setPaymentStep(false);
    setCheckoutStep(true);
  }

  function beginPayment() {
    if (!client) {
      setNotice("Select a client to continue.");
      return;
    }
    setNotice("");
    setPaymentStep(true);
  }

  async function choosePrimaryPayment(method: PosPaymentMethod) {
    const paymentLegs = total ? [{ method, amountCents: total }] : [];
    setLegs(paymentLegs);
    setPreview(null);
    if (!client || !cart.length) return false;

    setBusy(true);
    setNotice("");
    try {
      const result = sale
        ? await savePosSale({ id: sale.id, version: sale.version, client, cart, paymentLegs })
        : await createPosSale({ client, cart, paymentLegs });
      setSale(result.sale);
      localStorage.setItem(draftStorageKey, result.sale.id);
      setNotice(`${paymentLabels[method]} selected. No payment or message has been created.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this payment choice.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function beginPaymentAction(method: "checkout-link" | "cash" | "split") {
    setNotice("");
    if (method === "cash") setCashDollars((total / 100).toFixed(2));
    if (method === "split") {
      const existing = legs.length === 2 ? legs : [{ method: "hsa-card" as const, amountCents: 0 }, { method: "checkout-link" as const, amountCents: total }];
      setLegs(existing);
    }
    setPaymentAction(method);
  }

  async function confirmCheckoutLink() {
    if (!client?.phone) {
      setNotice("Add a mobile number before preparing a checkout link.");
      return;
    }
    if (await choosePrimaryPayment("checkout-link")) {
      setPaymentAction(null);
      setNotice("Checkout-link confirmation saved. Sending remains disabled.");
    }
  }

  async function confirmCashReceived() {
    const amountCents = Math.round(Number(cashDollars) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents !== total) {
      setNotice(`Cash needs to equal ${money(total)}. Use split payment for a partial cash amount.`);
      return;
    }
    if (await choosePrimaryPayment("cash")) {
      setPaymentAction(null);
      setNotice("Cash receipt confirmation saved. Cash is not marked received until activation.");
    }
  }

  function updateSplitAmount(index: number, amountCents: number) {
    setLegs((current) => {
      const exactAmount = Math.min(Math.max(0, amountCents), total);
      const next = current.map((leg, i) => (i === index ? { ...leg, amountCents: exactAmount } : leg));
      if (next.length === 2) {
        const otherIndex = index === 0 ? 1 : 0;
        next[otherIndex] = { ...next[otherIndex], amountCents: total - exactAmount };
      }
      return next;
    });
    setPreview(null);
  }

  async function saveSplitPayment() {
    if (!client) {
      setNotice("Select a client to continue.");
      return false;
    }
    if (legs.length !== 2 || allocation !== total) {
      setNotice("Payment amounts need to equal the cart total.");
      return false;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = sale
        ? await savePosSale({ id: sale.id, version: sale.version, client, cart, paymentLegs: legs })
        : await createPosSale({ client, cart, paymentLegs: legs });
      setSale(result.sale);
      localStorage.setItem(draftStorageKey, result.sale.id);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this split payment plan.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmSplitPayment() {
    if (await saveSplitPayment()) {
      setPaymentAction(null);
      setNotice("Split payment plan saved. No payment or message has been created.");
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

  if (newCustomerStep) {
    return (
      <main className="pos-shell">
        <section className="pos-new-customer-screen">
          <header className="pos-new-customer-screen__top">
            <button type="button" onClick={cancelNewCustomer}>Cancel</button>
            <strong>Add new customer</strong>
            <span aria-hidden="true" />
          </header>
          <form id="new-customer-form" className="pos-new-customer-form" onSubmit={(event) => { event.preventDefault(); saveNewCustomer(); }}>
            {notice && <div className="pos-notice pos-notice--customer">{notice}</div>}
            <p className="pos-label">Contact information</p>
            <div className="pos-new-customer-form__fields">
              <label>First name<input value={newCustomerFirstName} onChange={(event) => setNewCustomerFirstName(event.target.value)} autoComplete="given-name" autoFocus /><small>Required</small></label>
              <label>Last name<input value={newCustomerLastName} onChange={(event) => setNewCustomerLastName(event.target.value)} autoComplete="family-name" /></label>
              <label>Mobile number<input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></label>
              <label>Email address<input value={newCustomerEmail} onChange={(event) => setNewCustomerEmail(event.target.value)} inputMode="email" autoComplete="email" /></label>
            </div>
            <p className="pos-new-customer-form__note">A phone number or email address is required.</p>
            <button type="submit" className="pos-new-customer-form__save">Save customer <span aria-hidden="true">→</span></button>
          </form>
        </section>
      </main>
    );
  }

  if (paymentAction) {
    const isCheckoutLink = paymentAction === "checkout-link";
    const isSplitPayment = paymentAction === "split";
    const hasMobile = Boolean(client?.phone);
    return (
      <main className="pos-shell">
        <section className="pos-payment-action-screen">
          <header className="pos-payment-screen__top">
            <button type="button" className="pos-back" onClick={() => { setNotice(""); setPaymentAction(null); }}>← Back</button>
            <strong>Total {money(total)}</strong>
            <span>{client?.name || "Client"}</span>
          </header>
          <div className="pos-payment-action-content">
            {notice && <div className="pos-notice pos-notice--action">{notice}</div>}
            <p className="pos-label">{isSplitPayment ? "Split payment" : isCheckoutLink ? "Checkout link" : "Cash payment"}</p>
            <h1>{isSplitPayment ? "Split the total" : isCheckoutLink ? "Confirm checkout link" : "Record cash received"}</h1>
            {isSplitPayment ? <>
              <p className="pos-payment-action-intro">Choose two methods. When one amount changes, the other automatically carries the remaining balance.</p>
              <div className="pos-split-plan">
                {legs.slice(0, 2).map((leg, index) => <section className="pos-split-plan__leg" key={`split-${index}`}>
                  <p>Payment {index + 1}</p>
                  <label><span>Method</span><select aria-label={`Payment method ${index + 1}`} value={leg.method} onChange={(event) => setLegs((current) => current.map((value, i) => i === index ? { ...value, method: event.target.value as PosPaymentMethod } : value))}>{splitPaymentOptions.map(([method, label]) => <option key={method} value={method}>{label}</option>)}</select></label>
                  <label><span>Exact amount</span><input aria-label={`Amount for payment ${index + 1}`} type="number" inputMode="decimal" min="0.00" max={(total / 100).toFixed(2)} step="0.01" value={(leg.amountCents / 100).toFixed(2)} onChange={(event) => updateSplitAmount(index, Math.round(Number(event.target.value) * 100) || 0)} /><b>USD</b></label>
                </section>)}
              </div>
              <div className={`pos-split-total ${allocation === total ? "is-complete" : ""}`}><span>{allocation === total ? "Allocated exactly" : allocation < total ? "Remaining" : "Over by"}</span><strong>{money(Math.abs(total - allocation))}</strong></div>
              {legs.some((leg) => leg.method === "checkout-link") && !hasMobile && <p className="pos-split-warning">Checkout link needs a mobile number on this client before activation.</p>}
            </> : <div className="pos-payment-review">
              <div><span>Customer</span><strong>{client?.name || "Client"}</strong></div>
              {isCheckoutLink ? <><div><span>Send to</span><strong>{client?.phone || "Mobile number needed"}</strong></div><div><span>Link expires</span><strong>24 hours after sending</strong></div><div className="pos-payment-review__message"><span>Message preview</span><strong>Amari Method: complete your payment of {money(total)} securely from this link.</strong></div></> : <><label><span>Cash received</span><input aria-label="Cash received" inputMode="decimal" value={cashDollars} onChange={(event) => setCashDollars(event.target.value)} /><b>USD</b></label><div><span>Amount due</span><strong>{money(total)}</strong></div><p>For a partial cash payment, use Split payment instead.</p></>}
            </div>}
            <button type="button" className="pos-checkout-bar pos-payment-action-button" onClick={() => void (isSplitPayment ? confirmSplitPayment() : isCheckoutLink ? confirmCheckoutLink() : confirmCashReceived())} disabled={busy || (isCheckoutLink && !hasMobile) || (isSplitPayment && (allocation !== total || (legs.some((leg) => leg.method === "checkout-link") && !hasMobile)))}>{busy ? "Saving…" : isSplitPayment ? "Confirm split plan" : isCheckoutLink ? "Confirm checkout link" : "Record cash received"}<span>{money(total)} →</span></button>
            <p className="pos-payment-action-note">{isSplitPayment ? "This stores only the exact draft allocation; no payment is taken and no message is sent." : isCheckoutLink ? "This preview cannot create a link or send a message yet." : "This draft does not mark cash as received or fulfill anything yet."}</p>
          </div>
        </section>
      </main>
    );
  }

  if (paymentStep) {
    const chooseMethod = (method: PosPaymentMethod) => { void choosePrimaryPayment(method); };

    return (
      <main className="pos-shell">
        <section className="pos-payment-screen">
          <header className="pos-payment-screen__top">
            <button type="button" className="pos-back" onClick={() => setPaymentStep(false)}>← Back</button>
            <strong>Total {money(total)}</strong>
            <span>{client?.name || "Client"}</span>
          </header>

          {notice && <div className="pos-notice pos-notice--payment">{notice}</div>}

          <div className="pos-payment-screen__content">
            <p className="pos-label">Accept payment</p>
            <h1>Select payment option</h1>
            <p className="pos-payment-screen__client">For {client?.name || "this client"}</p>

            <div className="pos-payment-options">
              {([
                ["manual-card", "Card payment", "Enter any card, including HSA / FSA", "▦"],
                ["checkout-link", "Checkout link", "Send a secure payment link to their phone", "↗"],
                ["cash", "Cash", "Record the exact amount received", "□"],
              ] as const).map(([method, title, detail, mark]) => (
                <button key={method} type="button" className={`pos-payment-option ${legs.length === 1 && legs[0].method === method ? "is-active" : ""}`} onClick={() => method === "checkout-link" || method === "cash" ? beginPaymentAction(method) : chooseMethod(method)} disabled={busy}>
                  <span className="pos-payment-option__mark" aria-hidden="true">{mark}</span>
                  <span><strong>{title}</strong><small>{detail}</small></span>
                  <b aria-hidden="true">→</b>
                </button>
              ))}
              <button type="button" className={`pos-payment-option pos-payment-option--split ${legs.length > 1 ? "is-active" : ""}`} onClick={() => beginPaymentAction("split")} disabled={!total}>
                <span className="pos-payment-option__mark" aria-hidden="true">÷</span>
                <span><strong>Split payment</strong><small>Use two payment methods for this sale</small></span>
                <b aria-hidden="true">→</b>
              </button>
            </div>

            {preview && <section className="pos-text-preview"><p className="pos-label">Preview only · no message sent</p><h3>To {preview.recipient} · {money(preview.amountCents)}</h3><blockquote>{preview.message}</blockquote></section>}
          </div>
        </section>
      </main>
    );
  }

  if (checkoutStep) {
    return (
      <main className="pos-shell">
        <div className="pos-checkout-layout">
          <section className="pos-checkout-main">
            <button type="button" className="pos-back" onClick={() => { setPaymentStep(false); setCheckoutStep(false); }}>← Products</button>
            {notice && <div className="pos-notice">{notice}</div>}
            <section className="pos-client">
              <div className="pos-client__head">
                <h2>{client ? client.name : "Add client"}</h2>
                {client ? <button type="button" onClick={() => setClient(null)} className="pos-quiet">Change</button> : <button type="button" onClick={openNewCustomer} className="pos-quiet">＋ New client</button>}
              </div>
              {client && <p className="pos-client-detail">{[client.phone, client.email].filter(Boolean).join(" · ") || "Contact details needed before activation"}</p>}
              {!client && <div className="pos-search"><span>⌕</span><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search by name, email, or phone" autoComplete="off" /></div>}
              {searching && <p className="pos-searching">Searching clients…</p>}
              {matches.length > 0 && <div className="pos-client-results">{matches.map((contact) => <button type="button" key={contact.id} onClick={() => selectClient(contact)}><span className="pos-avatar">{contact.name.slice(0, 2).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.phone || contact.email || "No contact detail"}</small></span><b>→</b></button>)}</div>}
            </section>
          </section>
          <aside className="pos-cart-pane">
            <div className="pos-cart-head"><div><p className="pos-label">Cart</p><h2>{cart.length} {cart.length === 1 ? "product" : "products"}</h2></div><strong>{money(total)}</strong></div>
            {cartLines}
            <div className="pos-cart-total"><span>Total</span><strong>{money(total)}</strong></div>
            <button type="button" className="pos-checkout-bar" onClick={beginPayment} disabled={!client || !cart.length}>Accept payment<span>{money(total)} →</span></button>
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
          <div className={`pos-pane-head ${quickAccess ? "pos-pane-head--quick" : ""}`}>
            {!quickAccess && <div><p className="pos-label">Products</p><h1>Products</h1></div>}
            <label className="pos-product-search"><span>⌕</span><input value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setQuickAccess(false); setShowCustomSale(false); }} placeholder="Search products" /><kbd>⌘ K</kbd></label>
          </div>
          {quickAccess ? <div className="pos-quick-access">
            <button type="button" className="pos-quick-tile pos-quick-tile--customer" onClick={openNewCustomer}><span>◌</span><strong>Add customer</strong><small>Name and contact details</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--custom" onClick={openCustomSale}><span>＋</span><strong>Custom sale</strong><small>Labelled custom amount</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--practice" onClick={() => addCatalog("12-week-practice")}><span>12</span><strong>Amari Practice</strong><small>Add the 12-week practice</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--series" onClick={() => openCategory("Series")}><span>↗</span><strong>Series</strong><small>4- and 8-session options</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--upgrades" onClick={() => openCategory("Upgrades")}><span>＋</span><strong>Upgrades</strong><small>Continuation and add-ons</small></button>
            <button type="button" className="pos-quick-tile pos-quick-tile--sessions" onClick={() => openCategory("Single sessions")}><span>○</span><strong>Single sessions</strong><small>Initials and follow-ups</small></button>
          </div> : <>
            <div className="pos-catalog-tools"><button type="button" onClick={() => { setQuickAccess(true); setProductQuery(""); setShowCustomSale(false); }}>← Quick access</button><div className="pos-categories">{(["Practice", "Series", "Upgrades", "Single sessions"] as const).map((name) => <button className={category === name && !productQuery && !showCustomSale ? "is-active" : ""} type="button" onClick={() => openCategory(name)} key={name}>{name}</button>)}</div></div>
            {showCustomSale ? <div className="pos-custom-sale"><p className="pos-label">Custom sale</p><h2>Add a labelled amount</h2><input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="What is this for?" /><input value={customReason} onChange={(event) => setCustomReason(event.target.value)} placeholder="Reason or category" /><input inputMode="decimal" value={customDollars} onChange={(event) => setCustomDollars(event.target.value)} placeholder="$0.00" /><button type="button" onClick={addCustomSale}>Add to cart →</button></div> : <><div className="pos-products">{products.map(([key, label, amount, group]) => <button type="button" className={`pos-product ${key === "12-week-practice" ? "pos-product--featured" : ""}`} key={key} onClick={() => addCatalog(key)} aria-label={`Add ${label} for ${money(amount)}`}><div className="pos-product__mark">{key === "12-week-practice" ? "12" : group === "Upgrades" ? "↗" : "A"}</div><p>{group}</p><h3>{label}</h3>{key === "12-week-practice" && <span>24 sessions</span>}<footer><strong>{money(amount)}</strong></footer></button>)}</div>{!products.length && <p className="pos-no-products">No products match “{productQuery}”.</p>}</>}
          </>}
        </section>
        <aside className="pos-cart-pane">
          <div className="pos-cart-head"><div><p className="pos-label">Cart</p><h2>{cart.length} {cart.length === 1 ? "product" : "products"}</h2>{client && <small className="pos-cart-client">Customer · {client.name}</small>}</div><strong>{money(total)}</strong></div>
          {cartLines}
          <div className="pos-cart-total"><span>Total</span><strong>{money(total)}</strong></div>
          <button type="button" className="pos-checkout-bar" onClick={beginCheckout} disabled={!cart.length}>Checkout products<span>{money(total)} →</span></button>
        </aside>
      </div>
    </main>
  );
}
