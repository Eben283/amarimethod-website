// Shared inbound-message triage: is this last inbound worth treating as "needs reply"?

const CLOSER_WORD =
  "(?:i'?m good|all good|we'?re good|likewise|thanks|thank you|thx|ty|no thanks|got it|sounds good|will do|cheers|np)";
const CLOSER_RE = new RegExp(`^(?:${CLOSER_WORD}[\\s!.,]*)+$`, "i");

export function isNonReply(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/please type your reply above this line|^#{2}-|-#{2}$/i.test(t)) return true;
  if (/\bverification code\b|\bis your\b[^.]*\bcode\b|\byour\b[^.]*\bcode is\b|\bone[- ]?time (code|password)\b|\bOTP\b|do not share/i.test(t)) return true;
  if (t.length <= 40 && CLOSER_RE.test(t)) return true;
  return false;
}
