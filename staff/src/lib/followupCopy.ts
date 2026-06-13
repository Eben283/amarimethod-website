import type { PartnerProspect } from '../types/staff';

// ── Follow-up text variations (copy-paste, shown on the card) ─────────────────
// EDIT THESE FREELY — this file is the source of truth for the suggested texts.
// Garrett's voice: plain, warm, no marketing softeners. Built from his real SMS.
// DO NOT add "no pressure / just say the word / worth a quick call?" type filler
// (see memory feedback_copy_no_punchlines). {first} = contact first name.
//
// Keyed by industry for now; only golf is authored. Other industries return
// nothing (we'd rather show no texts than filler). Signal-specific sets (talked
// vs voicemail vs link-sent) are a later refinement.

const GOLF_FOLLOWUP: string[] = [
  "Hi {first}, following up from last week. I'd love to gift you a session to try the protocols. They're incredibly effective for the low back and hip pain golfers deal with. Feel free to call or text when you have time.",
  "Hi {first}, I'd still love to gift you a session to try the protocols. I teach golfers at-home work for low back and hip pain, and if you're interested we could talk about the partnership program. Feel free to call or text when you have time.",
  "Hi {first}, I teach golfers at-home protocols for low back and hip pain, and I'd love to gift you a session to try them. Feel free to call or text when you have time.",
];

export function suggestedTexts(p: PartnerProspect): string[] {
  const first = (p.firstName || p.fullName || '').trim().split(/\s+/)[0] || 'there';
  const fill = (s: string) => s.replace(/\{first\}/g, first);
  if (p.category === 'golf') return GOLF_FOLLOWUP.map(fill);
  return [];
}
