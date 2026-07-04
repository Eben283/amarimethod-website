import type { PartnerProspect } from '../types/staff';

// ── Follow-up text variations (copy-paste, shown on the card) ─────────────────
// EDIT THESE FREELY — this file is the source of truth for the suggested texts.
// Garrett's voice, grounded in amari/strategy/garrett-voice-profile.md.
//
// VOICE RULES (learned the hard way over 2026-06-19, each one a real Eben correction):
//  1. Don't sound like AD COPY. Pain is fine said plainly (a coach's clients hit pain
//     that won't quit) — the enemy is slick pain-relief-commercial phrasing like
//     "sidelined by nagging pain". Read it aloud: a person, or a commercial?
//  2. NO manufactured "reason to work with them" / soft flattery ("you care so much
//     about how your clients move and feel"). Any invented reason reads as marketing.
//     A real person doesn't editorialize about loving your profession — they say who
//     they are, how they found you, and what they're offering. So we cut that line.
//  3. NO fake personalization (reciting researched facts to prove you looked them up:
//     "I know you're a family-run gym on Geary"). But an HONEST contact source is good
//     and disarming — "I came across your website" answers the cold-text question
//     "how'd you get my number". Gated below to contacts where we actually have a site.
//  4. Structure: who I am + how I found you + the work + the gift + ONE ask. Warm and
//     full, never clipped/staccato. No "Dr." (legal), no em dashes, no filler.
//  5. NO barter/partnership in the FIRST touch (the income, the referral, "hope you
//     refer clients"). That belongs in the after-they've-felt-the-work message.
//  6. One strong draft per segment.
// {first} = contact first name. {source} = the honest "how I found you" line (only when
// we have their website). trainer/golf/tennis/generic intentionally share one clean
// message; therapist + business differ where the value prop genuinely does.

const CLEAN =
  "Hi {first}, it's Garrett, a body alignment specialist here in SF. {source}I teach at-home protocols that bring the body back into balance, and they work fast, you feel it the first session. I'd love to gift you one so you can feel it yourself. Want me to send you the link?";

const GOLF_FOLLOWUP: string[] = [CLEAN];
const TRAINER_FOLLOWUP: string[] = [CLEAN];
const TENNIS_FOLLOWUP: string[] = [CLEAN];
const GENERIC_FOLLOWUP: string[] = [CLEAN];

// Therapists — the work pairs with talk therapy rather than competing. The "pairs with
// your work" note is relevant context, not flattery. (Do NOT use "the body keeps the
// score" — borrowed book line, fine on the postcard, not in 1:1 outreach.)
const THERAPIST_FOLLOWUP: string[] = [
  "Hi {first}, it's Garrett, a body alignment specialist here in SF. {source}I teach gentle at-home protocols that help the body settle and come back into balance, and it pairs really well with the work you do. I'd love to gift you a session so you can feel it yourself. Want me to send you the link?",
];

// Business / gym / studio — an org, not a person, so no {first}; ask for the right person.
const BUSINESS_FOLLOWUP: string[] = [
  "Hi! It's Garrett, a body alignment specialist here in SF. {source}I teach at-home protocols that bring the body back into balance, and they work fast, people feel it the first session. I'd love to gift one of your trainers a session to feel the work. Who's the best person to talk to about it?",
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
  // Honest contact source — only claim it when we actually have their website on file,
  // so it's never a generic false "from your website". Disarms "how'd you get my number".
  const source = (p.website && String(p.website).trim()) ? 'I came across your website and wanted to reach out. ' : '';
  const fill = (s: string) => s.replace(/\{first\}/g, first).replace(/\{source\}/g, source);
  const set = BY_CATEGORY[(p.category as string) || ''];
  return (set && set.length ? set : GENERIC_FOLLOWUP).map(fill);
}

// A real, sendable email address on file — NOT an *@amari-prospect.placeholder import stub.
export function hasUsableEmail(email?: string | null): boolean {
  const e = String(email || '').trim();
  return !!e && !/@amari-prospect\.placeholder$/i.test(e) && /^\S+@\S+\.\S+$/.test(e);
}

// A drafted, editable email for a contact we can only reach by email (no phone on file).
// Reuses the voice-approved suggested text as the body so text and email stay consistent,
// re-shaped for email: the SMS-style "Want me to send you the link?" close becomes a soft
// reply prompt, plus a "Garrett" sign-off. Returns null if we have no draft basis.
export function suggestedEmail(p: PartnerProspect): { subject: string; body: string } | null {
  const text = suggestedTexts(p)[0];
  if (!text) return null;
  const core = text.replace(/\s*Want me to send you the link\?\s*$/i, '').trim();
  return {
    subject: 'A gift session from Amari Method',
    body: `${core}\n\nIf you're open to it, just reply here and I'll send the details.\n\nGarrett`,
  };
}
