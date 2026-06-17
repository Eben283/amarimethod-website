import type { PartnerProspect } from '../types/staff';

// ── Follow-up text variations (copy-paste, shown on the card) ─────────────────
// EDIT THESE FREELY — this file is the source of truth for the suggested texts.
// Garrett's voice: plain, warm, no marketing softeners. Built from his real SMS.
// DO NOT add "no pressure / just say the word / worth a quick call?" type filler
// (see memory feedback_copy_no_punchlines). No em dashes (Eben's no-dash rule).
// {first} = contact first name. These are the RE-ENGAGEMENT scripts (the warm,
// fuller text). The immediate post-call texts (VM + text / Talked + text) are
// logistics and live in FollowUpPage.tsx, not here.

const GOLF_FOLLOWUP: string[] = [
  "Hi {first}, following up from last week. I'd love to gift you a session to try the protocols. They're incredibly effective for the low back and hip pain golfers deal with. Feel free to call or text when you have time.",
  "Hi {first}, I'd still love to gift you a session to try the protocols. I teach golfers at-home work for low back and hip pain, and if you're interested we could talk about the partnership program. Feel free to call or text when you have time.",
  "Hi {first}, I teach golfers at-home protocols for low back and hip pain, and I'd love to gift you a session to try them. Feel free to call or text when you have time.",
];

const TRAINER_FOLLOWUP: string[] = [
  "Hi {first}, following up. I teach personal trainers at-home protocols that keep their clients out of pain and training longer. I'd love to gift you a session to feel the work yourself. Feel free to call or text when you have time.",
  "Hi {first}, I'd still love to gift you a session to try the protocols. They're incredibly effective for the low back and joint pain your clients deal with, and if you're inspired we could talk about the partnership program. Feel free to call or text when you have time.",
  "Hi {first}, I partner with trainers to keep their clients pain free, and there's a nice referral incentive for you too. I'd love to gift you a session to try it. Feel free to call or text when you have time.",
];

const TENNIS_FOLLOWUP: string[] = [
  "Hi {first}, following up. I teach tennis players and coaches at-home protocols that are incredibly effective for tennis elbow, shoulder, and low back. I'd love to gift you a session to try them. Feel free to call or text when you have time.",
  "Hi {first}, I'd still love to gift you a session. I teach an elbow reset that clears tennis elbow, plus work for the shoulder and low back, and if you're interested we could talk about the partnership program. Feel free to call or text when you have time.",
  "Hi {first}, I partner with tennis instructors to keep their players off the bench. I'd love to gift you a session to feel the work. Feel free to call or text when you have time.",
];

// Business / gym / studio — an org, not a person, so no {first}; ask for the
// right person.
const BUSINESS_FOLLOWUP: string[] = [
  "Hi, following up. I teach at-home protocols that keep clients out of pain, and I partner with gyms to help keep members training pain free. I'd love to gift one of your trainers a session to feel the work. Who's the best person to talk to about it?",
  "Hi, I'd still love to set up a session for someone on your team to try the protocols. We partner with gyms and studios to keep members healthy and training longer, with a nice incentive for you. Who's the best person to talk to about it?",
];

// Therapists — the somatic angle (stress and strain settling into the body, and
// helping it release). Pairs with talk therapy rather than competing with it.
// NOTE: do NOT use "the body keeps the score" in a 1:1 text or voicemail — it's a
// borrowed book line. Fine on the evergreen postcard, not in direct outreach.
const THERAPIST_FOLLOWUP: string[] = [
  "Hi {first}, following up. So much of what your clients carry shows up in the body, the stress, the strain, the old injury. I teach at-home protocols that help the body settle and reorganize, a real complement to the work you do. I'd love to gift you a session to feel it yourself. Feel free to call or text when you have time.",
  "Hi {first}, I'd still love to gift you a session. So much stress and strain settles into the body and stays there, and I teach gentle at-home protocols that help it release. It pairs really well with the work you do, and if you're interested we could talk about partnering. Feel free to call or text when you have time.",
  "Hi {first}, I partner with therapists because the body holds so much of what we work through. I'd love to gift you a session to experience the protocols yourself. Feel free to call or text when you have time.",
];

// Generic fallback for an uncovered/unknown category — so a "text" card ALWAYS has
// a real draft to send (never a dead-end). Plain, gift-led, no slop, no dashes.
const GENERIC_FOLLOWUP: string[] = [
  "Hi {first}, following up. I teach at-home protocols that are incredibly effective for low back and joint pain. I'd love to gift you a session so you can feel the work for yourself. Feel free to call or text when you have time.",
  "Hi {first}, I'd still love to gift you a session to try the protocols. They clear the kind of pain that gets in the way of training and moving well. Feel free to call or text when you have time.",
];

const BY_CATEGORY: Record<string, string[]> = {
  golf: GOLF_FOLLOWUP,
  trainer: TRAINER_FOLLOWUP,
  tennis: TENNIS_FOLLOWUP,
  business: BUSINESS_FOLLOWUP,
  therapist: THERAPIST_FOLLOWUP,
};

export function suggestedTexts(p: PartnerProspect): string[] {
  // Greeting guard: an org's brand token often sits in the firstName field
  // ("PURE", "Punch", "Tribe", "mx3", "Local's", "The Culture") → "Hi PURE,". Only
  // greet by a token that looks like a real first name; otherwise use "there".
  const tok = (p.firstName || p.fullName || '').trim().split(/\s+/)[0] || '';
  const ORG_WORDS = /^(the|a|an|fit|fitness|gym|studio|club|performance|training|strength|crossfit|pilates|yoga|wellness|raise|punch|pure|tribe|local|bar|house|lab|co|sf|llc|inc|method|works|bodyworks|culture)$/i;
  const first = (/^[A-Z][a-z]+$/.test(tok) && !ORG_WORDS.test(tok)) ? tok : 'there';
  const fill = (s: string) => s.replace(/\{first\}/g, first);
  const set = BY_CATEGORY[(p.category as string) || ''];
  return (set && set.length ? set : GENERIC_FOLLOWUP).map(fill);
}
