// Cloudflare Pages Function: GET /api/staff-contact?id=
// Full contact detail: info, appointments, notes, messages

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";
import { deriveLedger, hydrateOrders } from "../lib/session-ledger.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const url = new URL(context.request.url);
    const contactId = url.searchParams.get("id");
    const debug = url.searchParams.get("debug") === "1";
    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact ID required" }), { status: 400, headers });
    }
    const debugInfo = debug ? { contactId, steps: [] } : null;

    // Fetch contact, appointments, notes, conversations, orders, invoices, calendars, and field defs in parallel
    const [contactRes, appointmentsRes, notesRes, conversationsRes, ordersRes, invoicesRes, calendarsRes, fieldDefsRes] = await Promise.all([
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`),
      ghlFetch(context, `${GHL_API_BASE}/conversations/search?contactId=${contactId}&locationId=${GHL_LOCATION_ID}`),
      ghlFetch(context, `${GHL_API_BASE}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=50`),
      // offset=0 required by GHL or the invoices endpoint returns 422
      ghlFetch(context, `${GHL_API_BASE}/invoices/?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
      ghlFetch(context, `${GHL_API_BASE}/calendars/?locationId=${GHL_LOCATION_ID}`),
      ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`),
    ]);

    if (!contactRes.ok) {
      console.error(`[staff-contact] Contact fetch error: ${contactRes.status}`);
      return new Response(JSON.stringify({ error: "Failed to load contact" }), { status: 422, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // Build calendar name map
    const calendarMap = {};
    if (calendarsRes.ok) {
      const calData = await calendarsRes.json();
      for (const cal of (calData.calendars || [])) {
        calendarMap[cal.id] = cal.name;
      }
    }

    // Build field defs map
    let fieldDefs = {};
    if (fieldDefsRes.ok) {
      const fieldDefsData = await fieldDefsRes.json();
      for (const f of (fieldDefsData.customFields || [])) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    // Parse appointments — keep raw GHL fields for the ledger, build display shape separately
    let rawAppointments = [];
    let appointments = [];
    if (appointmentsRes.ok) {
      const apptData = await appointmentsRes.json();
      rawAppointments = apptData.appointments || apptData.events || [];
      appointments = rawAppointments
        .map((a) => ({
          id: a.id,
          title: a.title || a.calendarName || "Session",
          calendarName: calendarMap[a.calendarId] || a.calendarName || "",
          startTime: a.startTime || a.start_time,
          endTime: a.endTime || a.end_time,
          status: (a.appointmentStatus || a.status || "confirmed").toLowerCase(),
        }))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }

    // Last completed appointment (any type, including entrainments — for "last visit" display)
    const completedAppointments = appointments.filter(
      (a) => a.status === "completed" || a.status === "showed"
    );
    const lastCompleted = completedAppointments[0]; // sorted newest-first

    // Parse notes
    let notes = [];
    if (notesRes.ok) {
      const notesData = await notesRes.json();
      notes = (notesData.notes || []).map((n) => ({
        id: n.id,
        body: n.body || "",
        dateAdded: n.dateAdded || n.createdAt || "",
      }));
    }

    // Parse messages — fetch from ALL conversations and merge, sorted newest-first.
    // A client can have multiple conversations (SMS + Email + etc.), and GHL doesn't
    // guarantee ordering, so we can't just pick conversations[0].
    let messages = [];
    if (debugInfo) {
      debugInfo.conversationsResOk = conversationsRes.ok;
      debugInfo.conversationsResStatus = conversationsRes.status;
    }
    if (conversationsRes.ok) {
      const convoData = await conversationsRes.json();
      const conversations = convoData.conversations || [];
      if (debugInfo) {
        debugInfo.conversationCount = conversations.length;
        debugInfo.conversationIds = conversations.map((c) => c.id);
        debugInfo.conversationKeys = conversations[0] ? Object.keys(conversations[0]) : [];
        debugInfo.rawConvoDataKeys = Object.keys(convoData);
        // Dump ALL fields of each conversation so we can see if lastMessageBody
        // is actually populated on the contactId-filtered endpoint
        debugInfo.rawConversations = conversations.map((c) => ({
          id: c.id,
          lastMessageDate: c.lastMessageDate,
          lastMessageDirection: c.lastMessageDirection,
          lastMessageType: c.lastMessageType,
          lastMessageBodyPreview: (c.lastMessageBody || "").slice(0, 120),
          lastMessageBodyLength: (c.lastMessageBody || "").length,
          unreadCount: c.unreadCount,
        }));
      }
      try {
        const allMessageBatches = await Promise.all(
          conversations.map(async (conv) => {
            const msgRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/${conv.id}/messages?limit=100`);
            if (!msgRes.ok) {
              if (debugInfo) debugInfo.steps.push({ convId: conv.id, msgStatus: msgRes.status, error: true });
              return [];
            }
            const msgData = await msgRes.json();
            // GHL double-nests: msgData.messages?.messages
            const raw = msgData.messages?.messages || msgData.messages || [];
            if (debugInfo) {
              debugInfo.steps.push({
                convId: conv.id,
                msgStatus: msgRes.status,
                rawCount: raw.length,
                // Dump ALL raw messages (minus large fields) for direction diagnosis
                allRawMessages: raw.map((m) => ({
                  id: m.id,
                  type: m.type,
                  messageType: m.messageType,
                  direction: m.direction,
                  status: m.status,
                  source: m.source,
                  userId: m.userId,
                  dateAdded: m.dateAdded,
                  bodyPreview: (m.body || m.message || "").slice(0, 80),
                  metaEmailDirection: m.meta?.email?.direction,
                  metaSmsDirection: m.meta?.sms?.direction,
                })),
                msgDataKeys: Object.keys(msgData),
              });
            }
            return raw;
          }),
        );
        const merged = allMessageBatches.flat();
        if (debugInfo) debugInfo.mergedCount = merged.length;
        messages = merged
          .map((m) => {
            // Type detection: prefer messageType string, fall back to numeric type enum.
            // GHL uses: 1=TYPE_CALL, 2=TYPE_SMS, 3=TYPE_EMAIL, etc.
            // Previous code did (m.type || "SMS").toUpperCase() which crashes when
            // m.type is a number.
            const typeStr = String(m.messageType || m.type || "").toUpperCase();
            const displayType = typeStr.includes("EMAIL") || m.type === 3
              ? "Email"
              : typeStr.includes("CALL") || typeStr.includes("VOICEMAIL") || m.type === 1
              ? "Call"
              : "SMS";

            // Direction detection — priority order by reliability:
            // 1. Top-level m.direction (most reliable when present)
            // 2. status: "sent"/"delivered" → outbound; "received" → inbound
            // 3. source: "app"/"workflow"/"integration" → outbound (staff-initiated)
            // 4. userId presence → outbound (staff user attached)
            // 5. Default → outbound (safer than guessing inbound)
            //
            // Notes from real GHL data:
            // - meta.email.direction has been observed as "inbound" on outbound
            //   emails — it does NOT reliably reflect message direction and is
            //   intentionally NOT used as a signal.
            // - Workflow-sent emails have source="workflow" and no userId.
            let isInbound;
            if (m.direction === 1 || m.direction === "inbound" || m.direction === "1") {
              isInbound = true;
            } else if (m.direction === 2 || m.direction === "outbound" || m.direction === "2") {
              isInbound = false;
            } else if (m.status === "sent" || m.status === "delivered") {
              isInbound = false;
            } else if (m.status === "received") {
              isInbound = true;
            } else if (
              m.source === "app" ||
              m.source === "workflow" ||
              m.source === "integration" ||
              m.source === "bulk_actions"
            ) {
              isInbound = false;
            } else if (m.userId) {
              isInbound = false;
            } else {
              // No clear signal — default outbound. Misclassifying an inbound as
              // outbound hides it from "needs reply" (acceptable); misclassifying
              // an outbound as inbound creates false urgency (worse).
              isInbound = false;
            }

            return {
              id: m.id,
              body: m.body || m.message || "",
              direction: isInbound ? "inbound" : "outbound",
              dateAdded: m.dateAdded || m.createdAt || "",
              type: displayType,
            };
          })
          .sort((a, b) => {
            const ta = new Date(a.dateAdded).getTime() || 0;
            const tb = new Date(b.dateAdded).getTime() || 0;
            return tb - ta;
          });

        // Fallback: GHL's /conversations/{id}/messages endpoint has been observed
        // to miss inbound emails entirely (seen with replies to eben@ebenforrest.com
        // that come in via external email sync). The conversation object itself
        // carries lastMessageBody/lastMessageDirection which ARE correct and
        // reflect GHL's view of the actual most recent message in the thread.
        //
        // Trust the conversation-level fields: if conv.lastMessageBody is not
        // already represented in the fetched messages (dedupe), synthesize a
        // virtual message and insert it. Do NOT compare timestamps — the
        // dateAdded on fetched messages reflects when GHL synced the message
        // into its DB, not when it was sent, so timestamps can misorder
        // messages relative to conv.lastMessageDate.
        if (debugInfo) debugInfo.syntheticSkips = [];
        for (const conv of conversations) {
          if (!conv.lastMessageBody) {
            if (debugInfo) debugInfo.syntheticSkips.push({
              convId: conv.id,
              reason: "missing lastMessageBody",
            });
            continue;
          }
          const convDate = typeof conv.lastMessageDate === "number"
            ? new Date(conv.lastMessageDate).toISOString()
            : conv.lastMessageDate || new Date().toISOString();

          // Dedupe by checking whether the same body already exists in messages
          const bodyPrefix = conv.lastMessageBody.slice(0, 60);
          const alreadyPresent = messages.some(
            (m) => m.body.slice(0, 60) === bodyPrefix,
          );
          if (alreadyPresent) {
            if (debugInfo) debugInfo.syntheticSkips.push({
              convId: conv.id,
              reason: "dedupe match",
              bodyPrefix,
            });
            continue;
          }

          const convTypeStr = String(conv.lastMessageType || "").toUpperCase();
          const convDisplayType = convTypeStr.includes("EMAIL")
            ? "Email"
            : convTypeStr.includes("CALL") || convTypeStr.includes("VOICEMAIL")
            ? "Call"
            : "SMS";

          messages.unshift({
            id: `synthetic-${conv.id}`,
            body: conv.lastMessageBody,
            direction: conv.lastMessageDirection === "inbound" ? "inbound" : "outbound",
            dateAdded: convDate,
            type: convDisplayType,
          });
          if (debugInfo) {
            debugInfo.syntheticAdded = (debugInfo.syntheticAdded || []).concat({
              convId: conv.id,
              convDate,
              direction: conv.lastMessageDirection,
            });
          }
        }

        // Final cap
        messages = messages.slice(0, 20);
        if (debugInfo) debugInfo.finalMessageCount = messages.length;
      } catch (err) {
        console.error(`[staff-contact] Messages fetch error:`, err.message);
        if (debugInfo) debugInfo.messagesError = err.message;
      }
    }

    // Source-of-truth ledger from orders + invoices + appointments (excludes
    // entrainments, discovery calls, partner sessions, booking-generated
    // placeholder orders, and retired products from series counts).
    let orders = [];
    if (ordersRes.ok) {
      const ordersData = await ordersRes.json();
      const ordersList = ordersData.data || [];
      // POS / mobile_app orders come back from LIST without items[];
      // hydrate via /payments/orders/{id} so classifyOrder can read
      // product._id. See session-ledger.js → hydrateOrders for details.
      orders = await hydrateOrders(context, ordersList);
    }
    let invoices = [];
    if (invoicesRes.ok) {
      const invoicesData = await invoicesRes.json();
      invoices = invoicesData.invoices || [];
    }
    const ledger = deriveLedger({
      contact,
      orders,
      invoices,
      appointments: rawAppointments,
      fieldDefs,
    });
    const seriesType = ledger.seriesType;
    const sessionsRemaining = ledger.remaining;
    const sessionPrepaid = ledger.remaining > 0 || ledger.prepaidOverride;

    // Parse quiz results from custom fields (set by /api/send-to-ghl)
    // Use short keys where available, fall back to raw field IDs for quiz fields
    // that don't have short keys registered in fieldDefs yet.
    const quizFieldMap = {
      patternSignature: "BvTGZ9O9ayecw5f0Nj76",
      recoveryPotentialScore: "PhQQjTF1fiLgtnAgKZZP",
      primaryPainLocation: "vKZTVAG7601lgV8413du",
      painDuration: "wrYzlW0ta2SGD8cI5iTM",
      painIntensity: "iCMhoomSzLnCUCcludwD",
      painTrigger: "NaNk1OVQLu8CcONUnyNz",
      additionalPainAreas: "NCDnl1jHDvDATpRKhkeV",
      painType: "tIIxUQT8hrkpDYY3WhWn",
      treatmentsTried: "y5HBXMycSnfFPSOcnR2y",
      treatmentResults: "1MSGnUASa5Zd9lKoNdvO",
      aggravatingActivities: "IqxEaCTcZpvGuDUC3O9c",
      dailyImpact: "zin4frkDKBWvVoN7ztZW",
    };
    const quizPattern = getCustomField(contact, quizFieldMap.patternSignature, fieldDefs);
    const quizResults = quizPattern ? Object.fromEntries(
      Object.entries(quizFieldMap).map(([key, fieldId]) => [
        key,
        getCustomField(contact, fieldId, fieldDefs),
      ]),
    ) : null;

    const capitalize = (s) => s ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : "";

    // Sessions completed = LIFETIME journey count per 2026-05-29 session-
    // fields contract (was: ledger.attended which was package-only and
    // excluded entrainments). Matches portal-data.js + staff-data.js.
    // The portal-derived ledger.attended is still useful — exposed as
    // attendedAgainstPackage below.
    const NON_JOURNEY_LIFETIME = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
    const nowMsLifetime = Date.now();
    const derivedSessionsCompleted = rawAppointments.filter((a) => {
      const status = (a.appointmentStatus || a.status || "").toLowerCase();
      if (!["completed", "showed", "confirmed"].includes(status)) return false;
      const startMs = new Date(a.startTime || a.start_time || 0).getTime();
      if (!Number.isFinite(startMs) || startMs >= nowMsLifetime) return false;
      const title = (a.title || "") + " " + (a.calendarName || "");
      return !NON_JOURNEY_LIFETIME.test(title);
    }).length;

    // Client progress — from custom fields in "Session Progress" folder
    const MODULE_KEYS = [
      "suspension_squat", "hand_balancer", "power_posture", "vertical_drop",
      "active_bridge", "passive_bridge", "spinal_wave", "spring_step",
      "elbow_reset", "jaw_align",
    ];
    const clientProgress = {
      modules: {},
      yogaBlockSize: null,
      bodyGraph: {},
    };
    for (const key of MODULE_KEYS) {
      const val = getCustomField(contact, key, fieldDefs);
      const moduleId = key.replace(/_/g, "-");
      if (val && (val === "Taught" || (Array.isArray(val) && val.includes("Taught")))) {
        clientProgress.modules[moduleId] = true;
      }
    }
    for (const region of ["upper", "middle", "lower"]) {
      const val = getCustomField(contact, `${region}_body`, fieldDefs);
      if (val === "Active" || val === "Passive") {
        clientProgress.bodyGraph[region] = val.toLowerCase();
      }
    }
    const blockVal = getCustomField(contact, "yoga_block_size", fieldDefs);
    if (blockVal === '3"' || blockVal === '4"') {
      clientProgress.yogaBlockSize = blockVal.charAt(0);
    }

    const result = {
      id: contact.id,
      firstName: capitalize(contact.firstName) || "",
      lastName: capitalize(contact.lastName) || "",
      email: contact.email || "",
      phone: contact.phone || "",
      seriesType,
      sessionsCompleted: derivedSessionsCompleted,
      sessionsRemaining,
      sessionPrepaid,
      tags: contact.tags || [],
      dateAdded: contact.dateAdded || "",
      lastAppointment: lastCompleted ? lastCompleted.startTime : null,
      appointments,
      notes,
      messages,
      quizResults,
      clientProgress,
      ...(debugInfo && { _debug: debugInfo }),
    };

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    console.error("[staff-contact] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
