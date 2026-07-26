// Native Anthropic Messages API wrapper for COS chat.
// - Tool-use loop for GHL queries (multi-step reasoning)
// - Prompt caching via cache_control breakpoints (~70% cost savings on stable prefix)
// - SSE streaming with text-delta forwarding + tool execution

import { ghlFetch } from "./ghl.js";
import { deriveLedger } from "./session-ledger.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "./ghl-fields.js";
import { listCalendarEventsRaw, deleteCalendarEvent } from "./google-api.js";
import {
  recordPark,
  lookupParkingRules,
  lookupSfSweep,
  getParkingHistory,
  formatHistoryForModel,
  formatRulesForModel,
  formatSfSweepForModel,
} from "./cos-parking.js";
import { recordFieldVisit, listFieldPartners } from "./cos-field-visits.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const MAX_TOOL_ROUNDS = 5;

// GHL custom field IDs (single-sourced from lib/ghl-fields.js)
const FIELD_SESSIONS_REMAINING = GHL_FIELD_IDS.sessions_remaining;
const FIELD_SESSIONS_COMPLETED = GHL_FIELD_IDS.sessions_completed;
const FIELD_SERIES_TYPE = GHL_FIELD_IDS.series_type;

// Tool definitions exposed to Claude.
export const TOOLS = [
  {
    name: "search_contacts",
    description: "Search GHL contacts by name, email, phone, or tag. Returns matching contacts with raw GHL custom fields (sessions_remaining, sessions_completed, series_type), tags, and dates. NOTE: search results use raw GHL field values which may have transient drift (auto-corrects hourly via series-reconcile worker). For authoritative session counts, call get_contact on a specific contactId — that returns ledger-derived values from real orders + invoices + appointments. Use 'name' for substring search, 'tag' to filter by an exact tag like 'affiliate-partner' or 'affiliate-referral'. You can combine name + tag.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name/email/phone substring (case-insensitive)" },
        tag: { type: "string", description: "Exact tag value (e.g. 'affiliate-partner', 'affiliate-referral', 'trainer-outreach')" },
        limit: { type: "integer", description: "Max contacts to return (default 50, max 100)" },
      },
    },
  },
  {
    name: "get_contact",
    description: "Fetch a single contact by ID. Returns full contact record including all custom fields (use this when search_contacts found someone by tag and you need their referralSource, partner_contact_id, etc.)",
    input_schema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "The GHL contact ID" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "get_contact_appointments",
    description: "Fetch the full appointment history for one contact by ID. Use after search_contacts to verify session attendance, dates, and status (showed/no-show/cancelled).",
    input_schema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "The GHL contact ID from search_contacts" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "search_opportunities",
    description: "Search GHL pipeline opportunities (deals). Returns opportunities with stage, monetary value, contact ID, and last update. Use for pipeline questions like 'who's in the partner pipeline' or 'how many opportunities are in stage X'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max opportunities to return (default 100, max 100)" },
      },
    },
  },
  {
    name: "list_calendar_events",
    description: "List GHL calendar events (appointments) within a date range. Use for questions about scheduled sessions: 'what's on the calendar tomorrow', 'who's booked this week'.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date YYYY-MM-DD in Pacific time" },
        end_date: { type: "string", description: "End date YYYY-MM-DD in Pacific time" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "list_google_calendar_events",
    description: "List the user's Google Calendar events (across ALL their calendars, not GHL) within a date range. Returns each event with event_id and calendar_id — both are required to cancel an event. Use this when the user wants to find, review, or cancel a personal calendar event (e.g. 'cancel my 3pm', 'what's on my calendar Friday', 'delete that dentist appointment').",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date YYYY-MM-DD in Pacific time (inclusive)" },
        end_date: { type: "string", description: "End date YYYY-MM-DD in Pacific time (inclusive)" },
        query: { type: "string", description: "Optional case-insensitive substring to filter events by title or location" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "record_field_visit",
    description: "Create or update a durable local-business relationship record after a field-study flyer visit. Use whenever the user explicitly reports a visit to a business, putting up/checking a study flyer, speaking with an owner or manager, or asks to log a field visit. Read attached storefront/business-card images to fill contact details when visible. This is not a GHL contact write. Do not use it for a vague plan or a business merely mentioned in passing.",
    input_schema: {
      type: "object",
      properties: {
        business_name: { type: "string", description: "Business name. Required." },
        location: { type: "string", description: "Street address or neighborhood if known." },
        study: { type: "string", description: "Study/flyer placed or discussed, e.g. Hand Study." },
        flyer_location: { type: "string", description: "Where the flyer was placed, e.g. front desk or staff room." },
        contact: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
          },
        },
        relationship_stage: { type: "string", enum: ["host", "engaged_host", "partner", "workshop_opportunity"], description: "host = lets Amari display a flyer; engaged_host = active conversation/interest; partner = intentionally shares or introduces; workshop_opportunity = a specific staff/workshop signal." },
        notes: { type: "string", description: "What happened and the useful details, in plain language." },
        workshop_signal: { type: "boolean", description: "True only if staff care, a workshop, or a team need genuinely came up." },
        next_visit_on: { type: "string", description: "Next in-person touch as YYYY-MM-DD if the user supplied a date or clear timing; otherwise omit." },
      },
      required: ["business_name"],
    },
  },
  {
    name: "list_field_partners",
    description: "List local business relationships captured through Chief of Staff field visits. Use when the user asks who to revisit, what businesses have flyers, which are workshop opportunities, or for a partner status review.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Maximum results, default 25, max 100." },
        stage: { type: "string", enum: ["host", "engaged_host", "partner", "workshop_opportunity"] },
      },
    },
  },
  {
    name: "record_park",
    description: "Record where the user just parked AND (if rule_type is given) save the posted parking rules for that block to the shared rules database, so future parks at the same location auto-recall them. Use whenever the user says they parked somewhere — even if they only mention the location. If they also describe the rule (street sweeping day/time, posted hour limit, RPP zone, overnight ban), include it; the rule gets merged into the database for next time.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "Free-text location, e.g. '9th Ave between Cabrillo and Lincoln' or '5th & Clement'" },
        side: { type: "string", description: "Side of the street if known: 'north' | 'south' | 'east' | 'west'. Omit if unsure." },
        rule_type: { type: "string", description: "What kind of restriction applies: 'street_sweeping' | 'time_limit' | 'rpp' | 'overnight' | 'metered' | 'tow_lane' | 'none' | 'unknown'" },
        rule_detail: { type: "string", description: "Plain-text rule, e.g. 'Tue 1st & 3rd 8-10am' or '2-hour limit 8a-6p Mon-Fri' or 'RPP zone J, 2hr without permit'" },
        deadline_iso: { type: "string", description: "ISO timestamp of the next action deadline (when the car has to move). Omit if none." },
        reminder_event_id: { type: "string", description: "If a Google Calendar reminder was created for this park, the event ID — links the history entry to the buzz." },
        notes: { type: "string", description: "Anything else worth keeping (which corner, paint color, signs nearby, etc.)" },
      },
      required: ["location"],
    },
  },
  {
    name: "lookup_parking_rules",
    description: "Search the stored parking-rules database for a location BEFORE asking the user about the rules. If a match comes back, you already know the rule and only need to confirm or fill gaps. Always call this first when the user mentions parking somewhere.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "Free-text location to look up (street + cross streets work best)" },
      },
      required: ["location"],
    },
  },
  {
    name: "get_parking_history",
    description: "Return the user's recent parking history (where they've parked, when, what rules applied, deadlines). Use when the user asks 'where have I parked', 'show my parking history', or wants to compare past spots.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Number of recent entries to return (default 20, max 100)" },
      },
    },
  },
  {
    name: "cancel_google_calendar_event",
    description: "Cancel (delete) a Google Calendar event. Requires event_id AND calendar_id from list_google_calendar_events. Always look up the event first via list_google_calendar_events before calling this — never guess IDs. If multiple events match the user's description, ask which one to cancel before calling this tool.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The Google Calendar event ID (from list_google_calendar_events)" },
        calendar_id: { type: "string", description: "The calendar the event lives on (from list_google_calendar_events). Defaults to 'primary' if not provided." },
      },
      required: ["event_id"],
    },
  },
];

function pacificOffsetForDate(dateStr) {
  // Returns "-07:00" (PDT) or "-08:00" (PST). Approximate via Intl.
  const d = new Date(`${dateStr}T12:00:00Z`);
  const pacific = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetHours = Math.round((pacific - utc) / 3600000);
  const sign = offsetHours < 0 ? "-" : "+";
  const abs = String(Math.abs(offsetHours)).padStart(2, "0");
  return `${sign}${abs}:00`;
}

// Execute a tool call. Returns a string Claude will read as tool_result.
// `user` is the COS user ("Eben" or "Garrett") — needed for Google OAuth
// scoped tools (Google Calendar list/cancel). Defaults to "Eben" so older
// call sites keep working.
export async function executeTool(context, toolName, input, user = "Eben", fieldVisitImages = []) {
  try {
    if (toolName === "record_field_visit") {
      const { partner, visit } = await recordFieldVisit(
        context.env.PORTAL_KV,
        user,
        input,
        fieldVisitImages,
      );
      return JSON.stringify({
        recorded: true,
        business: partner.business_name,
        stage: partner.relationship_stage,
        visits: partner.visit_count,
        next_visit_on: partner.next_visit_on,
        workshop_signal: partner.workshop_signal,
        visit_images_saved: visit.image_keys.length,
      });
    }

    if (toolName === "list_field_partners") {
      const partners = await listFieldPartners(context.env.PORTAL_KV, user, input);
      return JSON.stringify({
        count: partners.length,
        partners: partners.map((partner) => ({
          business_name: partner.business_name,
          location: partner.location,
          study: partner.study,
          contact: partner.contact,
          relationship_stage: partner.relationship_stage,
          workshop_signal: partner.workshop_signal,
          next_visit_on: partner.next_visit_on,
          latest_note: partner.latest_note,
          latest_visit_at: partner.latest_visit_at,
          visit_count: partner.visit_count,
          photo_count: partner.image_keys?.length || 0,
        })),
      });
    }

    if (toolName === "search_contacts") {
      const limit = Math.min(Number(input.limit) || 50, 100);
      const filters = [];
      if (input.name) {
        // GHL multi-search: queries name/email/phone via 'searchAfter' or filter
        // The simple approach: use the 'query' field at top level
      }
      if (input.tag) {
        filters.push({ field: "tags", operator: "contains", value: input.tag });
      }
      const body = {
        locationId: LOCATION_ID,
        pageLimit: limit,
        ...(input.name ? { query: input.name } : {}),
        ...(filters.length > 0 ? { filters } : {}),
      };
      const url = `https://services.leadconnectorhq.com/contacts/search`;
      const resp = await ghlFetch(context, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[cos-anthropic] ${toolName} → GHL ${resp.status} URL=${url} body=${errBody.slice(0, 300)} req=${JSON.stringify(body).slice(0, 200)}`);
        return `Error: GHL ${resp.status} — ${errBody.slice(0, 200) || "(no body)"}`;
      }
      const data = await resp.json();
      const contacts = (data.contacts || []).map(c => {
        const fields = {};
        for (const f of (c.customFields || c.customField || [])) fields[f.id] = f.value;
        return {
          id: c.id,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || null,
          email: c.email || null,
          phone: c.phone || null,
          tags: c.tags || [],
          sessions_remaining: fields[FIELD_SESSIONS_REMAINING] ?? null,
          sessions_completed: fields[FIELD_SESSIONS_COMPLETED] ?? null,
          series_type: fields[FIELD_SERIES_TYPE] ?? null,
          last_activity: c.lastActivity ? new Date(c.lastActivity).toISOString() : null,
          date_added: c.dateAdded ? new Date(c.dateAdded).toISOString() : null,
        };
      });
      return JSON.stringify({ count: contacts.length, contacts }, null, 2);
    }

    if (toolName === "get_contact") {
      const contactId = encodeURIComponent(input.contact_id);
      const locationId = "7pIO7FHVAyBT1jKGhfQM";
      // Fetch contact + orders + invoices + appointments in parallel so we
      // can compute ledger-derived counts (the canonical source per the
      // 2026-05-29 session-fields contract). Raw fields still returned for
      // diagnostic comparison.
      const [resp, ordersResp, invoicesResp, apptResp] = await Promise.all([
        ghlFetch(context, `https://services.leadconnectorhq.com/contacts/${contactId}`),
        ghlFetch(context, `https://services.leadconnectorhq.com/payments/orders?altId=${locationId}&altType=location&contactId=${contactId}&limit=100`),
        ghlFetch(context, `https://services.leadconnectorhq.com/invoices/?altId=${locationId}&altType=location&contactId=${contactId}&limit=100&offset=0`),
        ghlFetch(context, `https://services.leadconnectorhq.com/contacts/${contactId}/appointments`),
      ]);
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[cos-anthropic] ${toolName} → GHL ${resp.status} URL=/contacts/${contactId} body=${errBody.slice(0, 300)}`);
        return `Error: GHL ${resp.status} — ${errBody.slice(0, 200) || "(no body)"}`;
      }
      const data = await resp.json();
      const c = data.contact || data;
      const fields = {};
      for (const f of (c.customFields || c.customField || [])) fields[f.id] = f.value;

      const ledgerFetchFailures = [];
      let orders = [];
      if (ordersResp.ok) { const d = await ordersResp.json(); orders = d.data || d.orders || []; }
      else ledgerFetchFailures.push(`orders (${ordersResp.status})`);
      let invoices = [];
      if (invoicesResp.ok) { const d = await invoicesResp.json(); invoices = d.invoices || []; }
      else ledgerFetchFailures.push(`invoices (${invoicesResp.status})`);
      let appointments = [];
      if (apptResp.ok) { const d = await apptResp.json(); appointments = d.events || d.appointments || []; }
      else ledgerFetchFailures.push(`appointments (${apptResp.status})`);
      // Real fieldDefs, not {}: the low-confidence field fallback is inert
      // with an empty map (GHL contact customFields carry only {id, value}).
      const ledger = deriveLedger({
        contact: c, orders, invoices, appointments,
        fieldDefs: {
          sessions_remaining: GHL_FIELD_IDS.sessions_remaining,
          series_type: GHL_FIELD_IDS.series_type,
          session_prepaid: GHL_FIELD_IDS.session_prepaid,
          sessions_remaining_locked: GHL_FIELD_IDS.sessions_remaining_locked,
        },
        fetchFailures: ledgerFetchFailures,
      });

      return JSON.stringify({
        id: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        email: c.email,
        phone: c.phone,
        tags: c.tags || [],
        // Ledger-derived values are the source of truth for answering
        // "how many sessions does X have left?" — these reflect real money +
        // real attendance, and stay accurate even when the GHL custom fields
        // are mid-drift.
        ledger: {
          series_type: ledger.seriesType,
          sessions_remaining: ledger.remaining,
          sessions_attended: ledger.attended,
          sessions_purchased: ledger.purchased,
          confidence: ledger.confidence,
          ambiguities: ledger.ambiguities,
          last_session_date: ledger.lastSessionDate,
        },
        // Raw GHL field values — useful for diagnosing "field says X, ledger
        // says Y" drift cases. Auto-corrects within ~1 hour via
        // series-reconcile-worker for small deltas.
        custom_fields_named: {
          sessions_remaining: fields[FIELD_SESSIONS_REMAINING] ?? null,
          sessions_completed: fields[FIELD_SESSIONS_COMPLETED] ?? null,
          series_type: fields[FIELD_SERIES_TYPE] ?? null,
        },
        custom_fields_raw: fields,
        last_activity: c.lastActivity ? new Date(c.lastActivity).toISOString() : null,
        date_added: c.dateAdded ? new Date(c.dateAdded).toISOString() : null,
      }, null, 2);
    }

    if (toolName === "get_contact_appointments") {
      const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(input.contact_id)}/appointments`;
      const resp = await ghlFetch(context, url);
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[cos-anthropic] ${toolName} → GHL ${resp.status} URL=${url} body=${errBody.slice(0, 300)}`);
        return `Error: GHL ${resp.status} — ${errBody.slice(0, 200) || "(no body)"}`;
      }
      const data = await resp.json();
      const appts = (data.events || data.appointments || []).map(a => ({
        id: a.id,
        title: a.title || a.calendarName || null,
        start: a.startTime || a.start_time || null,
        status: a.appointmentStatus || a.status || null,
      }));
      return JSON.stringify({ count: appts.length, appointments: appts }, null, 2);
    }

    if (toolName === "search_opportunities") {
      const limit = Math.min(Number(input.limit) || 100, 100);
      const url = `https://services.leadconnectorhq.com/opportunities/search?location_id=${LOCATION_ID}&limit=${limit}`;
      const resp = await ghlFetch(context, url);
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[cos-anthropic] ${toolName} → GHL ${resp.status} URL=${url} body=${errBody.slice(0, 300)}`);
        return `Error: GHL ${resp.status} — ${errBody.slice(0, 200) || "(no body)"}`;
      }
      const data = await resp.json();
      const opps = (data.opportunities || []).map(o => ({
        id: o.id,
        name: o.name || null,
        stage: o.stageName || o.pipelineStageId || null,
        value: o.monetaryValue ?? null,
        contact_id: o.contactId || null,
        updated: o.updatedAt || null,
      }));
      return JSON.stringify({ count: opps.length, opportunities: opps }, null, 2);
    }

    if (toolName === "list_calendar_events") {
      // GHL's /calendars/events REQUIRES a calendarId — a locationId-only query
      // silently returns {events:[]}, causing a 422 or an always-empty result.
      // Sweep each active calendar in parallel and merge, same pattern as
      // getGhlSummary() in cos-chat.js.
      const CALENDAR_IDS = [
        "G7OAnnJuFbMF6nQSlZVQ", // Initial — In Person
        "ySmht5hx4uZGEpgZrlCw", // Initial — Virtual
        "uUDFD0ZQEWtzGLS9aLq7", // Initial — Paid at Partner
        "SKDVOL8wtUN6Ne0ppbC9", // Follow-up — In Person
        "ZO1jlGfy01rsxVqicoSB", // Follow-up — In Person (Package)
        "oVn77FcecFY16iS2pHyP", // Follow-up — Virtual
        "bJFkhVP35Ecwh4tLnSmy", // Follow-up — Virtual (Package)
        "B5aGXLoS4kzAjZAMMXxk", // Entrainment
        "lfsnaiGiLNL2z12pLKDP", // Partner Initial
        "P7T6M1w8wtuRfwAqzOVw", // Partner Initial — Virtual
        "USgPsktqRcuomdUgpShL", // Your Free Discovery Call
        "ZEIGFHBi17SpZ3Ezi5DR", // Discovery Call — Virtual
        "aVE54Qf4lrbYTB0zFqXy", // Partnership Discovery Call
      ];
      const startOffset = pacificOffsetForDate(input.start_date);
      const endOffset = pacificOffsetForDate(input.end_date);
      const startMs = new Date(`${input.start_date}T00:00:00${startOffset}`).getTime();
      const endMs = new Date(`${input.end_date}T23:59:59${endOffset}`).getTime();
      const eventsUrl = (calId) =>
        `https://services.leadconnectorhq.com/calendars/events?locationId=${LOCATION_ID}&calendarId=${calId}&startTime=${startMs}&endTime=${endMs}`;

      const calResps = await Promise.all(
        CALENDAR_IDS.map((id) => ghlFetch(context, eventsUrl(id)).catch(() => null))
      );

      const eventsById = new Map();
      for (const resp of calResps) {
        if (!resp || !resp.ok) continue;
        try {
          const data = await resp.json();
          for (const e of (data.events || [])) {
            if (e && e.id && !eventsById.has(e.id)) eventsById.set(e.id, e);
          }
        } catch { /* skip a malformed calendar response */ }
      }

      const events = [...eventsById.values()]
        .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
        .map(e => ({
          title: e.title || null,
          contact: e.contactName || null,
          contact_id: e.contactId || null,
          start: e.startTime || null,
          status: e.appointmentStatus || null,
        }));
      return JSON.stringify({ count: events.length, events }, null, 2);
    }

    if (toolName === "list_google_calendar_events") {
      const startOffset = pacificOffsetForDate(input.start_date);
      const endOffset = pacificOffsetForDate(input.end_date);
      const timeMin = `${input.start_date}T00:00:00${startOffset}`;
      const timeMax = `${input.end_date}T23:59:59${endOffset}`;
      const events = await listCalendarEventsRaw(context, user, timeMin, timeMax);
      if (events === null) {
        return `Error: failed to fetch Google Calendar events for ${user}`;
      }
      const q = (input.query || "").trim().toLowerCase();
      const filtered = q
        ? events.filter(e =>
            (e.title || "").toLowerCase().includes(q) ||
            (e.location || "").toLowerCase().includes(q))
        : events;
      return JSON.stringify({ count: filtered.length, events: filtered }, null, 2);
    }

    if (toolName === "record_park") {
      const event = await recordPark(context.env, user, {
        location: input.location,
        side: input.side,
        rule_type: input.rule_type || "unknown",
        rule_detail: input.rule_detail,
        deadline_iso: input.deadline_iso,
        reminder_event_id: input.reminder_event_id,
        notes: input.notes,
      });
      return JSON.stringify({
        recorded: true,
        event,
        rule_saved: !!(input.rule_type && input.rule_type !== "unknown" && input.rule_type !== "none"),
      }, null, 2);
    }

    if (toolName === "lookup_parking_rules") {
      const [userMatches, sfResult] = await Promise.all([
        lookupParkingRules(context.env, input.location || ""),
        lookupSfSweep(context.env, input.location || ""),
      ]);
      return JSON.stringify({
        query: input.location || "",
        user_rules: {
          match_count: userMatches.length,
          matches: userMatches,
          formatted: formatRulesForModel(userMatches),
        },
        sf_public_works: {
          available: sfResult.available,
          match_count: sfResult.matches ? sfResult.matches.length : 0,
          matches: sfResult.matches || [],
          formatted: formatSfSweepForModel(sfResult),
        },
      }, null, 2);
    }

    if (toolName === "get_parking_history") {
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
      const history = await getParkingHistory(context.env, user, limit);
      return JSON.stringify({
        count: history.length,
        history,
        formatted: formatHistoryForModel(history),
      }, null, 2);
    }

    if (toolName === "cancel_google_calendar_event") {
      if (!input.event_id) {
        return `Error: event_id is required`;
      }
      const result = await deleteCalendarEvent(
        context,
        user,
        input.event_id,
        input.calendar_id || "primary",
      );
      if (result.ok) {
        return JSON.stringify({
          cancelled: true,
          event_id: input.event_id,
          calendar_id: input.calendar_id || "primary",
          status: result.status,
        });
      }
      return JSON.stringify({
        cancelled: false,
        event_id: input.event_id,
        calendar_id: input.calendar_id || "primary",
        status: result.status,
        error: result.error || "delete failed",
      });
    }

    return `Error: unknown tool "${toolName}"`;
  } catch (err) {
    console.error(`[cos-anthropic] tool ${toolName} failed:`, err.message);
    return `Error executing ${toolName}: ${err.message}`;
  }
}

// Build a Messages API request body. The system prompt is sent as a
// cache_control:"ephemeral" block — Anthropic caches it for 5 min.
// COS already KV-caches the dynamic context (calendar, GHL summary) for
// 5 min, so the assembled system prompt is stable within that window —
// cache hits happen for repeat messages in the same session.
export function buildRequestBody({ system, messages, includeTools = true, maxTokens = 2048 }) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    stream: true,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  };

  if (includeTools) {
    // Cache the tool definitions too (they're stable across all requests)
    body.tools = TOOLS.map((t, i) =>
      i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
    );
  }

  return body;
}

// Make a single Messages API call. Returns the raw streaming Response.
export async function callAnthropic(apiKey, requestBody) {
  return fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
}

// Run a multi-turn streaming chat with tool use.
// Calls onTextDelta(text) for each text chunk Claude produces (across all turns).
// Calls executeToolFn(name, input) when Claude requests a tool.
// Returns { text, usage, tool_calls } when message stops (no more tool_use).
export async function streamWithTools({ apiKey, requestBody, onTextDelta, executeToolFn }) {
  let messages = [...requestBody.messages];
  let allText = "";
  const allToolCalls = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await callAnthropic(apiKey, { ...requestBody, messages });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 500)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const assistantContent = [];
    let currentBlock = null;
    let stopReason = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        if (event.type === "message_start") {
          const u = event.message?.usage || {};
          usage.input_tokens += u.input_tokens || 0;
          usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
          usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
        } else if (event.type === "content_block_start") {
          currentBlock = {
            kind: event.content_block.type,
            id: event.content_block.id,
            name: event.content_block.name,
            text: "",
            partialJson: "",
          };
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            currentBlock.text += event.delta.text;
            allText += event.delta.text;
            try {
              await onTextDelta(event.delta.text);
            } catch (err) {
              console.error("[cos-anthropic] onTextDelta threw:", err.message);
            }
          } else if (event.delta.type === "input_json_delta") {
            currentBlock.partialJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (!currentBlock) continue;
          if (currentBlock.kind === "text") {
            assistantContent.push({ type: "text", text: currentBlock.text });
          } else if (currentBlock.kind === "tool_use") {
            let parsedInput = {};
            try {
              parsedInput = currentBlock.partialJson ? JSON.parse(currentBlock.partialJson) : {};
            } catch (err) {
              console.error(`[cos-anthropic] tool input parse failed:`, currentBlock.partialJson);
            }
            assistantContent.push({
              type: "tool_use",
              id: currentBlock.id,
              name: currentBlock.name,
              input: parsedInput,
            });
            allToolCalls.push({ name: currentBlock.name, input: parsedInput });
          }
          currentBlock = null;
        } else if (event.type === "message_delta") {
          stopReason = event.delta?.stop_reason;
          usage.output_tokens += event.usage?.output_tokens || 0;
        }
      }
    }

    // Done if no more tool calls
    if (stopReason !== "tool_use") {
      break;
    }

    // Append assistant turn
    messages = [...messages, { role: "assistant", content: assistantContent }];

    // Run all tool_use blocks and collect results
    const toolResults = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        const result = await executeToolFn(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
    }
    messages = [...messages, { role: "user", content: toolResults }];
  }

  return { text: allText, usage, tool_calls: allToolCalls };
}
