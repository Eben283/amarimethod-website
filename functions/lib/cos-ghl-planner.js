// Two-phase GHL tool use over OpenRouter.
// Haiku plans a read-only GHL query, we execute against a whitelist,
// the result is injected into the main streaming Sonnet call.

import { ghlFetch } from "./ghl.js";

const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs → human names (for compact result rendering)
const FIELD_SESSIONS_REMAINING = "wrQSkx6BhXwDGIn1d0V4";
const FIELD_SESSIONS_COMPLETED = "TE0udwVH1Km5RsKaN5H0";
const FIELD_SERIES_TYPE = "3i93lTkmuAV49s9nh0q8";

// Read-only endpoint whitelist. {id} is a placeholder for any string segment.
const ALLOWED_ENDPOINTS = [
  "/contacts/search",
  "/contacts/{id}",
  "/contacts/{id}/appointments",
  "/opportunities/search",
  "/calendars/events",
];

const PLANNER_SYSTEM_PROMPT = `You are a GHL query planner. Given a user question about Amari Method client data, decide which read-only GHL API call answers it best.

Output STRICT JSON only. No prose, no markdown. One of these shapes:
{"action":"none","reason":"<why no GHL query needed>"}
{"action":"query","endpoint":"<path>","params":{<query params>}}

Available endpoints (all read-only):
- /contacts/search — params: locationId (required), query (name/email/phone substring), limit (max 100). Returns contacts with custom fields, tags, dateAdded, lastActivity.
- /contacts/{id}/appointments — substitute {id}. Returns full appointment history for one contact.
- /opportunities/search — params: location_id (required), pipeline_id, pipeline_stage_id, limit. Returns deals with stage names + monetaryValue + updatedAt.
- /calendars/events — params: locationId (required), startTime (ms epoch), endTime (ms epoch). Returns appointments in time window.

Always include locationId or location_id = "${LOCATION_ID}" as appropriate for the endpoint.

Custom field IDs visible in /contacts results:
- ${FIELD_SESSIONS_REMAINING} = sessions_remaining
- ${FIELD_SESSIONS_COMPLETED} = sessions_completed
- ${FIELD_SERIES_TYPE} = series_type (none / 4-session / 8-session)

Heuristics:
- "Lapsed / inactive / haven't booked recently / who should I reach out to" → /contacts/search with limit 100. Downstream code will rank by lastActivity.
- "Pipeline / what's in the funnel / how many leads" → /opportunities/search with limit 100.
- Specific person by name → /contacts/search with that name as query.
- "What's on the calendar [date]" → /calendars/events with the right startTime/endTime in ms.
- Weather, math, general advice, music, conversation about feelings → action:"none".`;

// Phase 1: ask Haiku what to query. 5s timeout — must never block the main chat.
export async function planGhlQuery(message, openRouterKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://www.amarimethod.com",
        "X-Title": "Chief of Staff Planner",
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
        max_tokens: 300,
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      console.error("[cos-ghl-planner] OpenRouter status", resp.status);
      return { action: "none", reason: "planner_http_error" };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";

    try {
      return JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
      return { action: "none", reason: "invalid_plan_json" };
    }
  } catch (err) {
    console.error("[cos-ghl-planner] planner error:", err.message);
    return { action: "none", reason: `planner_error: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

// Phase 2: validate plan against whitelist and execute.
export async function executeGhlQuery(context, plan) {
  if (!plan || plan.action !== "query") return null;

  const endpoint = plan.endpoint || "";
  const isAllowed = ALLOWED_ENDPOINTS.some(pattern => {
    const re = new RegExp(`^${pattern.replace(/\{id\}/g, "[^/]+")}$`);
    return re.test(endpoint);
  });
  if (!isAllowed) {
    return { error: `Endpoint ${endpoint} not in read-only whitelist` };
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(plan.params || {})) {
    if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `https://services.leadconnectorhq.com${endpoint}${qs.toString() ? `?${qs}` : ""}`;

  try {
    const resp = await ghlFetch(context, url);
    if (!resp.ok) return { error: `GHL ${resp.status}` };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

// Render result compactly for system-prompt injection.
// On failure, surface a clear notice so Claude does NOT hallucinate — better to say
// "I couldn't pull that" than invent appointment times, session counts, names, etc.
export function formatGhlResult(plan, result) {
  if (!result) {
    return `## GHL Query Failed\nA lookup was attempted for this question but returned no result. DO NOT guess client names, appointment times, session counts, or status. Tell the user the lookup failed and to check GHL directly, or to try the question again.`;
  }
  if (result.error) {
    console.error("[cos-ghl-planner] query failed:", plan.endpoint, result.error);
    return `## GHL Query Failed\nEndpoint: ${plan.endpoint}\nError: ${result.error}\nDO NOT guess client names, appointment times, session counts, or status. Tell the user the lookup failed and to check GHL directly, or to try the question again.`;
  }

  const lines = [`## GHL Query Result`, `Endpoint: ${plan.endpoint}`, `Params: ${JSON.stringify(plan.params || {})}`, ""];

  if (Array.isArray(result.contacts)) {
    lines.push(`Contacts (${result.contacts.length}):`);
    for (const c of result.contacts.slice(0, 40)) {
      const fields = {};
      for (const f of (c.customFields || c.customField || [])) fields[f.id] = f.value;
      const sr = fields[FIELD_SESSIONS_REMAINING] ?? "?";
      const sc = fields[FIELD_SESSIONS_COMPLETED] ?? "?";
      const st = fields[FIELD_SERIES_TYPE] ?? "none";
      const last = c.lastActivity ? new Date(c.lastActivity).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "n/a";
      const added = c.dateAdded ? new Date(c.dateAdded).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "n/a";
      const tags = (c.tags || []).slice(0, 5).join(",");
      lines.push(`- ${c.firstName || ""} ${c.lastName || ""} <${c.email || "no-email"}> | series:${st} done:${sc} left:${sr} | lastActivity:${last} added:${added} | tags:[${tags}] | id:${c.id}`);
    }
  } else if (Array.isArray(result.opportunities)) {
    lines.push(`Opportunities (${result.opportunities.length}):`);
    for (const o of result.opportunities.slice(0, 40)) {
      const updated = o.updatedAt ? new Date(o.updatedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "?";
      lines.push(`- ${o.name || "(unnamed)"} | stage:${o.stageName || o.pipelineStageId || "?"} | value:${o.monetaryValue ?? "?"} | updated:${updated} | id:${o.id}`);
    }
  } else if (Array.isArray(result.events)) {
    lines.push(`Calendar events (${result.events.length}):`);
    for (const e of result.events.slice(0, 40)) {
      const t = e.startTime ? new Date(e.startTime).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "?";
      lines.push(`- ${t}: ${e.title || "Session"} — ${e.contactName || "?"} (${e.appointmentStatus || "?"})`);
    }
  } else if (Array.isArray(result.appointments)) {
    lines.push(`Appointments (${result.appointments.length}):`);
    for (const a of result.appointments.slice(0, 30)) {
      const t = a.startTime ? new Date(a.startTime).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "?";
      lines.push(`- ${t}: ${a.title || "?"} (${a.appointmentStatus || a.status || "?"})`);
    }
  } else {
    lines.push("Raw (truncated):", JSON.stringify(result).slice(0, 2000));
  }

  return lines.join("\n");
}

// Convenience: do all three phases. Returns formatted string or null.
export async function runGhlPlanner(context, message, openRouterKey) {
  const plan = await planGhlQuery(message, openRouterKey);
  if (!plan || plan.action !== "query") return null;
  const result = await executeGhlQuery(context, plan);
  return formatGhlResult(plan, result);
}
