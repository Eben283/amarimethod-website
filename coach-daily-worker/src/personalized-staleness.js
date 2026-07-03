// Frozen-draft invalidation for the hand-authored `coach:personalized` set.
//
// `coach:personalized` cards are protected from the daily templated/angle-ladder
// reconciliation — the protection was right when they were fresh, but nothing
// invalidated them, so stale drafts (already-sent copy, wrong-person greetings,
// re-pitches to contacts who declined) stayed live and un-fixable. This module
// decides, per card, whether the facts have moved past the draft since it was
// authored. If so, the card loses protection this run (the templated/ladder path
// regenerates it) and is retired to an archive so it can't re-protect next run.
//
// See ops/docs/2026-07-03-frozen-draft-invalidation-spec.md.
//
// Every trigger is a cheap comparison on data already in KV — no LLM calls:
//   1. acted-on          — an OUTBOUND touch in conv:{id} after generatedAt.
//   2. replied           — an INBOUND touch in conv:{id} after generatedAt.
//   3. decline           — call-coach:latest:{id} holdState is cool-off/close-loop.
//   4. greeting-mismatch — the message's "Hi <Name>," greets someone other than
//                          the contact's current firstName (with a nickname guard).

// Normalize a timestamp to epoch millis. conv:{id} touches store `ts` as an
// epoch-millis NUMBER (e.g. 1782253347048); generatedAt is an ISO/date STRING
// (e.g. "2026-06-14" or "2026-06-20T19:34:07.901Z"). Date.parse() returns NaN on
// a number, so both forms must be handled explicitly — otherwise the acted-on /
// replied comparisons silently never fire. Returns NaN for unusable input.
export function toMillis(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d{10,}$/.test(s)) return Number(s); // epoch-like numeric string
  return Date.parse(s);
}

// R2: generatedAt is often DATE-ONLY ("2026-06-14"), which toMillis floors to
// UTC midnight. A touch earlier that same authoring day — or a prior-evening
// PACIFIC touch (UTC midnight is 5pm PT the day before) — would then falsely
// count as "after generatedAt". Require the touch to land after the END of the
// authoring day (next-day UTC boundary) before it invalidates.
const DAY_MS = 86_400_000;

// Common first-name ↔ nickname pairs. A pure prefix check (as the design sketch
// suggested) is not enough on its own: "Mike" is not a prefix of "Michael" (they
// diverge at the 3rd char), nor "Tom" of "Thomas". Rob/Robert IS a true prefix,
// but Mike/Michael and Tom/Thomas need this lookup. Keyed canonical → nicknames;
// matching is bidirectional and case-insensitive.
const NICKNAMES = {
  michael: ["mike", "mikey", "mick", "micky"],
  robert: ["rob", "robbie", "bob", "bobby", "bert"],
  thomas: ["tom", "tommy"],
  william: ["will", "bill", "billy", "willy", "liam"],
  richard: ["rich", "rick", "ricky", "dick", "richie"],
  james: ["jim", "jimmy", "jamie"],
  john: ["johnny", "jack"],
  charles: ["charlie", "chuck", "chas"],
  joseph: ["joe", "joey"],
  daniel: ["dan", "danny"],
  matthew: ["matt", "matty"],
  christopher: ["chris", "topher"],
  david: ["dave", "davey"],
  edward: ["ed", "eddie", "ted", "teddy", "ned"],
  anthony: ["tony"],
  nicholas: ["nick", "nicky"],
  benjamin: ["ben", "benny"],
  samuel: ["sam", "sammy"],
  alexander: ["alex", "al", "xander"],
  andrew: ["andy", "drew"],
  stephen: ["steve", "stevie"],
  steven: ["steve", "stevie"],
  kenneth: ["ken", "kenny"],
  ronald: ["ron", "ronnie"],
  donald: ["don", "donnie", "donny"],
  timothy: ["tim", "timmy"],
  jeffrey: ["jeff"],
  gregory: ["greg"],
  jonathan: ["jon", "jonny", "nathan"],
  patrick: ["pat", "paddy"],
  gerald: ["gerry", "jerry"],
  frederick: ["fred", "freddie"],
  lawrence: ["larry"],
  raymond: ["ray"],
  eugene: ["gene"],
  theodore: ["ted", "teddy", "theo"],
  albert: ["al", "bert"],
  vincent: ["vince", "vinny"],
  francis: ["frank", "frankie"],
  peter: ["pete"],
  philip: ["phil"],
  phillip: ["phil"],
  douglas: ["doug"],
  zachary: ["zach", "zack"],
  joshua: ["josh"],
  nathaniel: ["nate", "nathan"],
  elizabeth: ["liz", "lizzie", "beth", "betsy", "eliza", "libby"],
  jennifer: ["jen", "jenny", "jenn"],
  katherine: ["kate", "katie", "kathy", "kat", "katy"],
  catherine: ["cathy", "kate", "katie", "cat"],
  margaret: ["maggie", "meg", "peggy", "marge"],
  patricia: ["pat", "patty", "trish", "tricia"],
  rebecca: ["becky", "becca", "bex"],
  deborah: ["deb", "debbie", "debby"],
  susan: ["sue", "susie", "suzie"],
  barbara: ["barb", "babs"],
  victoria: ["vicky", "vic", "tori"],
  christina: ["chris", "chrissy", "tina"],
  christine: ["chris", "chrissy", "tina"],
  samantha: ["sam", "sammy"],
  jessica: ["jess", "jessie"],
  amanda: ["mandy"],
  stephanie: ["steph", "steffi"],
  michelle: ["shelly", "mich"],
  nicole: ["nikki", "nic"],
  alexandra: ["alex", "sandra", "sandy", "lexi"],
  gabrielle: ["gabby", "gabe"],
  danielle: ["dani"],
  cassandra: ["cassie", "cass"],
  vanessa: ["nessa"],
  angela: ["angie"],
};

// Fast reverse lookup: nickname/canonical → its canonical key.
const NICK_TO_CANON = (() => {
  const map = new Map();
  for (const [canon, nicks] of Object.entries(NICKNAMES)) {
    map.set(canon, canon);
    for (const n of nicks) map.set(n, canon);
  }
  return map;
})();

// True when `a` and `b` are plausibly the same person's name: equal, a true
// prefix of one another (min length 3 — so "TJ" never matches "Tyler"), or a
// known nickname pair mapping to the same canonical name.
export function namesMatch(a, b) {
  if (!a || !b) return false;
  const x = String(a).trim().toLowerCase();
  const y = String(b).trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;

  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.length >= 3 && longer.startsWith(shorter)) return true;

  const cx = NICK_TO_CANON.get(x);
  const cy = NICK_TO_CANON.get(y);
  if (cx && cy && cx === cy) return true;

  // R5: a 2-char nickname on the losing side of a NICK_TO_CANON collision (e.g.
  // "al" resolves to albert, so it wouldn't nickname-match "alexander") would
  // otherwise falsely mismatch. If the short greeting is a KNOWN nickname AND a
  // prefix of the longer name, treat it as a match — conservative (only fires
  // for recognized 2-char nicks that prefix the full name; "tj" is unknown so
  // it still correctly mismatches "tyler").
  if (shorter.length === 2 && NICK_TO_CANON.has(shorter) && longer.startsWith(shorter)) return true;

  return false;
}

// Parse the greeting name from a message's "Hi/Hey/Hello <Name>,". Matches the
// greeting at the start of the message OR right after a coaching preamble
// separator (a colon, newline, or asterisk) — real drafts sometimes open with
// an instruction like "When you reach her: Hi Dana, ...". Anchoring to
// start/separator avoids false-matching a "hi" mid-sentence. Returns the raw
// name token, or null if there is no recognizable greeting. Deliberately reads
// the MESSAGE body, never the card's `name` label field (which may be a note
// like "Brian (Chad's referral)").
const GREETING_RE = /(?:^|[:\n*]\s*)(?:hi|hey|hello)\s+([A-Za-z][A-Za-z'-]*)/i;
// R3: generic salutation openers ("Hi there,", "Hey team,", "Hello all,") are
// NOT names — treating "there"/"team"/"all" as the greeting name would falsely
// mismatch every firstName. Return null for these so rule 4 stays quiet on a
// non-personal greeting.
const GREETING_STOPWORDS = new Set([
  "there", "all", "everyone", "team", "friend", "friends", "folks", "coach",
  "y'all", "yall", "guys", "hey", "hi", "hello", "again", "you",
]);
export function parseGreetingName(message) {
  if (!message || typeof message !== "string") return null;
  const m = message.match(GREETING_RE);
  if (!m) return null;
  const name = m[1];
  if (GREETING_STOPWORDS.has(name.toLowerCase())) return null;
  return name;
}

// True when the message greets a clearly different person than the contact's
// current firstName. Returns false (no mismatch) when we can't tell: no
// greeting, no firstName on file, or the two names are a nickname/prefix pair.
export function greetingMismatch(message, firstName) {
  const greet = parseGreetingName(message);
  if (!greet || !firstName) return false;
  return !namesMatch(greet, firstName);
}

// Decide whether a protected personalized card has been overtaken by events.
// Pure — the caller supplies the already-fetched conv dossier and call-coach
// record. Returns { stale, reason } where reason is one of
// 'acted-on' | 'replied' | 'decline' | 'greeting-mismatch' | null.
//
// Conservative by construction: it only invalidates on a concrete, observable
// change since authoring, never on a timer. A month-old draft with no activity
// and a correct greeting stays protected.
export function personalizedStaleReason(card, conv, callCoach) {
  const gen = toMillis(card && card.generatedAt);
  const touches = (conv && Array.isArray(conv.touches) && conv.touches) || [];

  // Rules 1 & 2 need a parseable authoring date to compare against. The touch
  // must land after the END of the authoring day (gen + DAY_MS) — see R2 above —
  // so a same-day or prior-evening-Pacific touch doesn't falsely invalidate.
  if (!Number.isNaN(gen)) {
    const cutoff = gen + DAY_MS;
    // Rule 1 — acted-on: something went out after the draft was written, so the
    // draft (a proposed send) is now history.
    if (touches.some((t) => t && t.dir === "out" && toMillis(t.ts) >= cutoff)) {
      return { stale: true, reason: "acted-on" };
    }
    // Rule 2 — overtaken by a reply: the thread moved; a pre-reply draft answers
    // a conversation that no longer exists.
    if (touches.some((t) => t && t.dir === "in" && toMillis(t.ts) >= cutoff)) {
      return { stale: true, reason: "replied" };
    }
  }

  // Rule 3 — disposition changed: a decline/close landed; a re-pitch must not
  // survive it.
  if (callCoach && (callCoach.holdState === "cool-off" || callCoach.holdState === "close-loop")) {
    return { stale: true, reason: "decline" };
  }

  // Rule 4 — greeting mismatch (with nickname guard).
  if (greetingMismatch(card && card.message, conv && conv.firstName)) {
    return { stale: true, reason: "greeting-mismatch" };
  }

  return { stale: false, reason: null };
}
