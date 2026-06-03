// Audit rule sets — ported from qa-audit.js for Cloudflare Worker environment.
// Each function takes { env, cache, appointments, auditStart, auditEnd } and returns issues[].

import { ghlFetch, fetchAppointmentsForDate, LOCATION_ID } from "./ghl.js";

// ── Product mapping (includes both price IDs and product IDs) ──

const PRODUCT_MAP = {
  // Price IDs (from orders API)
  "699872e130cc6054f9bba617": { name: "4-Session Series", increment: 4, seriesType: "4-session" },
  "699873074d5b8cc0bc0e3b5a": { name: "8-Session Series", increment: 8, seriesType: "8-session" },
  "6998ad0288a3f09db4845d26": { name: "Single Follow-up", increment: 1, seriesType: null },
  // Product IDs (from webhook payloads)
  "69986faa724ecd2343ebaa6e": { name: "4-Session Series", increment: 4, seriesType: "4-session" },
  "69987357c839790426996114": { name: "8-Session Series", increment: 8, seriesType: "8-session" },
  "67f57171b6b1019c7b0233cc": { name: "Single Follow-up", increment: 1, seriesType: null },
  // Shared IDs
  "6998739230cc6054f9bba62d": { name: "Upgrade: Initial → 4", increment: 3, seriesType: "4-session" },
  "699873d6990b71ebc1fa26b4": { name: "Upgrade: Initial → 8", increment: 7, seriesType: "8-session" },
};

const UPSELL_PATTERNS = [
  { seriesType: "8-session", keywords: ["upgrade", "8-session", "8 session", "8-pack", "eight session"] },
  { seriesType: "4-session", keywords: ["4-session", "4 session", "4-pack", "four session"] },
];

function issue(severity, category, contactId, contactName, rule, expected, actual, suggestion) {
  return { severity, category, contactId, contactName, rule, expected, actual, suggestion };
}

// ── Rule Set 1: Appointment-triggered automations ──

export async function auditAppointments({ cache, appointments }) {
  const issues = [];
  const now = new Date();

  for (const appt of appointments) {
    if (!appt.contactId) continue;

    const cached = await cache.getContact(appt.contactId);
    if (!cached) {
      issues.push(issue(
        "warning", "appointment", appt.contactId, "Unknown",
        "contact_fetch_failed",
        "Contact data should be accessible",
        `Could not fetch contact ${appt.contactId}`,
        "Check if contact was deleted or merged"
      ));
      continue;
    }

    const { name, tags, fields } = cached;
    const apptEnd = new Date(appt.endTime);

    // Status still "confirmed" after appointment ended
    if (appt.appointmentStatus === "confirmed" && apptEnd < now) {
      issues.push(issue(
        "warning", "appointment", appt.contactId, name,
        "status_not_updated",
        "Status should change to 'showed' or 'no_show' after session ends",
        `Still "confirmed" (ended ${apptEnd.toISOString()})`,
        "Garrett may not have marked attendance"
      ));
    }

    // Status "showed" — verify post-session message
    // Scope: only flag for FIRST-EVER sessions (sessions_completed <= 1, where
    // 1 = the just-completed initial). For returning clients no per-session
    // workflow exists by design (E3/E4/E5 nurture flows handle ongoing touches
    // via sessions_remaining triggers, not per-attendance), so flagging every
    // follow-up generates false positives — see audit-triage 2026-05-31 +
    // GHL-WORKFLOWS-MASTER.md I3/H2 sections. If a generic post-session
    // workflow gets built later, widen this scope back out.
    if (appt.appointmentStatus === "showed") {
      const sessionsCompleted = parseInt(fields?.sessions_completed ?? "0", 10);
      const isFirstSession = !Number.isFinite(sessionsCompleted) || sessionsCompleted <= 1;
      if (isFirstSession) {
        const conv = await cache.getConversations(appt.contactId);
        if (conv && conv !== "scope_missing" && Array.isArray(conv)) {
          const allMsgs = conv.flatMap((t) => t.messages || []);
          const twoHoursAfter = new Date(apptEnd.getTime() + 2 * 60 * 60 * 1000);
          const postSession = allMsgs.filter(
            (m) => m.direction === "outbound" && new Date(m.date) >= apptEnd && new Date(m.date) <= twoHoursAfter
          );

          if (postSession.length === 0) {
            issues.push(issue(
              "warning", "appointment", appt.contactId, name,
              "no_post_session_message",
              "Post-session email/SMS should send within 2h of FIRST-EVER session end (Initial intake → G2 equipment-list step)",
              "No outbound message found in that window",
              "Check if G2 'Initial Session Welcome' workflow fired"
            ));
          }
        }
      }

      if (tags.includes("affiliate-partner")) {
        issues.push(issue(
          "info", "appointment", appt.contactId, name,
          "partner_session_verify",
          "Partner post-session notification should have sent to Garrett",
          "Cannot verify via API — manual check needed",
          "Verify Garrett received partner post-session notification SMS"
        ));
      }
    }

    // Status "no_show" — verify no-show sequence
    if (appt.appointmentStatus === "no_show") {
      const conv = await cache.getConversations(appt.contactId);
      if (conv && conv !== "scope_missing" && Array.isArray(conv)) {
        const allMsgs = conv.flatMap((t) => t.messages || []);
        const dayAfter = new Date(apptEnd.getTime() + 24 * 60 * 60 * 1000);
        const noShowMsgs = allMsgs.filter(
          (m) => m.direction === "outbound" && new Date(m.date) >= apptEnd && new Date(m.date) <= dayAfter
        );

        if (noShowMsgs.length === 0) {
          issues.push(issue(
            "warning", "appointment", appt.contactId, name,
            "no_show_no_followup",
            "No-show email/SMS sequence should fire after missed appointment",
            "No outbound message found within 24h of no-show",
            "Check 'No Show Email SMS series' workflow enrollment"
          ));
        }
      }
    }
  }

  return issues;
}

// ── Rule Set 2: Purchase-triggered automations ──

export async function auditPurchases({ env, cache, auditStart, auditEnd }) {
  const issues = [];
  let purchasesChecked = 0;

  let orders = [];
  try {
    const data = await ghlFetch(
      env,
      `/payments/orders?altId=${LOCATION_ID}&altType=location&limit=100`
    );
    orders = (data.orders || data.data || []).filter((o) => {
      const d = new Date(o.createdAt || o.dateAdded);
      return d >= new Date(auditStart) && d <= new Date(auditEnd);
    });
  } catch (err) {
    issues.push(issue(
      "warning", "purchase", "", "",
      "orders_fetch_failed",
      "Should be able to query recent orders",
      `Orders API error: ${err.message}`,
      "Check payments/orders.readonly scope"
    ));
    return { issues, purchasesChecked: 0 };
  }

  for (const order of orders) {
    const contactId = order.contactId || order.contact?.id;
    if (!contactId) continue;

    const items = order.items || order.lineItems || [];
    const productId = items[0]?.priceId || items[0]?.productId || order.productId;
    const productConfig = productId ? PRODUCT_MAP[productId] : null;
    if (!productConfig) continue;

    purchasesChecked++;
    const cached = await cache.getContact(contactId);
    if (!cached) continue;

    const { name, tags, fields } = cached;

    const remaining = parseInt(fields.sessions_remaining, 10);
    if (isNaN(remaining) || remaining < productConfig.increment) {
      issues.push(issue(
        "critical", "purchase", contactId, name,
        "sessions_remaining_not_incremented",
        `sessions_remaining should be >= ${productConfig.increment} after ${productConfig.name}`,
        `sessions_remaining is ${fields.sessions_remaining}`,
        "Check ghl-purchase-webhook.js and PURCHASE_KV idempotency key"
      ));
    }

    if (productConfig.seriesType && fields.series_type !== productConfig.seriesType) {
      issues.push(issue(
        "critical", "purchase", contactId, name,
        "series_type_not_set",
        `series_type should be "${productConfig.seriesType}" after ${productConfig.name}`,
        `series_type is "${fields.series_type}"`,
        "Check GHL purchase workflow and backup webhook"
      ));
    }

    if (!fields.portal_access) {
      issues.push(issue(
        "critical", "purchase", contactId, name,
        "portal_access_not_set",
        "portal_access should be true after any purchase",
        `portal_access is ${fields.portal_access}`,
        "Check GHL purchase workflow — portal_access action may be missing"
      ));
    }

    if (tags.includes("ambassador-prospect")) {
      issues.push(issue(
        "warning", "purchase", contactId, name,
        "ambassador_tag_not_removed",
        "ambassador-prospect tag should be removed after purchase",
        "Tag is still present",
        "Check purchase workflow — Remove Tag action may be missing"
      ));
    }

    if (tags.includes("discovery call attended")) {
      issues.push(issue(
        "warning", "purchase", contactId, name,
        "discovery_tag_not_removed",
        "discovery call attended tag should be removed after purchase",
        "Tag is still present",
        "Check purchase workflow — Remove Tag action may be missing"
      ));
    }
  }

  return { issues, purchasesChecked };
}

// ── Rule Set 3: Tag/field consistency ──

export async function auditTagConsistency({ cache }) {
  const issues = [];

  for (const [, cached] of cache.contacts) {
    if (!cached) continue;
    const { contact, name, fields, tags } = cached;

    if (tags.includes("partner-declined") && (tags.includes("ambassador-prospect") || tags.includes("affiliate-partner"))) {
      issues.push(issue(
        "warning", "consistency", contact.id, name,
        "declined_partner_still_tagged",
        "Declined partner should not have active partner/prospect tag",
        `Has partner-declined AND ${tags.includes("ambassador-prospect") ? "ambassador-prospect" : "affiliate-partner"}`,
        "Remove the active partner/prospect tag"
      ));
    }

    if (tags.includes("ambassador-prospect") && tags.includes("affiliate-partner")) {
      issues.push(issue(
        "warning", "consistency", contact.id, name,
        "dual_tags",
        "Should have either ambassador-prospect OR affiliate-partner, not both",
        "Both tags present",
        "Remove ambassador-prospect — partner bypassed normal flow"
      ));
    }

    const hasActiveSeries = fields.series_type && fields.series_type !== "none" && fields.series_type !== "";

    if (hasActiveSeries && String(fields.sessions_remaining) === "0") {
      issues.push(issue(
        "warning", "consistency", contact.id, name,
        "sessions_exhausted_no_outreach",
        "Sessions exhausted — client should receive re-engagement outreach",
        `series_type="${fields.series_type}" but sessions_remaining=0`,
        "No sessions-exhausted workflow exists yet"
      ));
    }
  }

  return issues;
}

// ── Rule Set 3b: Historical series_type drop detection ──
//
// Flags contacts with sessions_completed > 0 but series_type null/empty ONLY IF
// their order history shows they bought a pack (4-session / 8-session / upgrade).
// Per-session payers (Single Follow-up, Entrainment only) are correctly null
// and must NOT be flagged.
//
// Example that caused this rule to exist: Tae-Woo Kim had SC=3 + series_type=null
// and was flagged as a P1 drift gap on 2026-04-11. Investigation on 2026-04-21
// showed he was a per-session payer (3x single orders totaling $370, no pack).
// series_type=null was correct; the rule was the bug.

export async function auditSeriesTypeDrops({ env, cache }) {
  const issues = [];

  // Fetch a wider window of orders to catch pack purchases made months ago.
  // limit=100 is the API cap; if more are needed later, add pagination.
  let orders = [];
  try {
    const data = await ghlFetch(
      env,
      `/payments/orders?altId=${LOCATION_ID}&altType=location&limit=100`
    );
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    orders = (data.orders || data.data || []).filter((o) => {
      const d = new Date(o.createdAt || o.dateAdded);
      return d.getTime() >= cutoff;
    });
  } catch (err) {
    issues.push(issue(
      "warning", "consistency", "", "",
      "series_type_drop_check_skipped",
      "Should be able to query orders for historical series_type drop detection",
      `Orders API error: ${err.message}`,
      "Check payments/orders.readonly scope"
    ));
    return issues;
  }

  // Build: contactId → expected seriesType from most recent pack order
  const packBuyers = new Map();
  for (const order of orders) {
    const contactId = order.contactId || order.contact?.id;
    if (!contactId) continue;
    const items = order.items || order.lineItems || [];
    const productId = items[0]?.priceId || items[0]?.productId || order.productId;
    const productConfig = productId ? PRODUCT_MAP[productId] : null;
    if (!productConfig || !productConfig.seriesType) continue;
    packBuyers.set(contactId, {
      expected: productConfig.seriesType,
      productName: productConfig.name,
    });
  }

  for (const [, cached] of cache.contacts) {
    if (!cached) continue;
    const { contact, name, fields } = cached;

    const sc = parseInt(fields.sessions_completed, 10);
    if (isNaN(sc) || sc <= 0) continue;

    const seriesType = fields.series_type;
    const isMissing = !seriesType || seriesType === "" || seriesType === "none";
    if (!isMissing) continue;

    const pack = packBuyers.get(contact.id);
    if (!pack) continue; // Per-session payer — correct state, skip.

    issues.push(issue(
      "critical", "consistency", contact.id, name,
      "series_type_dropped",
      `series_type should be "${pack.expected}" — contact bought ${pack.productName}`,
      `series_type is "${fields.series_type ?? "null"}" with sessions_completed=${sc}`,
      "Set series_type field manually in GHL; check purchase webhook for the drop"
    ));
  }

  return issues;
}

// ── Rule Set 4: Communication verification ──

export async function auditCommunications({ cache, appointments }) {
  const issues = [];

  for (const appt of appointments) {
    if (!appt.contactId) continue;
    if (appt.appointmentStatus === "cancelled") continue;

    const cached = await cache.getContact(appt.contactId);
    const name = cached?.name || "Unknown";

    const conv = await cache.getConversations(appt.contactId);
    if (!conv || conv === "scope_missing" || !Array.isArray(conv)) continue;

    const allMsgs = conv.flatMap((t) => t.messages || []);
    const apptStart = new Date(appt.startTime);

    // Pre-session reminder check (12-48h before)
    const twoDaysBefore = new Date(apptStart.getTime() - 48 * 60 * 60 * 1000);
    const preSession = allMsgs.filter((m) => {
      if (m.direction !== "outbound") return false;
      const d = new Date(m.date);
      return d >= twoDaysBefore && d <= apptStart;
    });

    if (preSession.length === 0) {
      issues.push(issue(
        "info", "communication", appt.contactId, name,
        "no_pre_session_reminder",
        "Pre-session reminder should send 24-48h before appointment",
        "No outbound message found in that window",
        "Check if reminder workflow is set up for this calendar"
      ));
    }

    // Duplicate message check (same first 100 chars within 1h)
    const outboundByBody = {};
    for (const m of allMsgs) {
      if (m.direction !== "outbound" || !m.body) continue;
      const key = m.body.substring(0, 100);
      if (!outboundByBody[key]) outboundByBody[key] = [];
      outboundByBody[key].push(new Date(m.date));
    }

    for (const [snippet, dates] of Object.entries(outboundByBody)) {
      if (dates.length < 2) continue;
      const sorted = [...dates].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap < 60 * 60 * 1000) {
          issues.push(issue(
            "warning", "communication", appt.contactId, name,
            "duplicate_message",
            "Same message should not send twice within 1 hour",
            `"${snippet.substring(0, 50)}..." sent ${Math.round(gap / 60000)} min apart`,
            "Check for overlapping workflow triggers"
          ));
          break;
        }
      }
    }
  }

  return issues;
}

// ── Rule Set 5: State mismatch detection ──

export async function auditStateMismatches({ env, cache, auditStart }) {
  const issues = [];

  // Fetch recent purchasers (30-day window for catching stale workflows)
  let recentPurchaserIds = [];
  try {
    const data = await ghlFetch(
      env,
      `/payments/orders?altId=${LOCATION_ID}&altType=location&limit=100`
    );
    const orders = (data.orders || data.data || []).filter((o) => {
      const d = new Date(o.createdAt || o.dateAdded);
      return d >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    });
    recentPurchaserIds = orders
      .map((o) => o.contactId || o.contact?.id)
      .filter(Boolean);
  } catch {
    // Continue without purchase data
  }

  // Fetch upcoming appointments (next 3 days) for booking-prompt detection
  const appointedContactIds = new Set();
  try {
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      try {
        const appts = await fetchAppointmentsForDate(env, dateStr);
        for (const a of appts) {
          if (a.contactId) appointedContactIds.add(a.contactId);
        }
      } catch {
        // Single day failed — continue
      }
    }
  } catch {
    // Continue without appointment data
  }

  const contactIds = [...new Set(recentPurchaserIds)];

  for (const contactId of contactIds) {
    const cached = await cache.getContact(contactId);
    if (!cached) continue;

    const { name, fields, tags } = cached;

    // Check 1: Upsell for product they already own
    if (fields.series_type) {
      const conv = await cache.getConversations(contactId);
      if (conv && conv !== "scope_missing" && Array.isArray(conv)) {
        const allMsgs = conv.flatMap((t) => t.messages || []);
        const recentOutbound = allMsgs.filter(
          (m) => m.direction === "outbound" && new Date(m.date) >= new Date(auditStart)
        );

        for (const msg of recentOutbound) {
          const bodyLower = (msg.body || "").toLowerCase();

          for (const pattern of UPSELL_PATTERNS) {
            if (fields.series_type === pattern.seriesType) {
              const matched = pattern.keywords.find((kw) => bodyLower.includes(kw));
              if (matched && (bodyLower.includes("upgrade") || bodyLower.includes("ready to") || bodyLower.includes("check out"))) {
                issues.push(issue(
                  "critical", "state_mismatch", contactId, name,
                  "upsell_after_purchase",
                  `Should not upsell ${pattern.seriesType} to someone who already has it`,
                  `Message contains "${matched}" but series_type="${fields.series_type}"`,
                  "Check which workflow sent this — missing series_type filter"
                ));
              }
            }
          }

          // Booking prompt when already booked
          if (appointedContactIds.has(contactId)) {
            const bookingPhrases = ["ready to book", "book your", "schedule your", "book a session", "grab a spot"];
            const matchedPhrase = bookingPhrases.find((p) => bodyLower.includes(p));
            if (matchedPhrase) {
              issues.push(issue(
                "warning", "state_mismatch", contactId, name,
                "booking_prompt_when_already_booked",
                "Should not prompt to book when contact has an upcoming appointment",
                `Message contains "${matchedPhrase}" but contact has appointment`,
                "Workflow needs condition to skip if upcoming appointment exists"
              ));
            }
          }
        }
      }
    }

    // Check 2: Active client in lead nurture
    const isActive = fields.series_type && parseInt(fields.sessions_remaining, 10) > 0;
    if (isActive && tags.includes("quiz submitted") && !tags.includes("workflow 3")) {
      issues.push(issue(
        "warning", "state_mismatch", contactId, name,
        "active_client_in_lead_nurture",
        "Active client should not be in lead nurture",
        `series_type="${fields.series_type}", sessions_remaining=${fields.sessions_remaining}, but has "quiz submitted" tag`,
        "Remove 'quiz submitted' tag or add 'workflow 3' tag"
      ));
    }

    // Check 3: Stale discovery tag on active client
    if (isActive && tags.includes("discovery call attended")) {
      issues.push(issue(
        "info", "state_mismatch", contactId, name,
        "stale_discovery_tag",
        "Active client should not have 'discovery call attended' tag",
        "Has active series but tag still present",
        "Remove tag — purchase workflow should have cleaned this up"
      ));
    }
  }

  return issues;
}
