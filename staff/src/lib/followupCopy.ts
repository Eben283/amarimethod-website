import type { PartnerProspect } from '../types/staff';

// ── Follow-up text variations (copy-paste, shown on the card) ─────────────────
// EDIT THESE FREELY — this file is the source of truth for the suggested texts.
// Garrett's voice, grounded in amari/strategy/garrett-voice-profile.md.
//
// VOICE RULES (learned the hard way, 2026-06-19):
//  1. NEVER lead by agitating the prospect's pain ("sidelined by nagging pain",
//     "clients out of pain"). That reads as an Advil ad AND fights Garrett's
//     philosophy (pain = out of balance, not a thing to poke and relieve). Lead
//     with warmth + the felt result, never with their pain.
//  2. State the REAL reason it's free: the barter. We gift the session because we
//     partner with trainers/coaches/therapists and hope they refer clients to us.
//     Honest beats a vague "I want you to have a breakthrough" gloss. But do NOT
//     pitch the partnership MECHANICS here (income, 100% of first $225, incentive)
//     — that waits for the after-they've-felt-it text.
//  3. One ask only (the gift session). Warmth and "you feel it right away" /
//     "breakthrough that first time" carry the conversion, not pressure.
//  4. No "Dr." (legal). No em dashes. No "following up / no pressure / just say the
//     word / worth a quick call?" filler. Warm and full, never clipped.
//  5. One strong draft per segment beats three near-identical ones (the sameness
//     is what makes a list feel templated).
// {first} = contact first name. These are the RE-ENGAGEMENT scripts. The immediate
// post-call texts (VM + text / Talked + text) live in FollowUpPage.tsx. The richer
// PERSONALIZED layer (references the real last call + their actual gym) is a
// separate job — these statics are the fallback when there's no such context.

const GOLF_FOLLOWUP: string[] = [
  "Hi {first}, it's Garrett, a body alignment specialist here in SF! I love working with golf coaches, the swing asks so much of the body. I teach at-home protocols that bring it back into balance, and they're incredibly effective, you feel it right away. I gift coaches a session because I partner with coaches across the city, and my hope is you'll feel the work yourself and have students you'd want to refer my way. Want me to send you the link?",
];

const TRAINER_FOLLOWUP: string[] = [
  "Hi {first}, it's Garrett, a body alignment specialist here in SF! I love working with trainers, you care so much about how your clients move and feel. I teach at-home protocols that bring the body back into balance, and they're incredibly effective, you feel it right away. I gift trainers a session because I partner with trainers across the city, and my hope is you'll feel the work yourself and have clients you'd want to refer my way. Want me to send you the link?",
];

const TENNIS_FOLLOWUP: string[] = [
  "Hi {first}, it's Garrett, a body alignment specialist here in SF! I love working with tennis coaches, the game asks so much of the body. I teach at-home protocols that bring it back into balance, including an elbow reset people love, and they're incredibly effective, you feel it right away. I gift coaches a session because I partner with coaches across the city, and my hope is you'll feel the work yourself and have players you'd want to refer my way. Want me to send you the link?",
];

// Business / gym / studio — an org, not a person, so no {first}; ask for the
// right person.
const BUSINESS_FOLLOWUP: string[] = [
  "Hi! It's Garrett, a body alignment specialist here in SF. I love connecting with gyms and studios, you do so much to keep people moving and feeling good. I teach at-home protocols that bring the body back into balance, and they're incredibly effective, people feel it right away. I partner with gyms across the city, and I'd love to gift one of your trainers a session so they can feel the work firsthand, my hope is we can help keep your members feeling their best. Who's the best person to talk to about it?",
];

// Therapists — the somatic angle (the body holds what we move through, and this
// work helps it settle). Pairs with talk therapy rather than competing with it.
// NOTE: do NOT use "the body keeps the score" in a 1:1 text — it's a borrowed book
// line. Fine on the evergreen postcard, not in direct outreach.
const THERAPIST_FOLLOWUP: string[] = [
  "Hi {first}, it's Garrett, a body alignment specialist here in SF! I love connecting with therapists, the body holds so much of what we move through, and this work pairs beautifully with what you do. I teach gentle at-home protocols that help the body settle and come back into balance, and they're incredibly effective, you feel it right away. I gift therapists a session because I partner with therapists across the city, and my hope is you'll feel the work yourself and have clients you'd want to refer my way. Want me to send you the link?",
];

// Generic fallback for an uncovered/unknown category — so a "text" card ALWAYS has
// a real draft to send (never a dead-end). Warm, gift-led, barter reason, no slop.
const GENERIC_FOLLOWUP: string[] = [
  "Hi {first}, it's Garrett, a body alignment specialist here in SF! I'd love for you to experience this work. I teach at-home protocols that bring the body back into balance, and they're incredibly effective, you feel it right away. I gift a session because my hope is you'll feel the work yourself and have people you'd want to refer my way. Want me to send you the link?",
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
