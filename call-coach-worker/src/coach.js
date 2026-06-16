// Claude coaching pass over a contact's FULL relationship — every call
// transcript + the complete two-way message thread (both directions).
// Produces constructive, specific, evidence-based pointers for Garrett —
// "what worked / what to improve / objections / next step" — grounded ONLY in
// what was actually said. No fabrication, no generic sales-script advice.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// Amari context so the coach judges against how Garrett actually works, not a
// generic high-pressure sales frame. Mirrors the positioning rules: warm,
// grounded, "your body can heal you", no woo, no "fix", no hard close.
const SYSTEM = `You are a calls/texts coach for Garrett, the practitioner at Amari Method — a bodywork practice where Garrett guides and the client does the work ("teaching you to heal yourself"). Tone is warm, grounded, confident — never clinical, never woo, never high-pressure sales.

You are given the FULL relationship with one contact: every call transcript we have AND the complete two-way message thread (both the contact's replies and Garrett's outgoing messages), in chronological order. Coach the MOST RECENT interaction, but always in the context of the whole relationship — what was said on earlier calls, what the contact has already replied, where things stand now. Rules:
- The contact's OWN replies are included. Read them. Never say "no response" or "no prior context" when the thread shows otherwise — judge the relationship as it actually is.
- Ground EVERY point in something actually said. Quote or closely paraphrase. Never invent what "should" have happened from generic sales literature.
- Be constructive and concrete, not vague ("ask more questions" is useless — say WHICH question, anchored to a real moment).
- Judge against Amari's style: invite, don't pressure; lead with the client's problem in their words; offer the next concrete step (book a first session, send the booking link) without a hard close.
- If a recent call was just a voicemail or a short logistics text, that's fine — coach the relationship it sits inside (e.g. an unanswered question the contact raised), not the 12 seconds in isolation.
- If the interaction was good, say what specifically worked and why — don't manufacture criticism.
- If there is genuinely too little across the whole relationship to coach, say so plainly rather than padding.

Respond as STRICT JSON only (no prose, no markdown fences) with this shape:
{
  "summary": "1-2 sentence plain summary of what this interaction was",
  "whatWorked": ["specific, quoted/anchored point", ...],
  "whatToImprove": ["specific, actionable, anchored point", ...],
  "objections": ["objection the client raised + how it was/should be handled", ...],
  "nextStep": "the single concrete next action for Garrett with this person",
  "suggestedReply": "a ready-to-send message, or empty string",
  "signal": "high" | "low"
}
Use empty arrays where a section doesn't apply. "signal":"low" when there wasn't enough to meaningfully coach.

"suggestedReply" rules: if the contact's MOST RECENT message is an inbound that warrants a response (a question, a reply, an objection left hanging), write the actual message Garrett should send back — ready to send as-is, in his warm grounded voice, grounded in what they actually said and the whole relationship. No placeholder brackets, no "[link]" unless you write a real instruction the app can't fill (prefer "the booking link" in words). 1-4 sentences. This is the ONE field Garrett may send as-is, so it must pass the outbound-copy bar: write it the way he texts a person, NOT written prose. NO em-dashes (use a period or comma), NO semicolons, no "—", no corporate polish, no filler like "honestly/genuinely". Warm, plain, grounded. If the latest interaction does NOT need a reply from Garrett (e.g. he left a voicemail, or the ball is genuinely in his court to act not reply), set "suggestedReply" to an empty string.`;

function buildUserContent({ contactName, transcript, thread }) {
  const who = contactName || "the contact";
  const parts = [];
  parts.push(`Contact: ${contactName || "(unknown)"}`);
  if (transcript) {
    parts.push(`\n--- CALL TRANSCRIPT(S) (chronological; may include earlier calls) ---\n${transcript}`);
  } else {
    parts.push(`\n(No call recording/transcript available — coach from the message thread below.)`);
  }
  if (thread && thread.length) {
    const lines = thread
      .map((m) => {
        const sender = m.direction === "outbound" ? "Garrett" : who;
        const date = (m.date || "").slice(0, 10);
        return `[${date} · ${sender} · ${m.channel}] ${m.body}`;
      })
      .join("\n");
    parts.push(`\n--- FULL MESSAGE THREAD (both directions, chronological) ---\n${lines}`);
  } else {
    parts.push(`\n(No text messages on record with this contact.)`);
  }
  return parts.join("\n");
}

function parseCoaching(text) {
  // Claude is asked for strict JSON; be defensive about stray fences/prose.
  let raw = (text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  try {
    const obj = JSON.parse(raw);
    return {
      summary: typeof obj.summary === "string" ? obj.summary : "",
      whatWorked: Array.isArray(obj.whatWorked) ? obj.whatWorked : [],
      whatToImprove: Array.isArray(obj.whatToImprove) ? obj.whatToImprove : [],
      objections: Array.isArray(obj.objections) ? obj.objections : [],
      nextStep: typeof obj.nextStep === "string" ? obj.nextStep : "",
      suggestedReply: typeof obj.suggestedReply === "string" ? obj.suggestedReply : "",
      signal: obj.signal === "low" ? "low" : "high",
    };
  } catch {
    return null;
  }
}

// Returns { coaching, error }. coaching is the parsed object on success.
export async function coachInteraction(env, { contactName, transcript, thread }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY not configured" };

  if (!transcript && !(thread && thread.length)) {
    return { error: "nothing to coach (no transcript, no message thread)" };
  }

  const body = {
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserContent({ contactName, transcript, thread }) }],
  };

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { error: `anthropic request failed: ${err.message}` };
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { error: `anthropic ${res.status}: ${detail}` };
  }

  const data = await res.json().catch(() => null);
  const text = data?.content?.[0]?.text || "";
  const coaching = parseCoaching(text);
  if (!coaching) return { error: "could not parse coaching JSON", rawText: text.slice(0, 300) };
  return { coaching };
}
