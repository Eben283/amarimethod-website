// Staff POS → GHL invoice boundary.
//
// A paid POS sale must become durable purchase evidence in GHL before any
// session/access fulfillment can be considered complete. This module never
// sends an invoice or payment link and never writes contact balance fields.

import { ghlFetch } from "./ghl.js";
import { GHL_PRODUCTS, PRICE_IDS, PURCHASE_CREDIT_MAP } from "./ghl-products.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const CURRENCY = "USD";

function dollars(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Invoice line amount must be a positive whole number of cents");
  }
  return cents / 100;
}

function invoiceItem(line) {
  const item = {
    name: String(line?.label || "").trim(),
    currency: CURRENCY,
    amount: dollars(line?.unitAmountCents),
    qty: line?.quantity,
  };
  if (!item.name) throw new Error("Invoice line name is required");
  if (!Number.isInteger(item.qty) || item.qty < 1) {
    throw new Error("Invoice line quantity must be a positive integer");
  }
  if (line?.kind === "catalog" && line.ghlProductId) {
    item.productId = line.ghlProductId;
    const currentPriceId = PRICE_IDS[line.ghlProductId]?.[0];
    if (currentPriceId) item.priceId = currentPriceId;
  }
  return item;
}

export function assessPosInvoiceSupport(cart = []) {
  const packageLines = [];
  const reasons = [];
  if (!Array.isArray(cart) || cart.length === 0) {
    return {
      supported: false,
      effect: "needs_review",
      reasons: ["A paid sale needs at least one invoice line"],
    };
  }

  for (const line of cart) {
    if (line?.kind === "custom" || !line?.ghlProductId) continue;
    const product = GHL_PRODUCTS[line.ghlProductId];
    if (!product) {
      reasons.push(`Unknown GHL catalog product ${line.ghlProductId}`);
      continue;
    }
    const quantity = Number.isInteger(line.quantity) ? line.quantity : 0;
    if (product.classification === "living-practice") {
      reasons.push("Standalone Living Practice access is not supported by the current invoice-paid path");
      continue;
    }
    const credit = PURCHASE_CREDIT_MAP[line.ghlProductId];
    if (!credit) continue;
    if (!product.isPackagePurchase) {
      reasons.push(`${product.name} session credit is not supported by the current invoice-paid path`);
      continue;
    }
    if (product.isAdditive) {
      reasons.push(`${product.name} needs the unresolved additive-upgrade rule`);
      continue;
    }
    if (quantity !== 1) {
      reasons.push(`${product.name} package quantity must be one`);
      continue;
    }
    packageLines.push(line);
  }

  if (packageLines.length > 1) {
    reasons.push("A Staff POS invoice can contain only one session package until aggregate fulfillment is proven");
  }
  if (reasons.length) {
    return { supported: false, effect: "needs_review", reasons };
  }
  return {
    supported: true,
    effect: packageLines.length === 1 ? "package" : "none",
    packageProductId: packageLines[0]?.ghlProductId || null,
    reasons: [],
  };
}

export function buildPosInvoiceRequest(sale, { issueDate } = {}) {
  if (!sale?.id || sale.status !== "paid") {
    throw new Error("Only a fully paid Staff POS sale can become a GHL invoice");
  }
  if (!sale.client?.id || !sale.client?.name) {
    throw new Error("A known GHL contact is required for invoice fulfillment");
  }
  if (!Array.isArray(sale.cart) || sale.cart.length === 0) {
    throw new Error("A paid sale needs invoice lines");
  }
  const resolvedIssueDate = issueDate || new Date().toISOString().slice(0, 10);
  // The current production ledger historically classified invoiceItems[0].
  // The bridge permits at most one package line, so put that durable credit
  // evidence first while preserving the relative order of every other line.
  const orderedCart = sale.cart
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const aPackage = GHL_PRODUCTS[a.line?.ghlProductId]?.isPackagePurchase ? 0 : 1;
      const bPackage = GHL_PRODUCTS[b.line?.ghlProductId]?.isPackagePurchase ? 0 : 1;
      return aPackage - bPackage || a.index - b.index;
    })
    .map(({ line }) => line);

  return {
    altId: LOCATION_ID,
    altType: "location",
    name: `Staff POS ${sale.id}`,
    title: "Amari Method Staff POS purchase",
    businessDetails: { name: "Amari Method" },
    currency: CURRENCY,
    items: orderedCart.map(invoiceItem),
    discount: { type: "fixed", value: 0 },
    contactDetails: {
      id: sale.client.id,
      name: sale.client.name,
      phoneNo: sale.client.phone || "",
      email: sale.client.email || "",
    },
    issueDate: resolvedIssueDate,
    sentTo: { email: [] },
    liveMode: true,
    termsNotes: `Payment already collected externally. Staff POS sale ${sale.id}. Do not send.`,
  };
}

function invoiceIdOf(invoice) {
  return invoice?._id || invoice?.id || null;
}

function invoiceHasSaleMarker(invoice, saleId) {
  const searchable = [invoice?.name, invoice?.title, invoice?.termsNotes]
    .filter((value) => typeof value === "string")
    .join(" ");
  return searchable.includes(saleId);
}

async function responseJson(response, operation) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Preserve the status-focused error below when a provider returns HTML.
  }
  if (!response.ok) {
    const detail = body?.message || body?.error || "GHL request failed";
    throw new Error(`${operation} failed (${response.status}): ${String(detail).slice(0, 200)}`);
  }
  return body || {};
}

export async function mirrorPaidPosSaleToGhlInvoice(
  context,
  sale,
  { onInvoiceIdentified = async () => {}, issueDate } = {},
) {
  const support = assessPosInvoiceSupport(sale?.cart);
  if (!support.supported) {
    const error = new Error(support.reasons.join("; "));
    error.code = "POS_INVOICE_NEEDS_REVIEW";
    throw error;
  }

  const query = new URLSearchParams({
    altId: LOCATION_ID,
    altType: "location",
    contactId: sale.client.id,
    limit: "100",
    offset: "0",
  });
  const listResponse = await ghlFetch(
    context,
    `${GHL_API_BASE}/invoices/?${query.toString()}`,
    { method: "GET", headers: { Version: "v3" } },
  );
  const listBody = await responseJson(listResponse, "Invoice recovery lookup");
  const knownInvoiceId = sale.fulfillment?.invoice?.id || sale.fulfillment?.invoiceId || null;
  let invoice = (listBody.invoices || []).find((candidate) =>
    (knownInvoiceId && invoiceIdOf(candidate) === knownInvoiceId)
      || invoiceHasSaleMarker(candidate, sale.id));
  let stage = "invoice_found";

  if (!invoice) {
    const createResponse = await ghlFetch(context, `${GHL_API_BASE}/invoices/`, {
      method: "POST",
      headers: { Version: "v3" },
      body: JSON.stringify(buildPosInvoiceRequest(sale, { issueDate })),
    });
    const createBody = await responseJson(createResponse, "Invoice creation");
    invoice = createBody.invoice || createBody;
    stage = "invoice_created";
  }

  const invoiceId = invoiceIdOf(invoice);
  if (!invoiceId) throw new Error("GHL invoice response did not include an invoice ID");
  await onInvoiceIdentified({
    stage,
    invoiceId,
    invoiceNumber: invoice.invoiceNumber || invoice.number || null,
    invoiceStatus: invoice.status || null,
    effect: support.effect,
  });

  if (String(invoice.status || "").toLowerCase() === "paid" && Number(invoice.amountPaid || 0) > 0) {
    return {
      stage: "payment_recorded",
      invoiceId,
      invoiceNumber: invoice.invoiceNumber || invoice.number || null,
      invoiceStatus: "paid",
      amountPaid: Number(invoice.amountPaid || 0),
      effect: support.effect,
      recovered: true,
    };
  }

  const paymentResponse = await ghlFetch(
    context,
    `${GHL_API_BASE}/invoices/${encodeURIComponent(invoiceId)}/record-payment`,
    {
      method: "POST",
      headers: { Version: "v3" },
      body: JSON.stringify({
        altId: LOCATION_ID,
        altType: "location",
        mode: "other",
        notes: `Verified external payment for Staff POS sale ${sale.id}. Do not send.`,
        amount: dollars(sale.totalCents),
        fulfilledAt: new Date().toISOString(),
      }),
    },
  );
  const paymentBody = await responseJson(paymentResponse, "Invoice payment recording");
  const paidInvoice = paymentBody.invoice || {};
  if (paymentBody.success === false || String(paidInvoice.status || "").toLowerCase() !== "paid") {
    throw new Error("GHL did not confirm the Staff POS invoice as paid");
  }
  return {
    stage: "payment_recorded",
    invoiceId,
    invoiceNumber: paidInvoice.invoiceNumber || paidInvoice.number || invoice.invoiceNumber || null,
    invoiceStatus: "paid",
    amountPaid: Number(paidInvoice.amountPaid || sale.totalCents / 100),
    effect: support.effect,
    recovered: stage === "invoice_found",
  };
}
