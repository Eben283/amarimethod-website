// Read-only audit: find contacts affected by the upgrade-initial ledger bug.
// Lists contacts whose order/invoice classification contains 4-upgrade or
// 8-upgrade but NO matching `initial` classification.
//
// Usage: node audit-ledger-bug.mjs

import fs from "node:fs";

const TOKENS = JSON.parse(
  fs.readFileSync("/Users/Eben/.claude/ghl-mcp/tokens.json", "utf8"),
);
const TOKEN = TOKENS.access_token;
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const API = "https://services.leadconnectorhq.com";

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Version: "2021-07-28",
  Accept: "application/json",
};

// Inlined product map (from ghl-products.js)
const LEDGER_PRODUCT_MAP = {
  "69987357c839790426996114": { type: "8-series", sessions: 8 },
  "69986faa724ecd2343ebaa6e": { type: "4-series", sessions: 4 },
  "699873d6990b71ebc1fa26b4": { type: "8-upgrade", sessions: 7 },
  "6998739230cc6054f9bba62d": { type: "4-upgrade", sessions: 3 },
  "688a1cd770362828afbf08a2": { type: "initial", sessions: 1 },
  "690b6b4d333ffa59d40c1823": { type: "initial", sessions: 1 },
  "69aee204e80b62d627d8e922": { type: "followup", sessions: 1 },
  "69aee3ebcf9cf8ed9f6c928d": { type: "followup", sessions: 1 },
  "6998ace59dfde469ecb2aab6": { type: "followup", sessions: 1 },
  "67b1299f080422451447bdd0": { type: "followup", sessions: 1 },
  "69c5d29c4019ce8e80e2513b": { type: "entrainment", sessions: 0 },
  "6998d7f2606fa79c54fa3ff5": { type: "living-practice", sessions: 0 },
};

const PACKAGE_TYPES = new Set(["4-series", "8-series", "4-upgrade", "8-upgrade"]);
const SERIES_CALENDAR_IDS = new Set([
  "G7OAnnJuFbMF6nQSlZVQ",
  "ySmht5hx4uZGEpgZrlCw",
  "SKDVOL8wtUN6Ne0ppbC9",
  "ZO1jlGfy01rsxVqicoSB",
  "bJFkhVP35Ecwh4tLnSmy",
  "oVn77FcecFY16iS2pHyP",
]);
const ATTENDED_STATUSES = new Set(["showed", "completed"]);

function classifyOrder(order) {
  const status = (order.status || "").toLowerCase();
  const amount = Number(order.amount || 0);
  const name = (order.sourceName || "").toLowerCase();
  const sourceType = (order.sourceType || "").toLowerCase();

  if (status !== "completed" || amount <= 0) return { type: "ignored", sessions: 0, name, amount };
  if (sourceType === "calendar") return { type: "placeholder", sessions: 0, name, amount };
  if (/upgrade/i.test(name)) {
    if (amount >= 1000) return { type: "8-upgrade", sessions: 7, name, amount };
    return { type: "4-upgrade", sessions: 3, name, amount };
  }
  if (/8.?session|eight.?session/i.test(name)) return { type: "8-series", sessions: 8, name, amount };
  if (/4.?session|four.?session/i.test(name)) return { type: "4-series", sessions: 4, name, amount };
  if (/entrainment/i.test(name)) return { type: "entrainment", sessions: 0, name, amount };
  if (/initial/i.test(name)) return { type: "initial", sessions: 1, name, amount };
  if (/follow.?up/i.test(name)) return { type: "followup", sessions: 1, name, amount };
  return { type: "other", sessions: 0, name, amount };
}

function classifyInvoice(invoice) {
  const status = (invoice.status || "").toLowerCase();
  const amountPaid = Number(invoice.amountPaid || 0);
  const items = invoice.invoiceItems || [];
  const firstItem = items[0] || {};
  const name = (firstItem.name || invoice.name || "").toLowerCase();
  const date = invoice.issueDate || invoice.updatedAt || invoice.createdAt || null;
  if (status !== "paid" || amountPaid <= 0)
    return { type: "ignored", sessions: 0, name, amount: amountPaid, date: null };
  const productId = firstItem.productId || null;
  if (productId && LEDGER_PRODUCT_MAP[productId]) {
    const entry = LEDGER_PRODUCT_MAP[productId];
    return { type: entry.type, sessions: entry.sessions, name, amount: amountPaid, date };
  }
  return { type: "retired", sessions: 0, name, amount: amountPaid, date };
}

async function ghlGet(path) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchAllUpgradeOrders() {
  // Paginate /payments/orders. GHL uses offset/limit.
  const upgrades = [];
  let offset = 0;
  const limit = 100;
  let page = 0;
  let totalSeen = 0;
  while (true) {
    const url = `${API}/payments/orders?altId=${LOCATION_ID}&altType=location&limit=${limit}&offset=${offset}`;
    const data = await ghlGet(url);
    const rows = data.data || data.orders || [];
    if (!rows.length) break;
    totalSeen += rows.length;
    for (const o of rows) {
      const name = (o.sourceName || "").toLowerCase();
      if (/upgrade/i.test(name)) upgrades.push(o);
    }
    page++;
    if (rows.length < limit) break;
    offset += limit;
    if (page > 100) break; // safety
  }
  console.log(`  Paginated ${totalSeen} orders total across ${page} pages`);
  return upgrades;
}

async function fetchContactOrders(contactId) {
  const url = `${API}/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`;
  const data = await ghlGet(url);
  return data.data || data.orders || [];
}

async function fetchContactInvoices(contactId) {
  const url = `${API}/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`;
  const data = await ghlGet(url);
  return data.invoices || [];
}

async function fetchContact(contactId) {
  const url = `${API}/contacts/${contactId}`;
  const data = await ghlGet(url);
  return data.contact || {};
}

async function fetchAppointments(contactId) {
  const url = `${API}/contacts/${contactId}/appointments`;
  const data = await ghlGet(url);
  return data.appointments || data.events || [];
}

async function fetchFieldDefs() {
  const url = `${API}/locations/${LOCATION_ID}/customFields`;
  const data = await ghlGet(url);
  const map = {};
  for (const f of data.customFields || []) {
    const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
    if (shortKey) map[shortKey] = f.id;
  }
  return map;
}

function getCustomField(contact, key, fieldDefs) {
  if (!contact) return null;
  const id = fieldDefs[key];
  const arr = contact.customFields || contact.customField || [];
  for (const f of arr) {
    if (f.id === id || f.fieldKey === key || f.key === key) {
      return f.value ?? f.field_value ?? null;
    }
  }
  return null;
}

function deriveLedgerState({ contact, orders, invoices, appointments, fieldDefs }) {
  const orderClassifications = orders.map((o) => ({
    ...classifyOrder(o),
    date: o.createdAt || o.updatedAt || null,
    id: o._id || o.id,
  }));
  const invoiceClassifications = invoices.map((inv) => ({
    ...classifyInvoice(inv),
    id: inv._id || inv.id,
  }));
  const classifications = [...orderClassifications, ...invoiceClassifications];
  const purchased = classifications.reduce((s, c) => s + c.sessions, 0);

  const toDay = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "");
  const packageDates = classifications
    .filter((c) => PACKAGE_TYPES.has(c.type))
    .map((c) => c.date)
    .filter(Boolean)
    .sort();
  const cutoffDay = toDay(packageDates[0] || "");

  const attendedAll = appointments
    .filter((a) => SERIES_CALENDAR_IDS.has(a.calendarId))
    .filter((a) => {
      const status = (a.appointmentStatus || a.status || "").toLowerCase();
      return ATTENDED_STATUSES.has(status);
    });
  const attendedFiltered = cutoffDay
    ? attendedAll.filter((a) => {
        const startDay = toDay(a.startTime || a.start_time || "");
        return startDay && startDay >= cutoffDay;
      })
    : attendedAll;
  const attended = attendedFiltered.length;
  const remaining = Math.max(0, purchased - attended);

  const cfSeriesType = getCustomField(contact, "series_type", fieldDefs);
  const cfSessionsRemaining = getCustomField(contact, "sessions_remaining", fieldDefs);

  return { classifications, purchased, attended, remaining, cfSeriesType, cfSessionsRemaining };
}

async function fetchAllUpgradeInvoices() {
  // Paginate /invoices/ and filter by upgrade productIds.
  const upgradeProductIds = new Set(["699873d6990b71ebc1fa26b4", "6998739230cc6054f9bba62d"]);
  const results = [];
  let offset = 0;
  const limit = 100;
  let page = 0;
  let totalSeen = 0;
  while (true) {
    const url = `${API}/invoices/?altId=${LOCATION_ID}&altType=location&limit=${limit}&offset=${offset}`;
    const data = await ghlGet(url);
    const rows = data.invoices || [];
    if (!rows.length) break;
    totalSeen += rows.length;
    for (const inv of rows) {
      const items = inv.invoiceItems || [];
      const productId = (items[0] && items[0].productId) || null;
      const nameHit = (items[0] && items[0].name && /upgrade/i.test(items[0].name)) || false;
      if ((productId && upgradeProductIds.has(productId)) || nameHit) {
        results.push(inv);
      }
    }
    page++;
    if (rows.length < limit) break;
    offset += limit;
    if (page > 100) break;
  }
  console.log(`  Scanned ${totalSeen} invoices across ${page} pages`);
  return results;
}

async function main() {
  console.log("# Ledger bug audit");
  console.log(`Token expires at: ${new Date(TOKENS.expires_at).toISOString()}`);
  console.log("Fetching all upgrade orders...");
  const upgrades = await fetchAllUpgradeOrders();
  console.log(`Found ${upgrades.length} upgrade orders`);

  console.log("Fetching all upgrade invoices...");
  const upgradeInvoices = await fetchAllUpgradeInvoices();
  console.log(`Found ${upgradeInvoices.length} upgrade invoices`);

  const orderContactIds = upgrades.map((o) => o.contactId).filter(Boolean);
  const invoiceContactIds = upgradeInvoices
    .map((inv) => inv.contactDetails && inv.contactDetails.id)
    .filter(Boolean);
  const contactIds = [...new Set([...orderContactIds, ...invoiceContactIds])];
  console.log(`Unique contacts with upgrade orders or invoices: ${contactIds.length}`);

  const fieldDefs = await fetchFieldDefs();
  console.log(`Loaded ${Object.keys(fieldDefs).length} custom field defs`);

  const affected = [];
  for (const contactId of contactIds) {
    try {
      const [contact, orders, invoices, appointments] = await Promise.all([
        fetchContact(contactId),
        fetchContactOrders(contactId),
        fetchContactInvoices(contactId),
        fetchAppointments(contactId),
      ]);
      const state = deriveLedgerState({ contact, orders, invoices, appointments, fieldDefs });
      const upgradeClassifs = state.classifications.filter(
        (c) => c.type === "4-upgrade" || c.type === "8-upgrade",
      );
      const initialClassifs = state.classifications.filter((c) => c.type === "initial");
      if (upgradeClassifs.length > 0 && initialClassifs.length === 0) {
        affected.push({
          contactId,
          name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.contactName || "(unknown)",
          email: contact.email || "",
          upgradeClassifs,
          initialClassifs,
          state,
          orders,
          invoices,
        });
      }
    } catch (err) {
      console.error(`  ERROR contact ${contactId}: ${err.message}`);
    }
  }

  console.log(`\n## Affected Contacts (${affected.length})\n`);
  affected.forEach((c, i) => {
    console.log(`### ${i + 1}. ${c.name} — ${c.contactId}`);
    console.log(`- Email: ${c.email}`);
    console.log(`- Upgrade order(s):`);
    for (const u of c.upgradeClassifs) {
      console.log(`    - type=${u.type} sessions=+${u.sessions} amount=$${u.amount} date=${u.date || "?"} name="${u.name}"`);
    }
    console.log(`- Initial order(s): NONE`);
    // show all classifications for context
    const nonZero = c.state.classifications.filter((x) => x.sessions > 0 || x.type !== "ignored" && x.type !== "placeholder");
    console.log(`- All non-trivial classifications:`);
    for (const cl of nonZero) {
      console.log(`    - type=${cl.type} sessions=+${cl.sessions} amount=$${cl.amount || 0} name="${cl.name}"`);
    }
    console.log(`- Current custom field sessions_remaining: ${c.state.cfSessionsRemaining}`);
    console.log(`- Current series_type custom field: ${c.state.cfSeriesType}`);
    console.log(`- Current ledger derived remaining: ${c.state.remaining} (purchased=${c.state.purchased}, attended=${c.state.attended})`);
    const unmatchedUpgrades = c.upgradeClassifs.length;
    console.log(`- Correct remaining after fix: ${c.state.remaining + unmatchedUpgrades}`);
    console.log("");
  });

  console.log(`\n## TOTAL AFFECTED: ${affected.length}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
