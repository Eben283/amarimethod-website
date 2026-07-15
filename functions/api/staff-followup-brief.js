// Cloudflare Pages Function: POST /api/staff-followup-brief
//
// The "Build brief" action on a Follow-Up card. Given a prospect (context passed
// from the card) + their recent conversation thread, Claude returns:
//   { summary, talkingPoints[], drafts:[{channel, text}] }
// — who they are + what to bring up + 2-3 ready-to-send messages in Garrett's
// voice. Drafted, never sent (the human is the gate).
//
// Auth: JWT bearer (staff). Model: claude-sonnet-4-6 (matches COS).

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-6";


// Garrett's voice + Amari context + strict-JSON contract. The banned phrases are
// the recurring failure (see amari-method-docs feedback_copy_no_punchlines).
const SYSTEM = `You are the outreach assistant and sales coach for Amari Method (Garrett Hewstan).

WHAT AMARI IS: Garrett teaches people at-home "protocols" (never call them "exercises") that rebalance the body and relieve pain — most pain is muscular imbalance people can correct themselves, not injury. For partners (trainers, coaches, golf/tennis instructors, gym owners) the offer is: a gifted session to feel the work, then a partnership program where Amari helps their clients.

GOAL: move this partner prospect one step forward — usually toward booking the gifted session, or re-opening a stalled thread.

GARRETT'S VOICE — match it exactly:
- Warm, plain, direct, a little enthusiastic. First person. Never "Dr." or "doctor."
- Real example of how he texts: "Hi James — Garrett here. I teach clients at-home protocols that work really well for low back and hip pain. Happy to gift you a session if you want to feel the work, and we can talk partnership if you're interested."
- BANNED (never write these — they read as AI marketing): "no pressure", "no rush", "just say the word", "whenever you're ready", "worth a quick call?", "circling back", "just checking in", "touching base", "would love to connect", exclamation-point hype, emoji, "Dr.", "doctor", "chiropractor", "DC".
- Write texts like a person texting, not a short email. State it and stop.

OUTPUT: strict JSON only, no prose, no code fences. Shape exactly:
{"summary": "1-2 sentences: who they are + where this stands", "talkingPoints": ["2-4 concrete, specific things to bring up on a call"], "drafts": [{"channel": "text"|"call"|"email", "text": "a ready-to-send message in Garrett's voice"}]}
Give 2-3 drafts. Prefer "text" channel unless the thread suggests a call or email fits better. Use the prospect's real details (name, what they do, where) — never invent facts you weren't given.`;

function buildUserPrompt(contact, thread) {
  const c = contact || {};
  const lines = [];
  lines.push("PROSPECT:");
  if (c.name) lines.push(`- Name: ${c.name}`);
  if (c.category) lines.push(`- Type: ${c.category}`);
  if (c.facility) lines.push(`- Facility: ${c.facility}${c.facilityRole ? ` (${c.facilityRole})` : ""}`);
  if (c.company) lines.push(`- Company: ${c.company}`);
  if (c.city || c.state) lines.push(`- Location: ${[c.city, c.state].filter(Boolean).join(", ")}`);
  if (c.rundown) lines.push(`- Notes: ${c.rundown}`);
  if (c.lastSignal) lines.push(`- Last outreach: ${c.lastSignal}${c.lastSignalAt ? ` on ${c.lastSignalAt}` : ""}`);
  lines.push("");
  if (thread && thread.length) {
    lines.push("RECENT THREAD (most recent last):");
    for (const m of thread) {
      lines.push(`- [${m.channel}/${m.direction}] ${m.body || "(no text — e.g. a call)"}`);
    }
  } else {
    lines.push("No prior messages on record.");
  }
  lines.push("");
  lines.push("Produce the brief as strict JSON.");
  return lines.join("\n");
}

function parseBrief(text) {
  let t = (text || "").trim();
  // Strip ```json fences if present.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const obj = JSON.parse(t);
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    talkingPoints: Array.isArray(obj.talkingPoints) ? obj.talkingPoints.filter((x) => typeof x === "string") : [],
    drafts: Array.isArray(obj.drafts)
      ? obj.drafts
          .filter((d) => d && typeof d.text === "string")
          .map((d) => ({ channel: ["text", "call", "email"].includes(d.channel) ? d.channel : "text", text: d.text }))
      : [],
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "POST, OPTIONS") });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "POST, OPTIONS"), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;

    const apiKey = context.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: "Brief not configured (missing ANTHROPIC_API_KEY)" }), { status: 500, headers });

    const payload = await context.request.json().catch(() => ({}));
    const { contactId, contact } = payload;
    if (!contactId) return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });

    // Gather the recent thread (best-effort — brief still works without it).
    const thread = [];
    try {
      const ghlToken = await getGhlToken(context);
      if (ghlToken) {
        const convRes = await fetch(
          `${GHL_API_BASE}/conversations/search?contactId=${encodeURIComponent(contactId)}&locationId=${GHL_LOCATION_ID}`,
          { headers: ghlHeaders(ghlToken) },
        );
        if (convRes.ok) {
          const convData = await convRes.json();
          const conv = (convData.conversations || [])[0];
          if (conv) {
            const msgRes = await fetch(`${GHL_API_BASE}/conversations/${conv.id}/messages?limit=15`, { headers: ghlHeaders(ghlToken) });
            if (msgRes.ok) {
              const msgData = await msgRes.json();
              const messages = (msgData.messages?.messages || []).slice().reverse();
              for (const m of messages) {
                const tRaw = String(m.messageType || m.type || "").toUpperCase();
                const channel = tRaw.includes("CALL") ? "call" : tRaw.includes("EMAIL") ? "email" : "sms";
                thread.push({
                  channel,
                  direction: m.direction === "inbound" ? "inbound" : "outbound",
                  body: typeof m.body === "string" ? m.body.replace(/<[^>]*>/g, "").slice(0, 300) : "",
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[staff-followup-brief] thread fetch failed (continuing):", err instanceof Error ? err.message : err);
    }

    const body = {
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserPrompt(contact, thread) }],
    };

    const aiRes = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => "");
      console.error("[staff-followup-brief] Anthropic error:", aiRes.status, detail.slice(0, 300));
      return new Response(JSON.stringify({ error: "Couldn't build the brief — model error. Try again." }), { status: 422, headers });
    }
    const aiData = await aiRes.json();
    const text = aiData?.content?.[0]?.text || "";
    let brief;
    try {
      brief = parseBrief(text);
    } catch {
      console.error("[staff-followup-brief] JSON parse failed:", text.slice(0, 300));
      return new Response(JSON.stringify({ error: "Couldn't read the brief. Try again." }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ contactId, generatedAt: new Date().toISOString(), ...brief }), { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-followup-brief] failed:", detail);
    return new Response(JSON.stringify({ error: `Failed to build brief: ${detail}` }), { status: 500, headers });
  }
}
