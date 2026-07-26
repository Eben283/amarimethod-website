// Cross-channel comms coherence — looks at a contact's recent multi-channel
// touch history (call/sms/email, both directions, already cached by
// conversation-cache-worker in conv:{contactId}) and asks Claude to flag what
// a deterministic side-effect check (qa-audit.js) can't see: messages that say
// the same thing in different words across channels, messages that contradict
// each other, and inbound messages that signal the client never actually got
// information we already sent. Pure helpers below are unit tested directly;
// evaluateContact is the only function that makes a network call.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const DAY_MS = 86_400_000;

const SYSTEM = `You are reviewing one Amari Method client's recent cross-channel communication (calls, texts, emails — both what we sent and what they sent back) for COHERENCE, not content quality or sales technique. A separate deterministic system already checks for missing reminders, missing automations, and exact-duplicate messages — do not re-flag those. Your job is the judgment a regex can't do:

- "redundant": two different channels said essentially the same thing, in different words, close together in time — worth noticing even if neither message alone is wrong.
- "contradiction": two messages gave different information about the same fact (a time, a price, an instruction).
- "confusion": an inbound message asks about something a recent outbound message already covered — a sign it didn't land, was unclear, or arrived through a channel the client doesn't check.
- "timing": a burst of outbound sends close together that reads as overwhelming or uncoordinated, OR a session reminder that arrives at or after the session start time stated in that message. The latter is a delivery-timing problem, not a contradiction.

Do NOT flag one outbound call followed by one SMS within a few minutes. That is a normal voicemail / call-follow-up pattern, even if the call record has no duration or text. Do not infer that a short call was unanswered, accidental, or pushy without stronger evidence in the conversation.

Do NOT flag a coordinated email-and-SMS pair sent for the same appointment reminder. That is an intentional cross-channel reminder pattern. A later confirmation that names a different appointment date is a new booking, not a duplicate of the earlier reminder.

All timestamps in the touch history are America/Los_Angeles local time and include PDT or PST. Interpret appointment language using that timezone; never treat the displayed times as UTC.

Only flag things you can point to specific touches for. If the cross-channel activity looks normal and well-coordinated, return an empty flags array — do not invent a flag to have something to say.

Respond as STRICT JSON only (no prose, no markdown fences):
{
  "flags": [
    { "type": "redundant" | "contradiction" | "confusion" | "timing", "severity": "low" | "medium" | "high", "summary": "1-2 sentences, plain, naming what happened", "touchRefs": [<timestamp numbers of the touches involved>] }
  ],
  "confidence": "high" | "low"
}
"confidence":"low" when there's only borderline signal worth a second look, not a clear-cut issue.`;

export function formatPacificTimestamp(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(new Date(timestamp));
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")} ${value("timeZoneName")}`;
}

function formatTouchLine(t) {
  const date = formatPacificTimestamp(t.ts);
  const dir = t.dir === "out" ? "out" : "in";
  const body = t.kind === "call" ? `(call, ${t.dur || 0}s)` : (t.text || "(no text on record)");
  return `[${date} · ${t.kind} · ${dir}] ${body}`;
}

// Keep only touches inside [now - windowDays, now], sorted chronologically.
// Malformed entries (missing/non-numeric ts) are dropped rather than thrown —
// upstream KV data is trusted but not guaranteed pristine.
export function windowTouches(touches, nowMs, windowDays = 3) {
  const cutoff = nowMs - windowDays * DAY_MS;
  return (touches || [])
    .filter((t) => t && typeof t.ts === "number" && Number.isFinite(t.ts) && t.ts >= cutoff && t.ts <= nowMs)
    .sort((a, b) => a.ts - b.ts);
}

// Serialize an already-windowed, already-sorted touch list into the
// chronological narrative Claude reads. Does not re-sort — windowTouches owns
// ordering so this stays a pure formatting step.
export function buildNarrative(touches, contactName) {
  const who = contactName || "the contact";
  if (!touches || !touches.length) return `No recent touches on record for ${who}.`;
  const lines = touches.map(formatTouchLine).join("\n");
  return `Contact: ${who}\n\n--- RECENT CROSS-CHANNEL TOUCHES (chronological) ---\n${lines}`;
}

const VALID_TYPES = new Set(["redundant", "contradiction", "confusion", "timing"]);
const VALID_SEVERITY = new Set(["low", "medium", "high"]);

// Defensive parse/validate of Claude's JSON response — same pattern as
// call-coach-worker/src/coach.js's parseCoaching(): strip fences/prose, then
// coerce every field to a safe default rather than trusting the model's shape.
export function parseFlags(text) {
  let raw = (text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  const flags = Array.isArray(obj.flags)
    ? obj.flags
        .filter((f) => f && typeof f.summary === "string" && f.summary.trim())
        .map((f) => ({
          type: VALID_TYPES.has(f.type) ? f.type : "other",
          severity: VALID_SEVERITY.has(f.severity) ? f.severity : "low",
          summary: f.summary.trim(),
          touchRefs: Array.isArray(f.touchRefs) ? f.touchRefs.filter((n) => typeof n === "number") : [],
        }))
    : [];
  return {
    flags,
    confidence: obj.confidence === "low" ? "low" : "high",
  };
}

// Returns { result, error }. result is { flags, confidence } on success, plus
// bookkeeping (contactId, evaluatedTouchCount) the caller persists alongside it.
export async function evaluateContact(env, { contactId, contactName, touches, nowMs, windowDays = 3 }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY not configured" };

  const windowed = windowTouches(touches, nowMs, windowDays);
  if (windowed.length < 2) return { error: "nothing to evaluate (fewer than 2 touches in window)" };

  const body = {
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: "user", content: buildNarrative(windowed, contactName) }],
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
  const result = parseFlags(text);
  if (!result) return { error: "could not parse flags JSON", rawText: text.slice(0, 300) };
  return { result, contactId, evaluatedTouchCount: windowed.length };
}
