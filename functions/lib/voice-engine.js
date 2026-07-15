// voice-engine.js — the on-brand guarantee for Amari copy.
//
// One job: turn a brief (or a pasted draft) into client-facing copy that actually
// passes the Amari voice standard, every time. It does NOT trust a single
// generation call. It generates, then runs a SEPARATE auditor pass whose only job
// is to check the draft against the standard and rewrite anything that fails,
// looping until the auditor passes it (or a cap is hit). A fresh auditor context
// catches the tells the writer rationalized away — that's the whole point.
//
// This is a shared foundation, not a one-off. The Voice Writer tool is its first
// caller; outbound SMS/email automations can route through the same gate later.
//
// Reuses the existing Anthropic client (cos-anthropic.js) — no second client.
// Voice source of truth: voice-standard.js (copy of claude-config/rules/common/voice.md).

import { VOICE_STANDARD } from "./voice-standard.js";
import { buildRequestBody, streamWithTools } from "./cos-anthropic.js";
import { mechanicalTells } from "./slop-lint.js";

const CHANNELS = ["sms", "email", "website", "ad", "outreach", "internal"];
const DEFAULT_MAX_ROUNDS = 4;

// One completion via the shared client, no tools, no browser streaming — we just
// want the final text back.
async function complete(apiKey, system, messages, maxTokens) {
  const requestBody = buildRequestBody({
    system,
    messages,
    includeTools: false,
    maxTokens,
  });
  const { text } = await streamWithTools({
    apiKey,
    requestBody,
    onTextDelta: () => {}, // accumulate only; nothing streams to the client here
    executeToolFn: async () => "", // no tools are ever offered, so this is unreachable
  });
  return (text || "").trim();
}

// ── Pass 1: generate ─────────────────────────────────────────────────────────
function generatorSystem(userName) {
  return `${VOICE_STANDARD}

---

You are the Amari Method copywriter. Write client-facing copy that already passes the standard above. Most copy goes out under Garrett's name, so default to his warm register unless the request is clearly an internal note.

You are working with ${userName}. Two jobs:
- If ${userName} describes what to write, write it.
- If ${userName} pastes a draft and asks to fix/clean/de-slop it, rewrite it fresh through the four-pass procedure. Keep every fact, name, number, and commitment. Keep the warmth. Do not over-strip.

Figure out the channel from the request. If it names one, use it. If not, infer the most likely one.

Output EXACTLY this shape and nothing else. No preamble, no sign-off, no commentary:
CHANNEL: <one of: ${CHANNELS.join(" | ")}>
COPY:
<the copy, ready to send — for email include a subject line then the body>`;
}

// ── Pass 2+: audit against the standard, rewrite failures ────────────────────
function auditorSystem() {
  return `${VOICE_STANDARD}

---

You are the Amari voice auditor. You did not write the draft below and you owe it no loyalty, but you are also not a nitpicker. Real human copy has slack in it. Your job is to decide whether the draft passes the standard, and to fix it only when it genuinely does not.

DEFAULT TO PASS. Only return REVISE when you can name a concrete violation: a specific tell from the catalog, a terminology or legal breach, a punchline ending, or copy that has been stripped cold. Do NOT revise to make the copy "better", "tighter", or more to your taste. If it reads like something Garrett would actually send and breaks no rule, it PASSES, unchanged.

One exception overrides the default: if a "MECHANICAL TELLS TO REMOVE" list is included with the draft, those are objective, confirmed violations. You MUST rewrite to remove every one of them, and your verdict is REVISE. Removing a banned word is not optional.

When you do revise, rewrite the sentence, don't just delete words. Preserve every fact, name, number, and commitment. Keep the warmth. Don't over-strip.

Output EXACTLY this shape and nothing else:
VERDICT: <PASS or REVISE>
FIXED: <one short line naming what was wrong, or "nothing" if PASS>
COPY:
<the final on-brand copy — unchanged if PASS, rewritten if REVISE>`;
}

function auditInput(taskText, copy, tells) {
  const tellBlock = tells.length
    ? `\n\nMECHANICAL TELLS TO REMOVE (objective, confirmed — you MUST remove each and REVISE):\n${tells.map((t) => `- ${t.label}`).join("\n")}`
    : "";
  return [
    { role: "user", content: `REQUEST (what the copy is for):\n${taskText}\n\nDRAFT TO AUDIT:\n${copy}${tellBlock}` },
  ];
}

function parseGenerated(text) {
  const channelMatch = text.match(/CHANNEL:\s*([a-z]+)/i);
  const copyMatch = text.match(/COPY:\s*([\s\S]*)$/i);
  const channelRaw = channelMatch ? channelMatch[1].toLowerCase() : "";
  return {
    channel: CHANNELS.includes(channelRaw) ? channelRaw : "unknown",
    // If the model ignored the format, fall back to the whole text as the copy so
    // we never lose the draft — the auditor will still clean whatever we pass it.
    copy: (copyMatch ? copyMatch[1] : text).trim(),
  };
}

function parseAudit(text) {
  const verdictMatch = text.match(/VERDICT:\s*(PASS|REVISE)/i);
  const fixedMatch = text.match(/FIXED:\s*(.+)/i);
  const copyMatch = text.match(/COPY:\s*([\s\S]*)$/i);
  return {
    verdict: verdictMatch ? verdictMatch[1].toUpperCase() : "REVISE",
    fixed: fixedMatch ? fixedMatch[1].trim() : "",
    copy: (copyMatch ? copyMatch[1] : text).trim(),
  };
}

/**
 * generateOnBrand — the public interface of the gate.
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey        Anthropic key (context.env.ANTHROPIC_API_KEY)
 * @param {string}   opts.userName      who's driving ("Garrett" | "Eben" | "Staff")
 * @param {Array}    opts.messages      conversation so far: [{role, content}, ...],
 *                                      last one being the current request/brief/paste
 * @param {number}   [opts.maxRounds=3]  audit/revise rounds before best-effort return
 * @returns {Promise<{copy, channel, fixes: string[], rounds, passedClean, remainingTells: string[]}>}
 */
export async function generateOnBrand({ apiKey, userName = "Garrett", messages, maxRounds = DEFAULT_MAX_ROUNDS }) {
  if (!apiKey) throw new Error("voice-engine: missing Anthropic API key");
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("voice-engine: messages array is required");
  }

  // Pass 1 — generate.
  const generated = await complete(apiKey, generatorSystem(userName), messages, 1500);
  let { channel, copy } = parseGenerated(generated);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const taskText = lastUser ? lastUser.content : "";

  // Pass 2+ — audit and revise. "Clean" requires BOTH: the model auditor signs off
  // (PASS) AND the objective checker finds zero mechanical tells. Any mechanical
  // tells are fed to the auditor as a forced-removal list so the loop converges
  // instead of nitpicking forever.
  const fixes = [];
  let rounds = 0;
  let modelPassed = false;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    const tells = mechanicalTells(copy);

    const audited = await complete(apiKey, auditorSystem(), auditInput(taskText, copy, tells), 1500);
    const { verdict, fixed, copy: revisedCopy } = parseAudit(audited);

    modelPassed = verdict === "PASS" && tells.length === 0;
    if (fixed && fixed.toLowerCase() !== "nothing") fixes.push(fixed);
    if (revisedCopy) copy = revisedCopy;

    // Done only when the model signed off AND nothing objective remains in the
    // copy it handed back.
    if (modelPassed && mechanicalTells(copy).length === 0) break;
  }

  const remaining = mechanicalTells(copy);
  const passedClean = modelPassed && remaining.length === 0;

  return {
    copy,
    channel,
    fixes,                                    // what got caught and fixed, in order
    rounds,                                   // how many audit rounds ran
    passedClean,                              // true = model signed off + zero mechanical tells
    remainingTells: remaining.map((t) => t.label), // non-empty only if we capped out dirty
  };
}
