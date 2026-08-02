// Determines which backend owns an Ask Amari turn. Deliberately conservative:
// client-data and operational questions stay with Chief of Staff, while an
// explicit request to create or revise copy always gets the voice audit.

const REWRITE_REQUEST = /\b(?:rewrite|reword|de-?slop|polish|proofread|shorten|lengthen)\b/i;
const DRAFT_REQUEST = /\b(?:draft|write|edit)\b/i;
const COPY_TARGET = /\b(?:text|sms|email|message|subject(?: line)?|caption|ad(?: copy)?|website copy|headline|follow-?up|copy|letter|note)\b/i;
const REQUESTS_COPY = /\b(?:what should (?:i|we) say|help (?:me|us) (?:say|reply)|reply to|respond to|i need (?:a|an)?\s*(?:text|sms|email|message|caption))\b/i;
const OPERATION_TARGET = /\b(?:appointment|calendar|workflow|automation|pipeline|tag|booking|payment|invoice|contact record|GHL)\b/i;
const SOFT_REWRITE = /\bmake (?:this|it|that)\s+(?:friendlier|warmer|more direct|shorter|longer)\b/i;
const FACTUAL_OR_OPERATIONS_REQUEST = /^(?:who|what|when|where|why|how)\b|\b(?:write off|business expense|client record|list of who|who is booked|booked this)\b/i;

export function routeAskAmariRequest({ message, previousMode } = {}) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "ask";

  // A revision such as "make it shorter" has no explicit copy noun, but its
  // immediately preceding response supplies the context.
  if (previousMode === "write" && /\b(?:make it|shorter|longer|warmer|friendlier|more direct|try again|another version|change (?:it|that))\b/i.test(text)) {
    return "write";
  }

  // Any named copy channel is unambiguous, even when the copy concerns an
  // appointment or workflow. Check this before operational nouns.
  if (COPY_TARGET.test(text) || REQUESTS_COPY.test(text) || SOFT_REWRITE.test(text)) return "write";

  // "Edit Maria's appointment" and "rewrite this workflow" modify business
  // objects; those belong to COS. Generic rewrite/draft language remains copy.
  if (OPERATION_TARGET.test(text) || FACTUAL_OR_OPERATIONS_REQUEST.test(text)) return "ask";
  if (REWRITE_REQUEST.test(text) || DRAFT_REQUEST.test(text)) return "write";

  // A bare "Text Maria..." is a drafting request; questions *about* texts
  // (for example, "what text did she receive?") do not match this position.
  if (/^(?:please\s+)?(?:text|email|message)\s+\S+/i.test(text)) return "write";

  return "ask";
}
