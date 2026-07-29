import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getOwedStatus,
  getPosSale,
  getStripeSavedCards,
  recordPosCash,
  fulfillPosSale,
  chargePosSavedCard,
  searchContacts,
  startPosCheckout,
  type PosClient,
  type PosCheckoutOpen,
  type PosDraftLineInput,
  type PosPaymentLegInput,
  type PosPaymentMethod,
  type PosSale,
  type PurchaseEntry,
  type StripeSavedCard,
} from "../lib/api";
import type { ContactListItem } from "../types/staff";
import "./PosPage.css";

const CATALOG = [
  ["12-week-practice", "12-Week Amari Practice", 540000, "Practice", "12-week · 24 sessions"],
  ["6-week-practice", "6-Week Amari Practice", 300000, "Practice", "6-week · 12 sessions"],
  ["8-session-series", "8-session series", 129500, "Series", "Series"],
  ["4-session-series", "4-session series", 72000, "Series", "Series"],
  ["amari-assessment", "Assessment — $29 intro", 2900, "Single sessions", "Intro · 40 min"],
  ["initial-in-person", "Initial — in person", 22500, "Single sessions", "Single session"],
  ["initial-virtual", "Initial — virtual", 22500, "Single sessions", "Single session"],
  ["follow-up", "Single follow-up", 19000, "Single sessions", "Single session"],
  ["upgrade-initial-to-4", "Initial → 4 upgrade", 49500, "Upgrades", "Upgrade"],
  ["upgrade-initial-to-8", "Initial → 8 upgrade", 107000, "Upgrades", "Upgrade"],
  ["upgrade-4-to-8", "4 → 8 upgrade", 57500, "Upgrades", "Upgrade"],
  ["entrainment", "Entrainment", 9000, "Upgrades", "Add-on"],
  ["living-practice", "Living Practice", 34700, "Upgrades", "Add-on"],
] as const;

type CatalogKey = (typeof CATALOG)[number][0];
type CatalogGroup = (typeof CATALOG)[number][3];
type Panel =
  | null
  | "search"
  | "customer"
  | "customer-new"
  | "customer-detail"
  | "custom-sale"
  | "category"
  | "more"
  | "checkout"
  | "cash"
  | "split"
  | "complete"
  | "charge-confirm";

const paymentLabels: Record<PosPaymentMethod, string> = {
  "checkout-link": "Checkout link",
  "hsa-card": "HSA / FSA card",
  "saved-card": "Saved card",
  "manual-card": "Card",
  cash: "Cash",
  other: "Other",
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function cardLabel(card: StripeSavedCard) {
  const brand = (card.brand || "card").replace(/^./, (c) => c.toUpperCase());
  return `${brand} •••• ${card.last4}`;
}

const draftStorageKey = "amari_staff_pos_draft";

function catalogEntry(key: string) {
  return CATALOG.find(([k]) => k === key);
}

function lineUnitCents(line: PosDraftLineInput) {
  if (line.productKey) return catalogEntry(line.productKey)?.[2] || 0;
  return line.customAmountCents || 0;
}

function lineLabel(line: PosDraftLineInput) {
  if (line.productKey) return catalogEntry(line.productKey)?.[1] || line.productKey;
  return line.customLabel || "Custom sale";
}

function lineKey(line: PosDraftLineInput) {
  if (line.productKey) return `catalog:${line.productKey}`;
  return `custom:${line.customLabel}|${line.customReason}|${line.customAmountCents}`;
}

function calculateTotal(cart: PosDraftLineInput[]) {
  return cart.reduce((sum, line) => sum + lineUnitCents(line) * (line.quantity || 1), 0);
}

function toDraftCart(sale: PosSale): PosDraftLineInput[] {
  return sale.cart.map((line) =>
    line.kind === "catalog"
      ? { productKey: line.productKey || undefined, quantity: line.quantity }
      : {
          customLabel: line.label,
          customReason: line.reason || "",
          customAmountCents: line.unitAmountCents,
          quantity: line.quantity,
        },
  );
}

function toDraftLegs(sale: PosSale): PosPaymentLegInput[] {
  return sale.paymentLegs.map(({ method, amountCents }) => ({ method, amountCents }));
}

function cashSuggestions(totalCents: number) {
  if (totalCents < 1) return [];
  const exact = totalCents;
  const values = new Set<number>([exact]);
  const dollars = Math.ceil(totalCents / 100);
  values.add(dollars * 100);
  for (const step of [1, 5, 10, 20, 50, 100]) {
    const rounded = Math.ceil(dollars / step) * step * 100;
    if (rounded >= totalCents) values.add(rounded);
  }
  return [...values].sort((a, b) => a - b).slice(0, 4);
}

export default function PosPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState<Panel>(null);
  const [category, setCategory] = useState<CatalogGroup>("Series");
  const [client, setClient] = useState<PosClient | null>(null);
  const [cart, setCart] = useState<PosDraftLineInput[]>([]);
  const [legs, setLegs] = useState<PosPaymentLegInput[]>([]);
  const [sale, setSale] = useState<PosSale | null>(null);
  const [checkouts, setCheckouts] = useState<PosCheckoutOpen[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [matches, setMatches] = useState<ContactListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [productMatches, setProductMatches] = useState<typeof CATALOG[number][]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseEntry[] | null>(null);
  const [purchaseHistoryError, setPurchaseHistoryError] = useState("");
  const [detailClient, setDetailClient] = useState<PosClient | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customReason, setCustomReason] = useState("Custom sale");
  const [customDollars, setCustomDollars] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [cashDollars, setCashDollars] = useState("");
  const [cashReceivedCents, setCashReceivedCents] = useState(0);
  const [selectedPayment, setSelectedPayment] = useState<PosPaymentMethod | "split" | null>(null);
  const [savedCards, setSavedCards] = useState<StripeSavedCard[]>([]);
  const [savedCardsReason, setSavedCardsReason] = useState<string | null>(null);
  const [pendingChargeCard, setPendingChargeCard] = useState<StripeSavedCard | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const customerTimer = useRef<ReturnType<typeof setTimeout>>();
  const hydratedSale = useRef<string | null>(null);

  const total = useMemo(() => calculateTotal(cart), [cart]);
  const allocation = useMemo(() => legs.reduce((sum, leg) => sum + (Number(leg.amountCents) || 0), 0), [legs]);
  const unpaidCashLeg = sale?.paymentLegs?.find((leg) => leg.method === "cash" && leg.status !== "paid");
  const cashTargetCents = unpaidCashLeg?.amountCents ?? total;
  const suggestions = useMemo(() => cashSuggestions(cashTargetCents), [cashTargetCents]);
  const primarySavedCard = savedCards[0] || null;
  const inCheckout =
    panel === "checkout" || panel === "cash" || panel === "split" || panel === "complete" || panel === "charge-confirm";

  useEffect(() => {
    const fromQuery = searchParams.get("sale");
    const checkoutState = searchParams.get("checkout");
    const id = fromQuery || localStorage.getItem(draftStorageKey);
    if (!id || hydratedSale.current === id) return;
    hydratedSale.current = id;
    void getPosSale(id)
      .then(({ sale: loaded }) => {
        setSale(loaded);
        setClient(loaded.client);
        setCart(toDraftCart(loaded));
        setLegs(toDraftLegs(loaded));
        localStorage.setItem(draftStorageKey, loaded.id);
        const openUrls = (loaded.paymentLegs || [])
          .filter((leg) => leg.stripeCheckoutUrl)
          .map((leg) => ({
            legId: leg.id,
            url: leg.stripeCheckoutUrl as string,
            sessionId: leg.stripeCheckoutSessionId || "",
          }));
        setCheckouts(openUrls);
        if (loaded.status === "paid") {
          setPanel("complete");
          setNotice("Payment received.");
        } else if (checkoutState === "success") {
          setPanel("checkout");
          setNotice("If payment succeeded, this sale will show paid after Stripe’s webhook lands. Pull to refresh or reopen the sale.");
        } else if (openUrls.length) {
          setPanel("checkout");
        }
      })
      .catch(() => {
        if (!fromQuery) localStorage.removeItem(draftStorageKey);
      })
      .finally(() => {
        if (fromQuery || checkoutState) {
          setSearchParams({}, { replace: true });
        }
      });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (panel !== "search") return;
    const query = searchQuery.trim().toLowerCase();
    setProductMatches(
      query.length < 1
        ? []
        : CATALOG.filter(([, label, , group]) => `${label} ${group}`.toLowerCase().includes(query)),
    );
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.length < 2) {
      setMatches([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      void searchContacts(searchQuery.trim())
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [panel, searchQuery]);

  useEffect(() => {
    if (panel !== "customer" && panel !== "customer-new") return;
    if (customerTimer.current) clearTimeout(customerTimer.current);
    if (customerQuery.trim().length < 2) {
      setMatches([]);
      return;
    }
    customerTimer.current = setTimeout(() => {
      setSearching(true);
      void searchContacts(customerQuery.trim())
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (customerTimer.current) clearTimeout(customerTimer.current);
    };
  }, [panel, customerQuery]);

  useEffect(() => {
    const target = detailClient || (panel === "customer-detail" ? client : null);
    if (!target || target.id.startsWith("draft_")) {
      setPurchaseHistory(target ? [] : null);
      setPurchaseHistoryError("");
      return;
    }
    let cancelled = false;
    setPurchaseHistory(null);
    setPurchaseHistoryError("");
    void getOwedStatus(target.id)
      .then((result) => {
        if (!cancelled) setPurchaseHistory(result.purchases || []);
      })
      .catch(() => {
        if (!cancelled) setPurchaseHistoryError("Purchase history is unavailable right now.");
      });
    return () => {
      cancelled = true;
    };
  }, [detailClient?.id, client?.id, panel]);

  useEffect(() => {
    if (!client || client.id.startsWith("draft_")) {
      setSavedCards([]);
      setSavedCardsReason(client ? "draft_client" : null);
      return;
    }
    let cancelled = false;
    setSavedCards([]);
    setSavedCardsReason("loading");
    void getStripeSavedCards(client.id)
      .then((result) => {
        if (cancelled) return;
        setSavedCards(result.cards || []);
        setSavedCardsReason(result.available ? null : result.reason || "no_cards");
      })
      .catch(() => {
        if (cancelled) return;
        setSavedCards([]);
        setSavedCardsReason("lookup_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  function closePanel() {
    setPanel(null);
    setNotice("");
    setSearchQuery("");
    setCustomerQuery("");
    setDetailClient(null);
    setSelectedPayment(null);
    setPendingChargeCard(null);
  }

  function openSearch() {
    setNotice("");
    setSearchQuery("");
    setMatches([]);
    setProductMatches([]);
    setPanel("search");
  }

  function openCustomer() {
    setNotice("");
    setCustomerQuery("");
    setMatches([]);
    setPanel("customer");
  }

  function openCategory(next: CatalogGroup) {
    setCategory(next);
    setPanel("category");
  }

  function addOrIncrementCatalog(productKey: CatalogKey) {
    setCart((current) => {
      const index = current.findIndex((line) => line.productKey === productKey);
      if (index === -1) return [...current, { productKey, quantity: 1 }];
      return current.map((line, i) =>
        i === index ? { ...line, quantity: Math.min(20, (line.quantity || 1) + 1) } : line,
      );
    });
    setNotice("");
  }

  function addCustomSale() {
    const amountCents = Math.round(Number(customDollars) * 100);
    const quantity = Number(customQty);
    if (!customLabel.trim() || !Number.isSafeInteger(amountCents) || amountCents < 1) {
      setNotice("Add a name and a valid price.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      setNotice("Quantity must be between 1 and 20.");
      return;
    }
    setCart((current) => [
      ...current,
      {
        customLabel: customLabel.trim(),
        customReason: customReason.trim() || "Custom sale",
        customAmountCents: amountCents,
        quantity,
      },
    ]);
    setCustomLabel("");
    setCustomReason("Custom sale");
    setCustomDollars("");
    setCustomQty("1");
    setNotice("");
    setPanel(null);
  }

  function removeLine(index: number) {
    setCart((current) => current.filter((_, i) => i !== index));
  }

  function clearCart() {
    setCart([]);
    setLegs([]);
    setSale(null);
    setCheckouts([]);
    setNotice("");
    setSelectedPayment(null);
    hydratedSale.current = null;
    localStorage.removeItem(draftStorageKey);
    if (inCheckout) setPanel(null);
  }

  function removeCustomer() {
    setClient(null);
    setDetailClient(null);
    setPurchaseHistory(null);
    setNotice("");
  }

  function selectClient(contact: ContactListItem, attach = true) {
    const next = {
      id: contact.id,
      name: contact.name,
      phone: contact.phone || null,
      email: contact.email || null,
    };
    if (attach) {
      setClient(next);
      setPanel(null);
      setCustomerQuery("");
      setSearchQuery("");
      setMatches([]);
      setNotice("");
      return;
    }
    setDetailClient(next);
    setPanel("customer-detail");
  }

  function attachDetailClient() {
    if (!detailClient) return;
    setClient(detailClient);
    setDetailClient(null);
    setPanel(null);
    setNotice("");
  }

  function saveNewCustomer() {
    const name = [newFirst.trim(), newLast.trim()].filter(Boolean).join(" ");
    const phone = newPhone.trim();
    const email = newEmail.trim().toLowerCase();
    if (!name || (!phone && !email)) {
      setNotice("Add a first name and at least a phone number or email.");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice("Add a valid email address or leave it blank.");
      return;
    }
    setClient({
      id: `draft_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      phone: phone || null,
      email: email || null,
    });
    setNewFirst("");
    setNewLast("");
    setNewPhone("");
    setNewEmail("");
    setNotice("");
    setPanel(null);
  }

  function beginCheckout() {
    if (!cart.length) {
      setNotice("Add at least one product before checkout.");
      return;
    }
    if (!client) {
      setNotice("Add a customer before checkout.");
      openCustomer();
      return;
    }
    setNotice("");
    setSelectedPayment(null);
    setPanel("checkout");
  }

  function applySale(next: PosSale, opened: PosCheckoutOpen[] = []) {
    setSale(next);
    setClient(next.client);
    setCart(toDraftCart(next));
    setLegs(toDraftLegs(next));
    localStorage.setItem(draftStorageKey, next.id);
    if (opened.length) setCheckouts(opened);
    else {
      setCheckouts(
        (next.paymentLegs || [])
          .filter((leg) => leg.stripeCheckoutUrl)
          .map((leg) => ({
            legId: leg.id,
            url: leg.stripeCheckoutUrl as string,
            sessionId: leg.stripeCheckoutSessionId || "",
          })),
      );
    }
    if (next.status === "paid") setPanel("complete");
  }

  async function startStripeCheckout(paymentLegs: PosPaymentLegInput[]) {
    if (!client || !cart.length) return false;
    if (client.id.startsWith("draft_")) {
      setNotice("Select an existing GHL customer before taking card payment.");
      openCustomer();
      return false;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await startPosCheckout({
        id: sale?.id,
        version: sale?.version,
        client,
        cart,
        paymentLegs,
      });
      applySale(result.sale, result.checkouts);
      const first = result.checkouts[0];
      if (first?.url) {
        window.open(first.url, "_blank", "noopener,noreferrer");
        setNotice("Stripe window opened. When they’ve paid, tap Check payment.");
      } else {
        setNotice("Checkout saved. No Stripe link was returned.");
      }
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start Stripe Checkout.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function chooseCard() {
    setSelectedPayment("manual-card");
    const paymentLegs = total ? [{ method: "manual-card" as const, amountCents: total }] : [];
    setLegs(paymentLegs);
    await startStripeCheckout(paymentLegs);
  }

  function chooseSavedCard() {
    if (!primarySavedCard) {
      setNotice("No proven card on file for this customer. Use Card (Checkout) first.");
      return;
    }
    setSelectedPayment("saved-card");
    const paymentLegs = total ? [{ method: "saved-card" as const, amountCents: total }] : [];
    setLegs(paymentLegs);
    setPendingChargeCard(primarySavedCard);
    setPanel("charge-confirm");
  }

  async function confirmSavedCardCharge() {
    if (!client || !cart.length || !pendingChargeCard) return;
    const paymentLegs = legs.length ? legs : total ? [{ method: "saved-card" as const, amountCents: total }] : [];
    const label = cardLabel(pendingChargeCard);
    setBusy(true);
    setNotice("");
    try {
      const result = await chargePosSavedCard({
        id: sale?.id,
        version: sale?.version,
        client,
        cart,
        paymentLegs,
        paymentMethodId: pendingChargeCard.id,
        confirmed: true,
      });
      applySale(result.sale);
      setPendingChargeCard(null);
      setNotice(
        result.sale.fulfillmentStatus === "fulfilled"
          ? `Charged ${label}. GHL updated.`
          : `Charged ${label}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not charge card on file.");
      setPanel("checkout");
    } finally {
      setBusy(false);
    }
  }

  async function chooseCheckoutLink() {
    setSelectedPayment("checkout-link");
    const paymentLegs = total ? [{ method: "checkout-link" as const, amountCents: total }] : [];
    setLegs(paymentLegs);
    if (!client?.phone && !client?.email) {
      setNotice("Add a phone or email before creating a checkout link.");
      return;
    }
    await startStripeCheckout(paymentLegs);
  }

  function openCash() {
    setSelectedPayment("cash");
    setCashDollars((total / 100).toFixed(2));
    setPanel("cash");
  }

  function openSplit() {
    setSelectedPayment("split");
    const existing =
      legs.length === 2
        ? legs
        : [
            { method: "manual-card" as const, amountCents: Math.floor(total / 2) },
            { method: "cash" as const, amountCents: total - Math.floor(total / 2) },
          ];
    setLegs(existing);
    setPanel("split");
  }

  async function confirmCash(amountCents = Math.round(Number(cashDollars) * 100)) {
    if (!client || !cart.length) return;
    const requiredCents = unpaidCashLeg?.amountCents ?? total;
    if (!Number.isSafeInteger(amountCents) || amountCents < requiredCents) {
      setNotice(`Cash received needs to cover ${money(requiredCents)}.`);
      return;
    }
    const paymentLegs =
      sale?.paymentLegs?.length
        ? toDraftLegs(sale)
        : total
          ? [{ method: "cash" as const, amountCents: total }]
          : [];
    setBusy(true);
    setNotice("");
    try {
      const result = await recordPosCash({
        id: sale?.id,
        version: sale?.version,
        client,
        cart,
        paymentLegs,
        paymentLegId: unpaidCashLeg?.id,
        cashReceivedCents: amountCents,
      });
      setCashReceivedCents(amountCents);
      applySale(result.sale);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record cash.");
    } finally {
      setBusy(false);
    }
  }

  function openCashForLeg(legAmountCents: number) {
    setSelectedPayment("cash");
    setCashDollars((legAmountCents / 100).toFixed(2));
    setPanel("cash");
  }

  function updateSplitAmount(index: number, amountCents: number) {
    setLegs((current) => {
      const exactAmount = Math.min(Math.max(0, amountCents), total);
      const next = current.map((leg, i) => (i === index ? { ...leg, amountCents: exactAmount } : leg));
      if (next.length === 2) {
        const other = index === 0 ? 1 : 0;
        next[other] = { ...next[other], amountCents: total - exactAmount };
      }
      return next;
    });
  }

  async function confirmSplit() {
    if (!client) {
      setNotice("Select a client to continue.");
      return;
    }
    if (legs.length !== 2 || allocation !== total) {
      setNotice("Payment amounts need to equal the cart total.");
      return;
    }
    const stripeLegs = legs.filter((leg) => leg.method !== "cash" && leg.method !== "other");
    const cashLeg = legs.find((leg) => leg.method === "cash");

    setBusy(true);
    setNotice("");
    try {
      let currentSale = sale;
      if (stripeLegs.length) {
        const result = await startPosCheckout({
          id: currentSale?.id,
          version: currentSale?.version,
          client,
          cart,
          paymentLegs: legs,
        });
        applySale(result.sale, result.checkouts);
        currentSale = result.sale;
        const first = result.checkouts[0];
        if (first?.url) window.open(first.url, "_blank", "noopener,noreferrer");
      }
      if (cashLeg && !stripeLegs.length) {
        const result = await recordPosCash({
          id: currentSale?.id,
          version: currentSale?.version,
          client,
          cart,
          paymentLegs: legs,
          cashReceivedCents: cashLeg.amountCents,
        });
        setCashReceivedCents(cashLeg.amountCents);
        applySale(result.sale);
      } else if (cashLeg && stripeLegs.length) {
        setNotice("Card portion opened in Stripe. When that pays, record the cash portion here.");
        setPanel("checkout");
      } else {
        setPanel("checkout");
        setNotice("Stripe window opened. When they’ve paid, tap Check payment.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start split checkout.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshSale() {
    if (!sale?.id) return;
    setBusy(true);
    try {
      let result = await getPosSale(sale.id);
      if (result.sale.status === "paid" && result.sale.fulfillmentStatus !== "fulfilled") {
        try {
          result = await fulfillPosSale(result.sale.id);
        } catch {
          // Keep the refreshed sale even if retry fails.
        }
      }
      applySale(result.sale);
      setNotice(
        result.sale.fulfillmentStatus === "fulfilled"
          ? "Payment received and GHL updated."
          : result.sale.status === "paid"
            ? "Payment received."
            : `Sale status: ${result.sale.status.replace(/_/g, " ")}`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not refresh sale.");
    } finally {
      setBusy(false);
    }
  }

  function copyCheckout(url: string) {
    void navigator.clipboard.writeText(url).then(
      () => setNotice("Checkout link copied."),
      () => setNotice(url),
    );
  }

  function finishSale() {
    setCart([]);
    setClient(null);
    setLegs([]);
    setSale(null);
    setCheckouts([]);
    setCashReceivedCents(0);
    setSelectedPayment(null);
    setNotice("");
    hydratedSale.current = null;
    localStorage.removeItem(draftStorageKey);
    setPanel(null);
  }

  const statusLabel = sale?.fulfillmentStatus === "fulfilled"
    ? "Fulfilled"
    : sale?.status === "paid"
      ? "Paid"
      : sale?.status === "partially_paid"
        ? "Partially paid"
        : sale?.status === "awaiting_payment"
          ? "Awaiting payment"
          : "Ready";

  const awaitingPayment = Boolean(
    sale &&
      (sale.status === "awaiting_payment" ||
        sale.status === "partially_paid" ||
        checkouts.some((item) => Boolean(item.url)) ||
        (sale.paymentLegs || []).some((leg) => Boolean(leg.stripeCheckoutUrl) && leg.status !== "paid")),
  );

  const categoryProducts = CATALOG.filter(([, , , group]) => group === category);

  return (
    <main className="pos-shell" data-theme="dark">
      <aside className="pos-nav" aria-label="POS navigation">
        <button type="button" className="pos-nav__btn" onClick={() => navigate("/")} aria-label="Home">
          <span aria-hidden="true">⌂</span>
          <small>Home</small>
        </button>
        <button type="button" className="pos-nav__btn" onClick={openSearch} aria-label="Search">
          <span aria-hidden="true">⌕</span>
          <small>Search</small>
        </button>
        <button type="button" className="pos-nav__btn" onClick={() => setPanel("more")} aria-label="More actions">
          <span aria-hidden="true">···</span>
          <small>More</small>
        </button>
      </aside>

      <section className="pos-main">
        <header className="pos-top">
          <strong>Amari POS</strong>
          <span className="pos-top__status">{statusLabel}</span>
        </header>

        {notice && !panel && <div className="pos-notice">{notice}</div>}

        {panel === null && (
          <div className="pos-grid-wrap">
            <button type="button" className="pos-search-launch" onClick={openSearch}>
              <span aria-hidden="true">⌕</span>
              Search products or customers
            </button>
            <div className="pos-smart-grid">
              <button
                type="button"
                className={`pos-tile pos-tile--customer ${client ? "is-remove" : ""}`}
                onClick={client ? removeCustomer : openCustomer}
              >
                <strong>{client ? "Remove customer" : "Add customer"}</strong>
                <small>{client ? client.name : "Search or create"}</small>
              </button>
              <button type="button" className="pos-tile pos-tile--custom" onClick={() => setPanel("custom-sale")}>
                <strong>Custom sale</strong>
                <small>Name, qty, price</small>
              </button>
              <button
                type="button"
                className="pos-tile pos-tile--practice"
                onClick={() => addOrIncrementCatalog("12-week-practice")}
              >
                <strong>12-Week Practice</strong>
                <small>{money(540000)}</small>
              </button>
              <button
                type="button"
                className="pos-tile pos-tile--practice-6"
                onClick={() => addOrIncrementCatalog("6-week-practice")}
              >
                <strong>6-Week Practice</strong>
                <small>{money(300000)}</small>
              </button>
              <button
                type="button"
                className="pos-tile pos-tile--assessment"
                onClick={() => addOrIncrementCatalog("amari-assessment")}
              >
                <strong>Assessment</strong>
                <small>{money(2900)}</small>
              </button>
              <button type="button" className="pos-tile pos-tile--series" onClick={() => openCategory("Series")}>
                <strong>Series</strong>
                <small>4- and 8-session</small>
              </button>
              <button type="button" className="pos-tile pos-tile--upgrades" onClick={() => openCategory("Upgrades")}>
                <strong>Upgrades</strong>
                <small>Continuation</small>
              </button>
              <button
                type="button"
                className="pos-tile pos-tile--sessions"
                onClick={() => openCategory("Single sessions")}
              >
                <strong>Single sessions</strong>
                <small>Initials & follow-ups</small>
              </button>
            </div>
          </div>
        )}

        {panel === "search" && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={closePanel}>Back</button>
              <strong>Search</strong>
              <span />
            </div>
            <label className="pos-field-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products or customers"
                autoFocus
              />
              {searchQuery && (
                <button type="button" aria-label="Clear search" onClick={() => setSearchQuery("")}>
                  ×
                </button>
              )}
            </label>
            {searching && <p className="pos-muted">Searching…</p>}
            {productMatches.length > 0 && (
              <section className="pos-result-block">
                <p className="pos-section-label">Products</p>
                {productMatches.map(([key, label, amount, , detail]) => (
                  <button type="button" className="pos-result-row" key={key} onClick={() => { addOrIncrementCatalog(key); closePanel(); }}>
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                    <b>{money(amount)}</b>
                  </button>
                ))}
              </section>
            )}
            {matches.length > 0 && (
              <section className="pos-result-block">
                <p className="pos-section-label">Customers</p>
                {matches.map((contact) => (
                  <button type="button" className="pos-result-row" key={contact.id} onClick={() => selectClient(contact, false)}>
                    <span>
                      <strong>{contact.name}</strong>
                      <small>{contact.phone || contact.email || "No contact detail"}</small>
                    </span>
                    <b>View</b>
                  </button>
                ))}
              </section>
            )}
            {searchQuery.trim().length >= 2 && !searching && !productMatches.length && !matches.length && (
              <p className="pos-muted">No products or customers matched.</p>
            )}
          </div>
        )}

        {panel === "category" && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={closePanel}>Back</button>
              <strong>{category}</strong>
              <span />
            </div>
            <div className="pos-product-list">
              {categoryProducts.map(([key, label, amount, , detail]) => (
                <button type="button" className="pos-product-row" key={key} onClick={() => addOrIncrementCatalog(key)}>
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                  <b>{money(amount)}</b>
                </button>
              ))}
            </div>
          </div>
        )}

        {panel === "customer" && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={closePanel}>Cancel</button>
              <strong>Add customer</strong>
              <span />
            </div>
            <label className="pos-field-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search customers…"
                autoFocus
              />
            </label>
            <button type="button" className="pos-secondary-btn" onClick={() => { setNotice(""); setPanel("customer-new"); }}>
              New customer
            </button>
            {searching && <p className="pos-muted">Searching…</p>}
            {matches.map((contact) => (
              <button type="button" className="pos-result-row" key={contact.id} onClick={() => selectClient(contact, false)}>
                <span>
                  <strong>{contact.name}</strong>
                  <small>{contact.phone || contact.email || "No contact detail"}</small>
                </span>
                <b>View details</b>
              </button>
            ))}
            {customerQuery.trim().length >= 2 && !searching && !matches.length && (
              <p className="pos-muted">No existing customer found.</p>
            )}
          </div>
        )}

        {panel === "customer-new" && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={() => setPanel("customer")}>Cancel</button>
              <strong>New customer</strong>
              <button type="button" onClick={saveNewCustomer}>Save</button>
            </div>
            {notice && <div className="pos-notice">{notice}</div>}
            <p className="pos-section-label">Contact information</p>
            <label className="pos-input-row">
              First name
              <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)} autoComplete="given-name" autoFocus />
              <small>Required</small>
            </label>
            <label className="pos-input-row">
              Last name
              <input value={newLast} onChange={(e) => setNewLast(e.target.value)} autoComplete="family-name" />
            </label>
            <label className="pos-input-row">
              Email address
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} inputMode="email" autoComplete="email" />
            </label>
            <label className="pos-input-row">
              Phone number
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
            </label>
            <p className="pos-muted">Phone or email is required. Customer is attached to this sale on save.</p>
          </div>
        )}

        {panel === "customer-detail" && (detailClient || client) && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={() => { setDetailClient(null); setPanel(client ? null : "customer"); }}>Back</button>
              <strong>Customer</strong>
              <button type="button" className="is-danger" onClick={() => { removeCustomer(); closePanel(); }}>Remove</button>
            </div>
            <h1 className="pos-panel-title">{(detailClient || client)?.name}</h1>
            <p className="pos-muted">
              {[ (detailClient || client)?.phone, (detailClient || client)?.email ].filter(Boolean).join(" · ") || "No contact detail"}
            </p>
            {client && (detailClient || client)?.id === client.id && (
              <p className="pos-card-on-file">
                {primarySavedCard
                  ? `Card on file: ${cardLabel(primarySavedCard)}`
                  : savedCardsReason === "loading"
                    ? "Checking card on file…"
                    : savedCardsReason === "no_cards"
                      ? "No reusable card saved in Stripe"
                      : savedCardsReason === "no_proven_customer"
                        ? "No linked Stripe customer for this contact"
                        : savedCardsReason === "lookup_failed"
                          ? "Card lookup failed — try again"
                          : "No proven card on file"}
              </p>
            )}
            <button type="button" className="pos-primary-btn" onClick={attachDetailClient}>
              Add customer
            </button>
            <p className="pos-section-label">Orders</p>
            {(detailClient || client)?.id.startsWith("draft_") ? (
              <p className="pos-muted">No purchase history yet.</p>
            ) : purchaseHistory === null ? (
              <p className="pos-muted">Loading…</p>
            ) : purchaseHistoryError ? (
              <p className="pos-muted">{purchaseHistoryError}</p>
            ) : purchaseHistory.length ? (
              <div className="pos-orders">
                {purchaseHistory.map((purchase, index) => (
                  <article key={`${purchase.date}-${purchase.label}-${index}`}>
                    <span>
                      <strong>{purchase.label}</strong>
                      <small>
                        {purchase.date
                          ? new Date(`${purchase.date}T12:00:00`).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "Date unavailable"}
                      </small>
                    </span>
                    <b>{money(Math.round(purchase.amount * 100))}</b>
                  </article>
                ))}
              </div>
            ) : (
              <p className="pos-muted">No verified purchases found.</p>
            )}
          </div>
        )}

        {panel === "custom-sale" && (
          <div className="pos-modal-scrim" role="presentation" onClick={closePanel}>
            <div className="pos-modal" role="dialog" aria-labelledby="custom-sale-title" onClick={(e) => e.stopPropagation()}>
              <h2 id="custom-sale-title">Custom sale</h2>
              {notice && <div className="pos-notice">{notice}</div>}
              <label>
                Product name
                <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Gift wrap service" autoFocus />
              </label>
              <label>
                Quantity
                <input value={customQty} onChange={(e) => setCustomQty(e.target.value)} inputMode="numeric" />
              </label>
              <label>
                Price
                <input value={customDollars} onChange={(e) => setCustomDollars(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </label>
              <label>
                Reason
                <input value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Custom sale" />
              </label>
              <button type="button" className="pos-primary-btn" onClick={addCustomSale}>Add to cart</button>
              <button type="button" className="pos-ghost-btn" onClick={closePanel}>Cancel</button>
            </div>
          </div>
        )}

        {panel === "more" && (
          <div className="pos-modal-scrim" role="presentation" onClick={closePanel}>
            <div className="pos-modal pos-modal--sheet" role="dialog" aria-labelledby="more-title" onClick={(e) => e.stopPropagation()}>
              <h2 id="more-title">More actions</h2>
              <button type="button" className="pos-sheet-row" onClick={() => { setPanel(null); openCustomer(); }}>
                Add customer
              </button>
              <button type="button" className="pos-sheet-row" onClick={() => { setPanel(null); setPanel("custom-sale"); }}>
                Custom sale
              </button>
              <button type="button" className="pos-sheet-row is-danger" onClick={() => { clearCart(); closePanel(); }} disabled={!cart.length && !client}>
                Clear cart
              </button>
              <button type="button" className="pos-ghost-btn" onClick={closePanel}>Close</button>
            </div>
          </div>
        )}

        {panel === "checkout" && (
          <div className="pos-panel pos-panel--checkout">
            <div className="pos-panel__bar">
              <button type="button" onClick={() => setPanel(null)}>Cancel</button>
              <strong>Total {money(total)}</strong>
              {awaitingPayment ? (
                <button type="button" onClick={() => void refreshSale()} disabled={busy || !sale}>Refresh</button>
              ) : (
                <span />
              )}
            </div>
            {notice && <div className="pos-notice">{notice}</div>}

            {awaitingPayment ? (
              <>
                <h1 className="pos-panel-title">Waiting for payment</h1>
                <p className="pos-muted">
                  {(sale?.paymentLegs || []).filter((leg) => leg.status !== "paid").length > 1
                    ? "Finish each unpaid portion below. When Stripe is done, check payment status."
                    : "Finish payment in the Stripe window. Come back here and check status when it’s done."}
                </p>
                <section className="pos-await-legs">
                  {(sale?.paymentLegs || []).map((leg) => {
                    const checkout =
                      checkouts.find((item) => item.legId === leg.id) ||
                      (leg.stripeCheckoutUrl
                        ? { legId: leg.id, url: leg.stripeCheckoutUrl, sessionId: leg.stripeCheckoutSessionId || "" }
                        : null);
                    const paid = leg.status === "paid";
                    const stripeLike = leg.method !== "cash" && leg.method !== "other" && leg.method !== "saved-card";
                    return (
                      <article className={`pos-await-leg ${paid ? "is-paid" : ""}`} key={leg.id}>
                        <div className="pos-await-leg__meta">
                          <strong>{paymentLabels[leg.method] || leg.method}</strong>
                          <span>{money(leg.amountCents)}</span>
                          <small>
                            {paid
                              ? "Paid"
                              : leg.method === "cash"
                                ? "Collect cash"
                                : leg.method === "saved-card"
                                  ? "Charge card on file"
                                  : "Pay in Stripe window"}
                          </small>
                        </div>
                        {!paid && checkout?.url && stripeLike && (
                          <div className="pos-await-recovery">
                            <button
                              type="button"
                              className="pos-text-btn"
                              onClick={() => window.open(checkout.url, "_blank", "noopener,noreferrer")}
                            >
                              Open again
                            </button>
                            <span aria-hidden="true">·</span>
                            <button type="button" className="pos-text-btn" onClick={() => copyCheckout(checkout.url)}>
                              Copy link
                            </button>
                          </div>
                        )}
                        {!paid && leg.method === "cash" && (
                          <button
                            type="button"
                            className="pos-primary-btn"
                            onClick={() => openCashForLeg(leg.amountCents)}
                            disabled={busy}
                          >
                            Record cash {money(leg.amountCents)}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </section>
                <button type="button" className="pos-primary-btn" onClick={() => void refreshSale()} disabled={busy || !sale}>
                  {busy ? "Checking…" : "Check payment status"}
                </button>
              </>
            ) : (
              <>
                <p className="pos-checkout-prompt">How is this being paid?</p>
                {primarySavedCard && (
                  <p className="pos-card-on-file">Card on file: {cardLabel(primarySavedCard)}</p>
                )}
                <div className="pos-pay-grid">
                  <button
                    type="button"
                    className={`pos-pay-tile ${selectedPayment === "saved-card" ? "is-active" : ""}`}
                    onClick={chooseSavedCard}
                    disabled={busy || !primarySavedCard || !total}
                  >
                    Card on file
                    <small>{primarySavedCard ? cardLabel(primarySavedCard) : "None linked yet"}</small>
                  </button>
                  <button
                    type="button"
                    className={`pos-pay-tile ${selectedPayment === "manual-card" ? "is-active" : ""}`}
                    onClick={() => void chooseCard()}
                    disabled={busy}
                  >
                    New card
                    <small>Opens Stripe Checkout</small>
                  </button>
                  <button
                    type="button"
                    className={`pos-pay-tile ${selectedPayment === "cash" ? "is-active" : ""}`}
                    onClick={openCash}
                    disabled={busy}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    className={`pos-pay-tile ${selectedPayment === "checkout-link" ? "is-active" : ""}`}
                    onClick={() => void chooseCheckoutLink()}
                    disabled={busy}
                  >
                    Checkout link
                    <small>Open or copy URL</small>
                  </button>
                  <button
                    type="button"
                    className={`pos-pay-tile ${selectedPayment === "split" ? "is-active" : ""}`}
                    onClick={openSplit}
                    disabled={busy || !total}
                  >
                    Split payment
                    <small>Card + cash, etc.</small>
                  </button>
                </div>
                <p className="pos-muted">
                  {primarySavedCard
                    ? "Card on file charges immediately after you confirm. New card opens hosted Stripe Checkout and saves the card for next time."
                    : savedCardsReason === "loading"
                      ? "Checking for a card on file…"
                      : savedCardsReason === "no_cards"
                        ? "This customer has paid before, but Stripe has no reusable card saved. Use New card once to save one."
                        : "No proven card on file yet. Use New card once — it will save for next time."}
                </p>
              </>
            )}
          </div>
        )}

        {panel === "charge-confirm" && pendingChargeCard && (
          <div className="pos-modal-scrim" role="presentation" onClick={() => !busy && setPanel("checkout")}>
            <div className="pos-modal" role="dialog" aria-labelledby="charge-confirm-title" onClick={(e) => e.stopPropagation()}>
              <h2 id="charge-confirm-title">Charge card on file?</h2>
              <p className="pos-muted">
                Charge <strong>{cardLabel(pendingChargeCard)}</strong> for <strong>{money(total)}</strong> on{" "}
                <strong>{client?.name || "this customer"}</strong>?
              </p>
              <p className="pos-muted">This runs immediately. It is not a Checkout link.</p>
              {notice && <div className="pos-notice">{notice}</div>}
              <button type="button" className="pos-primary-btn" onClick={() => void confirmSavedCardCharge()} disabled={busy}>
                {busy ? "Charging…" : `Charge ${money(total)}`}
              </button>
              <button type="button" className="pos-ghost-btn" onClick={() => { setPendingChargeCard(null); setPanel("checkout"); }} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {panel === "cash" && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={() => setPanel("checkout")}>Back</button>
              <strong>Total {money(total)}</strong>
              <span>Accept cash</span>
            </div>
            {notice && <div className="pos-notice">{notice}</div>}
            <h1 className="pos-panel-title">Accept cash</h1>
            <p className="pos-muted">
              {unpaidCashLeg
                ? `Cash portion of this sale: ${money(unpaidCashLeg.amountCents)}.`
                : `Full sale total ${money(total)}.`}
            </p>
            <p className="pos-section-label">Amount received</p>
            <div className="pos-cash-suggestions">
              {suggestions.map((cents) => (
                <button type="button" key={cents} onClick={() => void confirmCash(cents)} disabled={busy}>
                  {money(cents)}
                </button>
              ))}
            </div>
            <label className="pos-input-row">
              Other amount
              <div className="pos-cash-other">
                <b>$</b>
                <input
                  value={cashDollars}
                  onChange={(e) => setCashDollars(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                />
              </div>
            </label>
            <button type="button" className="pos-primary-btn" onClick={() => void confirmCash()} disabled={busy}>
              {busy ? "Saving…" : "Record cash received"}
            </button>
          </div>
        )}

        {panel === "split" && (
          <div className="pos-panel">
            <div className="pos-panel__bar">
              <button type="button" onClick={() => setPanel("checkout")}>Back</button>
              <strong>Total {money(total)}</strong>
              <span>Split</span>
            </div>
            {notice && <div className="pos-notice">{notice}</div>}
            <h1 className="pos-panel-title">Split payment</h1>
            <div className="pos-split-legs">
              {legs.slice(0, 2).map((leg, index) => (
                <section key={`split-${index}`}>
                  <p className="pos-section-label">Payment {index + 1}</p>
                  <label className="pos-input-row">
                    Method
                    <select
                      value={leg.method}
                      onChange={(e) =>
                        setLegs((current) =>
                          current.map((value, i) =>
                            i === index ? { ...value, method: e.target.value as PosPaymentMethod } : value,
                          ),
                        )
                      }
                    >
                      {(["manual-card", "checkout-link", "cash", "hsa-card", "other"] as PosPaymentMethod[]).map((method) => (
                        <option key={method} value={method}>{paymentLabels[method]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="pos-input-row">
                    Exact amount
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={(leg.amountCents / 100).toFixed(2)}
                      onChange={(e) => updateSplitAmount(index, Math.round(Number(e.target.value) * 100) || 0)}
                    />
                  </label>
                </section>
              ))}
            </div>
            <div className={`pos-split-status ${allocation === total ? "is-ok" : ""}`}>
              <span>{allocation === total ? "Allocated exactly" : allocation < total ? "Remaining" : "Over by"}</span>
              <strong>{money(Math.abs(total - allocation))}</strong>
            </div>
            <button type="button" className="pos-primary-btn" onClick={() => void confirmSplit()} disabled={busy || allocation !== total}>
              {busy ? "Saving…" : "Confirm split plan"}
            </button>
          </div>
        )}

        {panel === "complete" && (
          <div className="pos-panel pos-panel--complete">
            <div className="pos-complete-mark" aria-hidden="true">✓</div>
            <h1 className="pos-panel-title">Order complete</h1>
            <p className="pos-complete-sub">
              {selectedPayment === "cash"
                ? `Change due: ${money(Math.max(0, cashReceivedCents - total))}`
                : sale?.fulfillmentStatus === "fulfilled"
                  ? "Payment received and GHL updated."
                  : sale?.fulfillmentStatus === "failed"
                    ? "Payment received, but GHL fulfillment failed — retry from sale refresh."
                    : sale?.status === "paid"
                      ? "Payment received. Fulfillment in progress."
                      : "Payment recorded"}
            </p>
            {client && (
              <section className="pos-complete-customer">
                <p className="pos-section-label">Customer</p>
                <strong>{client.name}</strong>
                <small>{[client.phone, client.email].filter(Boolean).join(" · ")}</small>
              </section>
            )}
            <p className="pos-muted">
              {sale?.fulfillmentStatus === "fulfilled"
                ? "Session credits / portal access applied when the cart included catalog products."
                : "Receipt email/SMS stays off until we turn it on."}
            </p>
            <button type="button" className="pos-primary-btn" onClick={finishSale}>Done</button>
          </div>
        )}
      </section>

      <aside className="pos-cart" aria-label="Cart">
        <div className="pos-cart__head">
          <strong>{inCheckout ? "Checkout" : "Cart"}</strong>
          <div className="pos-cart__head-actions">
            <button type="button" className="pos-cart__clear" onClick={clearCart} disabled={!cart.length && !client}>
              Clear
            </button>
            <button type="button" className="pos-cart__more" onClick={() => setPanel("more")}>
              More
            </button>
          </div>
        </div>

        {client ? (
          <div className="pos-customer-block">
            <button
              type="button"
              className="pos-customer-pill"
              onClick={() => {
                setDetailClient(client);
                setPanel("customer-detail");
              }}
            >
              {client.name}
            </button>
            {!client.id.startsWith("draft_") && (
              <p className={`pos-customer-card ${primarySavedCard ? "is-ready" : ""}`}>
                {savedCardsReason === "loading"
                  ? "Checking card on file…"
                  : primarySavedCard
                    ? `Card on file · ${cardLabel(primarySavedCard)}`
                    : savedCardsReason === "no_cards"
                      ? "Paid before, no reusable card saved"
                      : savedCardsReason === "no_proven_customer"
                        ? "No Stripe customer linked yet"
                        : savedCardsReason === "lookup_failed"
                          ? "Couldn’t check card on file"
                          : "No card on file"}
              </p>
            )}
          </div>
        ) : (
          <button type="button" className="pos-add-customer-link" onClick={openCustomer}>
            + Add customer
          </button>
        )}

        <div className="pos-cart__lines">
          {cart.length ? (
            cart.map((line, index) => {
              const unit = lineUnitCents(line);
              const qty = line.quantity || 1;
              return (
                <div className="pos-cart-line" key={`${lineKey(line)}-${index}`}>
                  <div className="pos-cart-line__mark" aria-hidden="true">
                    {(line.productKey === "12-week-practice"
                      ? "12"
                      : line.productKey === "6-week-practice"
                        ? "6"
                        : line.productKey === "amari-assessment"
                          ? "$"
                          : "A")}
                    <span>{qty}</span>
                  </div>
                  <div className="pos-cart-line__body">
                    <strong>{lineLabel(line)}</strong>
                    <small>Qty: {qty}</small>
                    {line.customReason && line.customLabel && <small>{line.customReason}</small>}
                  </div>
                  <div className="pos-cart-line__meta">
                    <b>{money(unit * qty)}</b>
                    <button type="button" aria-label={`Remove ${lineLabel(line)}`} onClick={() => removeLine(index)}>
                      ×
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="pos-cart-empty">Tap a product to start a sale.</p>
          )}
        </div>

        <div className="pos-cart__footer">
          <div className="pos-cart__subtotal">
            <span>Subtotal</span>
            <span>{money(total)}</span>
          </div>
          <div className="pos-cart__total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          {!inCheckout ? (
            <button type="button" className="pos-checkout-btn" onClick={beginCheckout} disabled={!cart.length}>
              Checkout →
            </button>
          ) : panel === "complete" ? (
            <button type="button" className="pos-checkout-btn" onClick={finishSale}>
              Done
            </button>
          ) : awaitingPayment ? (
            <button type="button" className="pos-checkout-btn" onClick={() => void refreshSale()} disabled={busy || !sale}>
              {busy ? "Checking…" : "Check payment"}
            </button>
          ) : (
            <div className="pos-checkout-btn pos-checkout-btn--static">Choose payment</div>
          )}
        </div>
      </aside>
    </main>
  );
}
