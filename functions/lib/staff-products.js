import { POS_CATALOG } from "./staff-pos.js";
import { assessPosInvoiceSupport } from "./staff-pos-invoice-bridge.js";

const MAX_NAME = 120;
const MAX_DESCRIPTION = 280;
const MAX_REASON = 120;
const MAX_AMOUNT_CENTS = 2_000_000;
const CATEGORIES = new Set(["service", "practice-support", "retail"]);

const BUILT_IN_META = Object.freeze({
  "12-week-practice": { name: "12-Week Amari Practice", category: "service", detail: "12 weeks · 24 sessions", salesPolicy: "current", effect: "24 sessions · portal + Living Practice" },
  "6-week-practice": { name: "6-Week Amari Practice", category: "service", detail: "6 weeks · 12 sessions", salesPolicy: "current", effect: "12 sessions · portal + Living Practice" },
  "single-session": { name: "Single Session", category: "service", detail: "50 minutes", salesPolicy: "current", effect: "One session credit" },
  "amari-assessment": { name: "Amari Assessment", category: "service", detail: "50-minute first visit", salesPolicy: "current", effect: "No session credit · booking separate" },
  "entrainment-20": { name: "Entrainment — 20 Minutes", category: "service", detail: "20 minutes", salesPolicy: "current", effect: "No prepaid-session effect · booking separate" },
  "living-practice": { name: "Living Practice", category: "practice-support", detail: "One year of access", salesPolicy: "current", effect: "Living Practice access" },
  "4-session-series": { name: "4-Session Series", category: "service", detail: "Founding members only", salesPolicy: "legacy", effect: "4 sessions · portal access" },
  "8-session-series": { name: "8-Session Series", category: "service", detail: "Founding members only", salesPolicy: "legacy", effect: "8 sessions · portal + Living Practice" },
  "follow-up": { name: "Founders Circle Follow-up", category: "service", detail: "Founding members only", salesPolicy: "legacy", effect: "One session credit" },
  "upgrade-4-to-8": { name: "Upgrade: 4-Session → 8-Session", category: "service", detail: "Founding members only", salesPolicy: "legacy", effect: "Adds 4 sessions · Living Practice" },
  "entrainment": { name: "Founders Circle Entrainment", category: "service", detail: "Founding members only", salesPolicy: "legacy", effect: "No prepaid-session effect" },
});

function text(value, max) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function builtInProducts() {
  return Object.entries(POS_CATALOG).map(([key, catalog]) => {
    const meta = BUILT_IN_META[key];
    if (!meta) throw new Error(`Missing Staff product metadata for ${key}`);
    const support = assessPosInvoiceSupport([{ kind: "catalog", ghlProductId: catalog.ghlProductId, quantity: 1 }]);
    const ready = support.supported && support.effect === "package";
    const readinessReasons = support.reasons.length
      ? support.reasons
      : ["This offer needs a complete owned post-payment record path before Staff can sell it."];
    return Object.freeze({
      key,
      version: 1,
      name: meta.name,
      amountCents: catalog.amountCents,
      currency: "USD",
      category: meta.category,
      description: meta.detail,
      internalReason: "Code-owned Amari offer",
      salesPolicy: meta.salesPolicy,
      source: "built-in",
      active: true,
      availableInPos: ready,
      readiness: ready ? "ready" : "needs-fulfillment",
      readinessReason: ready ? null : readinessReasons.join("; "),
      fulfillmentMode: "linked",
      fulfillmentPolicy: "provider-linked",
      fulfillmentSummary: meta.effect,
      ghlProductId: catalog.ghlProductId,
      createdAt: null,
      createdBy: null,
    });
  });
}

function mapCustomRow(row) {
  return {
    key: row.id,
    version: Number(row.version),
    name: row.name,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    category: row.category,
    description: row.description || "",
    internalReason: row.internal_reason,
    salesPolicy: "custom",
    source: "staff-created",
    active: row.status === "active",
    availableInPos: row.status === "active" && Number(row.available_in_pos) === 1,
    readiness: "ready",
    readinessReason: null,
    fulfillmentMode: "manual",
    fulfillmentPolicy: "none",
    fulfillmentSummary: "No automatic sessions, portal or Living Practice access, booking, or automation.",
    ghlProductId: null,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

async function customProducts(db) {
  if (!db) return [];
  const result = await db.prepare(`
    SELECT p.id, p.status, p.current_version AS version,
           v.name, v.description, v.category, v.internal_reason,
           v.amount_cents, v.currency, v.available_in_pos,
           p.created_at, p.created_by
      FROM staff_products p
      JOIN staff_product_versions v
        ON v.product_id = p.id AND v.version = p.current_version
     ORDER BY p.created_at DESC
  `).all();
  return (result?.results || []).map(mapCustomRow);
}

export async function listStaffProducts(db) {
  let custom = [];
  let configured = !!db;
  let error = null;
  if (db) {
    try {
      custom = await customProducts(db);
    } catch (cause) {
      configured = false;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return {
    products: [...builtInProducts(), ...custom].sort((a, b) => {
      const policyOrder = { current: 0, legacy: 1, custom: 2 };
      return (policyOrder[a.salesPolicy] ?? 3) - (policyOrder[b.salesPolicy] ?? 3)
        || a.name.localeCompare(b.name);
    }),
    canCreate: configured,
    storage: configured ? "owned-d1" : "unavailable",
    error,
  };
}

export async function createStaffProduct(db, input, { actor, id, now } = {}) {
  if (!db) throw failure("Product storage is not configured", 503);
  const allowed = new Set(["requestId", "name", "amountCents", "category", "description", "internalReason", "availableInPos"]);
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw failure(`Unknown product field: ${key}`);
  }
  const requestId = text(input?.requestId, 80);
  const name = text(input?.name, MAX_NAME);
  const description = text(input?.description, MAX_DESCRIPTION);
  const internalReason = text(input?.internalReason, MAX_REASON);
  const category = text(input?.category, 40);
  const amountCents = input?.amountCents;
  if (!/^[a-f0-9-]{32,80}$/i.test(requestId)) throw failure("A valid create request ID is required");
  if (name.length < 2) throw failure("Product name is required");
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    throw failure("Product price must be between $0.01 and $20,000.00");
  }
  if (!CATEGORIES.has(category)) throw failure("Choose a valid product category");
  if (!internalReason) throw failure("Internal reason is required");

  const prior = await db.prepare("SELECT id FROM staff_products WHERE create_request_id = ?").bind(requestId).first();
  if (prior?.id) {
    const repeated = await db.prepare(`
      SELECT p.id, p.status, p.current_version AS version,
             v.name, v.description, v.category, v.internal_reason,
             v.amount_cents, v.currency, v.available_in_pos,
             p.created_at, p.created_by
        FROM staff_products p
        JOIN staff_product_versions v ON v.product_id = p.id AND v.version = p.current_version
       WHERE p.id = ?
    `).bind(prior.id).first();
    return mapCustomRow(repeated);
  }

  const duplicate = await db.prepare(`
    SELECT product_id FROM staff_product_versions
     WHERE lower(name) = lower(?) AND amount_cents = ?
     LIMIT 1
  `).bind(name, amountCents).first();
  if (duplicate?.product_id) throw failure("That product and price already exist", 409);

  const rawId = id || crypto.randomUUID();
  if (!/^[a-f0-9-]{32,40}$/i.test(rawId)) throw failure("Could not create a product ID", 500);
  const productId = `custom-${rawId}`;
  const createdAt = now || new Date().toISOString();
  const createdBy = text(actor, 80) || "Eben";
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO staff_products
          (id, status, current_version, create_request_id, created_at, created_by)
        VALUES (?, 'active', 1, ?, ?, ?)
      `).bind(productId, requestId, createdAt, createdBy),
      db.prepare(`
        INSERT INTO staff_product_versions
          (product_id, version, name, description, category, internal_reason,
           amount_cents, currency, product_kind, fulfillment_policy,
           available_in_pos, created_at, created_by)
        VALUES (?, 1, ?, ?, ?, ?, ?, 'USD', 'simple', 'none', ?, ?, ?)
      `).bind(productId, name, description, category, internalReason, amountCents, input?.availableInPos === false ? 0 : 1, createdAt, createdBy),
      db.prepare(`
        INSERT INTO staff_product_events
          (event_id, product_id, product_version, actor, action, detail, occurred_at)
        VALUES (?, ?, 1, ?, 'created', ?, ?)
      `).bind(`product-event-${rawId}`, productId, createdBy, "Reusable simple product created. No provider product or lifecycle effect was created.", createdAt),
    ]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/unique|constraint/i.test(message)) throw failure("That product and price already exist", 409);
    throw cause;
  }
  return mapCustomRow({
    id: productId,
    status: "active",
    version: 1,
    name,
    description,
    category,
    internal_reason: internalReason,
    amount_cents: amountCents,
    currency: "USD",
    available_in_pos: input?.availableInPos === false ? 0 : 1,
    created_at: createdAt,
    created_by: createdBy,
  });
}

export function posCatalogFromProducts(products) {
  return Object.fromEntries(
    (products || [])
      .filter((product) => product?.active && product?.availableInPos)
      .map((product) => [product.key, {
        label: product.name,
        amountCents: product.amountCents,
        ghlProductId: product.ghlProductId || null,
        fulfillmentPolicy: product.fulfillmentPolicy || "provider-linked",
        productVersion: product.version || 1,
      }]),
  );
}
