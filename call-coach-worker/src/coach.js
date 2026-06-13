// Claude coaching pass over a call transcript + recent outgoing texts.
// Produces constructive, specific, evidence-based pointers for Garrett —
// "what worked / what to improve / objections / next step" — grounded ONLY in
// what was actually said. No fabrication, no generic sales-script advice.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// Amari context so the coach judges against how Garrett actually works, not a
// generic high-pressure sales frame. Mirrors the positioning rules: warm,
// grounded, "your body can heal you", no woo, no "fix", no hard close.
const SYSTEM = `You are a calls/texts coach for Garrett, the practitioner at Amari Method — a bodywork practice positioned as "a doctor who teaches you to heal yourself." Garrett guides; the client does the work. Tone is warm, grounded, confident — never clinical, never woo, never high-pressure sales.

You review one outreach interaction (a phone call transcript and/or recent outgoing texts) and give Garrett honest, specific, evidence-based coaching. Rules:
- Ground EVERY point in something actually said. Quote or closely paraphrase. Never invent what "should" have happened from generic sales literature.
- Be constructive and concrete, not vague ("ask more questions" is useless — say WHICH question, anchored to a real moment).
- Judge against Amari's style: invite, don't pressure; lead with the client's problem in their words; offer the next concrete step (book a first session, send the booking link) without a hard close.
- If the interaction was good, say what specifically worked and why — don't manufacture criticism.
- If there is too little signal to coach (e.g. a 12-second voicemail, one logistics text), say so plainly rather than padding.

Respond as STRICT JSON only (no prose, no markdown fences) with this shape:
{
  "summary": "1-2 sentence plain summary of what this interaction was",
  "whatWorked": ["specific, quoted/anchored point", ...],
  "whatToImprove": ["specific, actionable, anchored point", ...],
  "objections": ["objection the client raised + how it was/should be handled", ...],
  "nextStep": "the single concrete next action for Garrett with this person",
  "signal": "high" | "low"
}
Use empty arrays where a section doesn't apply. "signal":"low" when there wasn't enough to meaningfully coach.`;

function buildUserContent({ contactName, transcript, outgoingTexts }) {
  const parts = [];
  parts.push(`Contact: ${contactName || "(unknown)"}`);
  if (transcript) {
    parts.push(`\n--- CALL TRANSCRIPT ---\n${transcript}`);
  } else {
    parts.push(`\n(No call recording/transcript available for this interaction.)`);
  }
  if (outgoingTexts && outgoingTexts.length) {
    const texts = outgoingTexts
      .map((t) => `[${t.channel} ${t.date}] ${t.body}`)
      .join("\n");
    parts.push(`\n--- RECENT OUTGOING TEXTS (Garrett → contact) ---\n${texts}`);
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
      signal: obj.signal === "low" ? "low" : "high",
    };
  } catch {
    return null;
  }
}

// Returns { coaching, error }. coaching is the parsed object on success.
export async function coachInteraction(env, { contactName, transcript, outgoingTexts }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY not configured" };

  if (!transcript && !(outgoingTexts && outgoingTexts.length)) {
    return { error: "nothing to coach (no transcript, no outgoing texts)" };
  }

  const body = {
    model: MODEL,
    max_tokens: 900,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserContent({ contactName, transcript, outgoingTexts }) }],
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
