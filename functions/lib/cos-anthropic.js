// Native Anthropic Messages API wrapper for COS chat.
// - Tool-use loop for GHL queries (multi-step reasoning)
// - Prompt caching via cache_control breakpoints (~70% cost savings on stable prefix)
// - SSE streaming with text-delta forwarding + tool execution

import { ghlFetch } from "./ghl.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const MAX_TOOL_ROUNDS = 5;

// GHL custom field IDs
const FIELD_SESSIONS_REMAINING = "wrQSkx6BhXwDGIn1d0V4";
const FIELD_SESSIONS_COMPLETED = "TE0udwVH1Km5RsKaN5H0";
const FIELD_SERIES_TYPE = "3i93lTkmuAV49s9nh0q8";

// Tool definitions exposed to Claude.
export const TOOLS = [
  {
    name: "search_contacts",
    description: "Search GHL contacts by name, email, phone, or tag. Returns matching contacts with custom fields (sessions_remaining, sessions_completed, series_type), tags, and dates. Use 'name' for substring search, 'tag' to filter by an exact tag like 'affiliate-partner' or 'affiliate-referral'. You can combine name + tag.",
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
export async function executeTool(context, toolName, input) {
  try {
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
      const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(input.contact_id)}`;
      const resp = await ghlFetch(context, url);
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[cos-anthropic] ${toolName} → GHL ${resp.status} URL=${url} body=${errBody.slice(0, 300)}`);
        return `Error: GHL ${resp.status} — ${errBody.slice(0, 200) || "(no body)"}`;
      }
      const data = await resp.json();
      const c = data.contact || data;
      const fields = {};
      for (const f of (c.customFields || c.customField || [])) fields[f.id] = f.value;
      return JSON.stringify({
        id: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        email: c.email,
        phone: c.phone,
        tags: c.tags || [],
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
      const startOffset = pacificOffsetForDate(input.start_date);
      const endOffset = pacificOffsetForDate(input.end_date);
      const startMs = new Date(`${input.start_date}T00:00:00${startOffset}`).getTime();
      const endMs = new Date(`${input.end_date}T23:59:59${endOffset}`).getTime();
      const url = `https://services.leadconnectorhq.com/calendars/events?locationId=${LOCATION_ID}&startTime=${startMs}&endTime=${endMs}`;
      const resp = await ghlFetch(context, url);
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[cos-anthropic] ${toolName} → GHL ${resp.status} URL=${url} body=${errBody.slice(0, 300)}`);
        return `Error: GHL ${resp.status} — ${errBody.slice(0, 200) || "(no body)"}`;
      }
      const data = await resp.json();
      const events = (data.events || []).map(e => ({
        title: e.title || null,
        contact: e.contactName || null,
        contact_id: e.contactId || null,
        start: e.startTime || null,
        status: e.appointmentStatus || null,
      }));
      return JSON.stringify({ count: events.length, events }, null, 2);
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
