// The card brain — ONE deterministic pass that decides the truth about a contact
// from the live facts, so a card can never contradict itself.
//
// The old system stitched four stale snapshots together (a frozen LLM coach card,
// a 3h cadence snapshot, a live line-type check, a live play decision) and let them
// override each other in the display — so "engaged", "channel", and "last touch"
// were guesses from different moments that disagreed with reality (Jack shown "warm
// reconnect" when he never replied; Ramy shown "text" on a landline).
//
// Here, every field is COMPUTED from the same dossier. No LLM, no freezing. The LLM's
// only job is the outreach copy (see draftMessage), and it receives these facts as
// locked constraints — it dresses the truth, it doesn't decide it.

// ── what counts as a real human reply ───────────────────────────────────────
// An inbound message only means "they reached back" if it's an actual human message.
// Automated codes, email reply-delimiter artifacts, and empty bodies are not replies.
// (Mirror of staff-conversations.isNonReply; kept local so the brain is self-contained.)
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

// A call is a confirmed CONNECT (a real conversation) if it has a transcript, or it
// ran long enough that it can't plausibly be a missed-call / short voicemail. A bare
// short duration is NOT proof of a talk (it can be ring time or a brief voicemail).
const CONNECT_CALL_SEC = 120;
function isConnectedCall(m) {
  if (m.type !== "CALL") return false;
  if (m.hasTranscript) return true;
  return (Number(m.callDuration) || 0) >= CONNECT_CALL_SEC;
}

// They REACHED BACK: an inbound text/email with real content, or an inbound call.
function isReachBack(m) {
  if (m.direction !== "inbound") return false;
  if (m.type === "CALL") return true;          // they called us
  return !isNonReply(m.body);                  // a real human text/email
}

const ORG_WORDS = /^(the|a|an|fit|fitness|gym|gyms|studio|club|performance|training|strength|crossfit|pilates|yoga|wellness|raise|punch|pure|tribe|local|bar|house|lab|co|sf|llc|inc|method|works|bodyworks|culture)$/i;
function isPersonName(firstName, lastName, fullName) {
  const name = (fullName || `${firstName || ""} ${lastName || ""}`).trim();
  const toks = name.split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length >= 3) return false;     // 3+ tokens reads as a business
  if (toks.some((t) => ORG_WORDS.test(t))) return false;  // contains an org word
  return /^[A-Z][a-z]+$/i.test(toks[0]);                  // a given-name first token
}

const UNTEXTABLE = new Set(["landline", "toll_free", "voip"]);

// ── phone provenance: is the number on file real, or just import research? ──
// LinkedIn/CSV imports get a placeholder email (see ops/scripts/import-prospects.mjs)
// and their phone is UNVERIFIED research — dialing it cold sent Garrett to a wrong
// number (2026-07-02). Until someone verifies the contact (outreach_verified /
// trainer-solo / dm-verified, spec §2) or the number PROVES itself by engagement
// (an inbound text/call, or a 120s+ connected call — it demonstrably reaches them),
// the card must route to LinkedIn, never to the number.
const PLACEHOLDER_EMAIL_RE = /@amari-prospect\.placeholder$/i;
const LINKEDIN_SOURCE_RE = /linkedin/i;
const PHONE_UNVERIFIED_NOTE = "phone unverified, from import research, not confirmed";

// The number is de-facto verified when engagement happened ON it: they texted back
// (a real reply, not an OTP/artifact), they called us, or a call connected for real.
// An EMAIL reply proves the person, not the phone — it does NOT count.
function provesPhone(m) {
  if (m.direction === "inbound") {
    if (m.type === "CALL") return true;              // they called from the number
    return m.type === "SMS" && !isNonReply(m.body);  // a real text reply landed on it
  }
  return isConnectedCall(m);                         // we talked to a human on it
}

// 'verified' (explicit flag/tag) > 'proven' (engagement on the number) >
// 'unverified' (import research, never touch it) > 'on-file' (normal contact).
function phoneProvenanceOf(d, thread) {
  if (d.outreachVerified || d.dmVerified || d.isSolo) return "verified";
  if (thread.some(provesPhone)) return "proven";
  const imported = PLACEHOLDER_EMAIL_RE.test(d.email || "") || LINKEDIN_SOURCE_RE.test(d.source || "");
  return imported ? "unverified" : "on-file";
}
const DAY_MS = 86_400_000;
function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  // Calendar-day difference, so a late-yesterday touch reads "yesterday", not "today".
  // (UTC days; fine for the day-label — swap to Pacific if exactness ever matters.)
  const dayStart = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  return Math.max(0, Math.round((dayStart(now) - dayStart(t)) / DAY_MS));
}
function agoLabel(d) {
  if (d === null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

/**
 * buildCard — compute the one true view of a contact from its dossier.
 *
 * dossier = {
 *   firstName, lastName, fullName, role, business, lineType, rundown,
 *   email, source,                        // provenance signals (placeholder / LinkedIn import)
 *   outreachVerified, dmVerified, isSolo, // verification overrides (spec §2)
 *   thread: [{ direction:'inbound'|'outbound', type:'SMS'|'CALL'|'EMAIL',
 *              body, callDuration, hasTranscript, date }],
 * }
 * `now` is injectable for deterministic tests.
 */
export function buildCard(dossier, now = Date.now()) {
  const d = dossier || {};
  const thread = [...(d.thread || [])]
    .filter((m) => m && m.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const last = thread[thread.length - 1] || null;
  const lastTouch = last ? last.date : null;
  const lastTouchDays = daysSince(lastTouch, now);

  // ── engagement state, in order of certainty ──
  const reachBacks = thread.filter(isReachBack);
  const connects = thread.filter(isConnectedCall);
  const lastReachBack = reachBacks[reachBacks.length - 1] || null;
  const lastConnect = connects[connects.length - 1] || null;

  // 'engaged' (they reached back) | 'talked' (we connected recently, no reach-back) | 'cold'.
  // "talked" is gated on recency: an OLD connect with newer failed attempts (Jack — an April
  // call, then June voicemails + no-answer) reads cold, not "you spoke, follow up".
  const TALKED_RECENT_DAYS = 14;
  const lastConnectDays = lastConnect ? daysSince(lastConnect.date, now) : null;
  let state;
  if (lastReachBack) state = "engaged";
  else if (lastConnect && lastConnectDays !== null && lastConnectDays <= TALKED_RECENT_DAYS) state = "talked";
  else state = "cold";
  const engaged = state === "engaged";

  // ── channel: provenance first, then line type ──
  // An unverified import number is never dialed OR texted — line type is irrelevant
  // when the number itself is research. Route to LinkedIn (spec §3: LinkedIn-sourced
  // contacts are reached on LinkedIn, never on the phone on file).
  const phoneProvenance = phoneProvenanceOf(d, thread);
  const phoneUnverified = phoneProvenance === "unverified";
  const channel = phoneUnverified ? "linkedin" : UNTEXTABLE.has(d.lineType) ? "call" : "text";

  // ── play: pitch when we can reach the right person directly; else discovery ──
  // PITCH = a named owner (their place — call the line), OR a named person on a personal
  // line (mobile/unknown — we reach THEM), OR a solo trainer (they ARE the decision-maker
  // regardless of what line type their GHL record has). DISCOVERY = we can't reach the
  // right person: an org-name contact, or a named non-owner whose number is a facility
  // switchboard (landline/VoIP front desk), where we must call and ask who handles
  // partnerships.
  const named = isPersonName(d.firstName, d.lastName, d.fullName);
  const ownerRole = /owner|sole|principal|founder/i.test(d.role || "");
  const reachableLine = !d.lineType || d.lineType === "mobile" || d.lineType === "unknown";
  const play = (named && (ownerRole || reachableLine || d.isSolo)) ? "pitch" : "discovery";

  // ── the headline writes itself from the facts (action-first, never contradictory) ──
  const name = (d.firstName || (d.fullName || "").split(/\s+/)[0] || "there").trim();
  const verb = channel === "call" ? "Call" : channel === "linkedin" ? "Message" : "Text";
  // Engagement wins over the play: if they reached back or we just talked, respond to THAT
  // person — discovery (find the decision-maker) only applies to a COLD facility where no one
  // has engaged and we don't know who to reach.
  let why;
  if (state === "engaged") {
    const back = lastReachBack.type === "CALL" ? "called back" : "replied";
    why = `${verb} ${name} back, they ${back} ${agoLabel(daysSince(lastReachBack.date, now))}. Pick the thread up.`;
    // Engaged by EMAIL with an unverified import number: the person is real, the
    // number still isn't. Say where to reach them and why the phone stays off-limits.
    if (phoneUnverified) why += ` (Reach them on LinkedIn, the number on file is unverified import research.)`;
  } else if (state === "talked") {
    why = `${verb} ${name} back, you spoke ${agoLabel(daysSince(lastConnect.date, now))} but no follow-up since.`;
  } else if (phoneUnverified) {
    // Before discovery on purpose: a discovery card says "call and ask", and the
    // number on file is exactly the thing we don't trust here.
    why = `Reach ${name} on LinkedIn. The number on file came from import research and was never verified, don't dial or text it.`;
  } else if (play === "discovery") {
    why = `Call and ask who handles partnerships, then get a name. It's a facility and we don't know the decision-maker yet.`;
  } else {
    why = lastTouchDays === null
      ? `${verb} ${name}, first outreach.`
      : `${verb} ${name} again, no response yet (last tried ${agoLabel(lastTouchDays)}).`;
  }
  if (channel === "call" && play === "pitch" && UNTEXTABLE.has(d.lineType)) {
    why += ` (Number is a ${d.lineType.replace("_", "-")}, so call, a text won't reach it.)`;
  }

  return {
    state,
    engaged,
    channel,
    play,
    lastTouch,
    lastTouchDays,
    why,
    // structured facts handed to the draft LLM as locked constraints
    facts: {
      name,
      role: d.role || null,
      business: d.business || null,
      lineType: d.lineType || null,
      rundown: d.rundown || null,
      hasReachBack: !!lastReachBack,
      lastReachBack: lastReachBack ? { type: lastReachBack.type, body: lastReachBack.body || null, daysAgo: daysSince(lastReachBack.date, now) } : null,
      lastConnect: lastConnect ? { daysAgo: daysSince(lastConnect.date, now), hasTranscript: !!lastConnect.hasTranscript } : null,
      outboundOnly: reachBacks.length === 0,
      lastTouchDays,
      // Phone provenance for the honesty layer: 'verified' | 'proven' | 'unverified'
      // | 'on-file'. phoneNote is the ready-made "what we don't know" footnote line
      // when the number is unverified import research.
      phoneProvenance,
      phoneNote: phoneUnverified ? PHONE_UNVERIFIED_NOTE : null,
    },
  };
}
