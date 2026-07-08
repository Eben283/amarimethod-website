// slop-lint.js — the objective floor under the voice engine.
//
// A JS port of the HARD tells from ops/scripts/slop-lint.sh (the shell script
// can't run in the Cloudflare Workers runtime — there's no bash). This covers only
// the binary bans: mechanical tells, the legal no-list, and Garrett's terminology
// no-list. These are yes/no, not judgment calls, so a regex is the right tool and
// makes them a hard guarantee. Tone, over-stripping, and "does it sound human" stay
// with the model auditor in voice-engine.js — regex can't judge those.
//
// mechanicalTells(text) -> [{ id, label }] ; empty array means clean.

const HARD_TELLS = [
  // Mechanical
  { id: "em-dash", label: "em/en dash — rewrite as two sentences or a comma", re: /—|–/ },
  { id: "semicolon", label: "semicolon in casual copy — break into sentences", re: /;/ },
  { id: "not-just", label: '"not just / isn\'t just / more than just" — banned construction', re: /not just|not only|isn'?t just|aren'?t just|more than just|isn'?t only/i },
  { id: "filler-adverb", label: "filler intensifier (really/genuinely/truly/honestly/deeply/simply/actually/incredibly)", re: /\b(really|genuinely|truly|honestly|deeply|simply|actually|incredibly)\b/i },
  { id: "stock-phrase", label: "stock AI/sales phrase", re: /circling back|just checking in|reach(ing)? out|i just wanted|no pressure|last chance|game.?changer|that'?s the part|changes everything|at the end of the day|that said|when it comes to|dive in|unlock|elevate|empower|seamless|robust/i },
  { id: "email-bot-opener", label: "email-bot opener (hope this finds you / wanted to reach out)", re: /hope this (email|message|note) finds you|hope (you'?re|you are|all is) (doing )?well|hope you'?re doing|wanted to reach out|wanted to connect|wanted to touch base/i },
  { id: "rhetorical-opener", label: "rhetorical ad-question opener (What if / Ever feel / Tired of / Ready to)", re: /(^|[.!?]\s+)(ever (feel|wonder|notice)|what if|tired of|ready to|imagine (if|how|a)|picture this|did you know)/i },

  // Garrett terminology no-list
  { id: "stretch", label: '"stretch" — Garrett refuses this word; use a protocol or movement', re: /\bstretch(es|ing)?\b/i },
  { id: "exercise", label: '"exercise" — not his word; he says "protocol"', re: /\bexercises?\b/i },

  // Legal no-list (active Board accusation — these framings are cited as evidence)
  { id: "legal-dr", label: "LEGAL: Dr./doctor framing for Garrett — BANNED", re: /\bdr\b\.?|\bdoctors?\b/i },
  { id: "legal-chiro", label: "LEGAL: chiropractic framing — BANNED", re: /chiropract(ic|or)|\bDC\b|spinal manipulation/i },
  { id: "legal-clinical", label: "LEGAL: treatment/clinical framing — Garrett teaches, he does not treat or diagnose", re: /\btreat(s|ing|ment|ed)?\b|\bpatients?\b|clinical|diagnos|\badjust(s|ing|ment)?\b|manipulat|\bcure\b/i },
  { id: "legal-massage", label: "LEGAL: massage-therapist framing — he is not a licensed/certified massage therapist", re: /massage therap|licen[cs]ed massage|certified massage|\bCMT\b/i },
];

export function mechanicalTells(text) {
  if (!text) return [];
  return HARD_TELLS.filter((t) => t.re.test(text)).map(({ id, label }) => ({ id, label }));
}

export function isMechanicallyClean(text) {
  return mechanicalTells(text).length === 0;
}
