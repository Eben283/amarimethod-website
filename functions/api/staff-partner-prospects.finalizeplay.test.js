import { describe, it, expect } from 'vitest';
import { finalizePlay, manualTouchIsFresherThanCadence, overlayCard } from './staff-partner-prospects.js';
import { buildCard } from '../lib/build-card.js';

describe('manualTouchIsFresherThanCadence — a just-marked touch beats the stale cadence', () => {
  const M = manualTouchIsFresherThanCadence;
  it('returns true when a texted touch is newer than the cadence last touch', () => {
    expect(M('texted', '2026-06-20', '2026-05-30T10:00:00Z')).toBe(true);
  });
  it('returns true for a same-day touch (date-only field, cadence ran earlier the same day)', () => {
    // partner_last_signal_at is a GHL DATE field → no time → must compare by date.
    expect(M('texted', '2026-06-20', '2026-06-20T18:00:00Z')).toBe(true);
  });
  it('returns true for a chip outcome (talked/voicemail) with no cadence touch on file', () => {
    expect(M('talked', '2026-06-20', null)).toBe(true);
    expect(M('voicemail', '2026-06-20', undefined)).toBe(true);
  });
  it('returns false when the manual touch is OLDER than the cadence already knows', () => {
    expect(M('texted', '2026-06-18', '2026-06-20T09:00:00Z')).toBe(false);
  });
  it('returns false for non-touch signals (stage changes are handled by the stage gate)', () => {
    expect(M('not-interested', '2026-06-20', null)).toBe(false);
    expect(M('booked', '2026-06-20', null)).toBe(false);
    expect(M('note', '2026-06-20', null)).toBe(false);
  });
  it('returns false when there is no signal date', () => {
    expect(M('texted', null, '2026-06-20T09:00:00Z')).toBe(false);
    expect(M(undefined, undefined, undefined)).toBe(false);
  });
});

// Build a facility prospect with an actionable card. Defaults make it discovery-eligible
// (facility tag, unverified, not engaged) so each test isolates the owner-detection logic.
const card = (over = {}) => ({
  derived: { kind: 'act', action: 'text', channel: 'text', warmth: 0, urgency: 50, why: 'x' },
  firstName: '', lastName: '', fullName: '',
  tags: ['trainer-facility'], category: 'business',
  partnerFacilityRole: '', rundown: '', phoneType: null, hasPtOnStaff: null,
  outreachVerified: false,
  ...over,
});

describe('finalizePlay — discovery vs known decision-maker', () => {
  // ── must STAY discovery (the safe default; a wrong pitch is the harm) ──
  it('keeps Amanda (Manager, no rundown) on a discovery card', () => {
    // The canonical case: a non-owner role at a facility, decision-maker unknown.
    expect(finalizePlay(card({ firstName: 'amanda', partnerFacilityRole: 'Manager' })).action)
      .toBe('discovery');
  });

  it('keeps an employee ("Trainer at Stanford Golf Course") on discovery', () => {
    expect(finalizePlay(card({
      firstName: 'james', lastName: 'anderson', partnerFacilityRole: 'Trainer',
      rundown: 'Trainer at Stanford Golf Course (tier-A Peninsula golf course).',
    })).action).toBe('discovery');
  });

  it('does NOT mistake a business whose name starts like a first name for an owner', () => {
    // "Alex Fitness" — the rundown describes the BUSINESS, not a person named Alex.
    // The ownership verb ("family-owned") is not anchored to the contact's first name.
    expect(finalizePlay(card({
      firstName: 'alex', lastName: 'fitness', partnerFacilityRole: 'Other',
      rundown: 'Castro Fitness (formerly Alex Fitness) is a family-owned, full-service fitness center.',
    })).action).toBe('discovery');
  });

  it('does NOT flip an org name even when its auto-role contains "owner"', () => {
    // "Revel Training Club" / "Advanced Wellness" — the role field says owner, but the NAME
    // is a business, not a person. We want to find the actual owner (e.g. "founded by Jess
    // Hess"), so these must stay discovery, not become a pitch to the business name.
    expect(finalizePlay(card({
      fullName: 'revel training club', partnerFacilityRole: 'Studio (org-level owner)',
      rundown: 'Revel Training Club is a fitness studio founded by Jess Hess, offering personal training.',
    })).action).toBe('discovery');
    expect(finalizePlay(card({
      fullName: 'advanced wellness', partnerFacilityRole: 'Studio (org-level owner)',
      rundown: 'Advanced Wellness — Premier SF performance training studio at 523 Clement.',
    })).action).toBe('discovery');
    expect(finalizePlay(card({
      fullName: 'ca sculpt pilates', partnerFacilityRole: 'Studio (org-level owner)',
      rundown: 'CA Sculpt Pilates studio founded 2024, San Mateo base.',
    })).action).toBe('discovery');
  });

  it('stays conservative when the rundown does not state ownership', () => {
    // "associated with Sol Gym" is ambiguous — could be staff. Don't pitch on a guess.
    expect(finalizePlay(card({
      firstName: 'lori', lastName: 'chaplin', partnerFacilityRole: '',
      rundown: 'Lori Chaplin is associated with Sol Gym, a personal training fitness center in SF.',
    })).action).toBe('discovery');
  });

  // ── must FLIP to a direct pitch (we already know who the owner is) ──
  it('flips a named owner whose rundown says they run the place (role mislabeled "Trainer")', () => {
    expect(finalizePlay(card({
      firstName: 'michael', lastName: 'crammond', partnerFacilityRole: 'Trainer',
      rundown: 'Michael Crammond runs Whole Body Solutions, a personal training and wellness studio in SF.',
    })).action).not.toBe('discovery');
  });

  it('flips an explicit "Owner" role even with only a first name on file (Charlie)', () => {
    expect(finalizePlay(card({
      firstName: 'charlie', lastName: '', partnerFacilityRole: 'Owner',
      rundown: 'Charlie is a military veteran and certified fitness professional with 30 years experience.',
    })).action).not.toBe('discovery');
  });

  it('flips a first-name-only co-owner stated in the rundown (Jae)', () => {
    expect(finalizePlay(card({
      firstName: 'jae', lastName: '', partnerFacilityRole: 'Owner',
      rundown: 'Jae is a personal trainer and co-owner of J+K Fitness Studio, a personal training studio.',
    })).action).not.toBe('discovery');
  });

  // ── REVERSE buildCard's line-type discovery when the rundown names the owner (spec §2) ──
  // The live bug: buildCard sets play=discovery from the line type (voip switchboard) for
  // Michael Crammond even though his rundown opens "Michael Crammond runs Whole Body
  // Solutions" (the spec's own example). finalizePlay knew he was a known DM but only used
  // that to avoid FORCING discovery — it never REVERSED buildCard's discovery verdict, so he
  // sat on a "call and ask who handles partnerships" card for his own studio (report line 88).
  it('reverses a buildCard discovery verdict when the rundown names the owner', () => {
    const p = card({
      firstName: 'michael', lastName: 'crammond', partnerFacilityRole: 'Trainer',
      phoneType: 'voip',
      rundown: 'Michael Crammond runs Whole Body Solutions, a personal training and wellness studio in SF.',
      derived: { kind: 'act', action: 'discovery', channel: 'call', warmth: 0, urgency: 50,
                 why: 'Call and ask who handles partnerships, then get a name.',
                 _cadenceWhy: 'Send step 2 of 5 now (call; last touch 9d ago).' },
    });
    const r = finalizePlay(p);
    expect(r.action).not.toBe('discovery');        // flipped to a direct pitch
    expect(r.why).not.toMatch(/who handles partnerships/);
  });

  it('reverses a buildCard discovery verdict for an explicit Owner role (first name only)', () => {
    const p = card({
      firstName: 'charlie', lastName: '', partnerFacilityRole: 'Owner', phoneType: 'landline',
      rundown: 'Charlie is a certified fitness professional with 30 years experience.',
      derived: { kind: 'act', action: 'discovery', channel: 'call', warmth: 0, urgency: 50,
                 why: 'Call and ask who handles partnerships.' },
    });
    expect(finalizePlay(p).action).not.toBe('discovery');
  });

  it('does NOT reverse discovery when the owner is unverified import research', () => {
    // The verify-first guard still wins: a named-owner rundown does not make an untrusted
    // import number safe to dial.
    const p = card({
      firstName: 'michael', lastName: 'crammond', partnerFacilityRole: 'Owner',
      rundown: 'Michael Crammond runs Whole Body Solutions.',
      derived: { kind: 'act', action: 'discovery', channel: 'call', warmth: 0, urgency: 50,
                 why: "Verify Michael's number before any outreach.", phoneProvenance: 'unverified' },
    });
    expect(finalizePlay(p).action).toBe('discovery');
  });

  // ── guards on existing behavior ──
  it('never runs discovery on a trusted solo contact', () => {
    expect(finalizePlay(card({
      firstName: 'amanda', partnerFacilityRole: 'Manager', tags: ['trainer-solo'],
    })).action).not.toBe('discovery');
  });

  it('parks a PT-on-staff contact as an aside (unchanged)', () => {
    const r = finalizePlay(card({ firstName: 'sam', hasPtOnStaff: 'Yes' }));
    expect(r.kind).toBe('aside');
  });

  // Landline channel correction is Phase 3 buildCard's job (not finalizePlay's).
  // See build-card.test.js: "channel is line-type, full stop".

  it('leaves a non-actionable card untouched', () => {
    const aside = { derived: { kind: 'aside', action: null }, tags: [], category: 'trainer' };
    expect(finalizePlay({ ...card(), ...aside }).kind).toBe('aside');
  });
});

// ── phone provenance through the overlay (the 2026-07-02 wrong-number fix) ──────────
// buildCard makes an unverified import number a VERIFY-FIRST task (play=discovery + a
// "verify the number before any outreach" headline) — LinkedIn was retired as a channel
// (Eben 2026-06-20/07-03, zero engagement ever), so the move is the discovery one: confirm
// the number reaches this person, then update it. That verdict must survive overlayCard
// (which otherwise lets the cadence's call/text channel or an engaged-by-email mirror win)
// AND finalizePlay (which otherwise reshapes discovery cards) — so the untrusted number is
// never surfaced for outreach (the 2026-07-02 wrong-number incident).
describe('overlayCard + finalizePlay — unverified import phones never become call/text', () => {
  const NOW = Date.parse('2026-06-21T12:00:00Z');
  const oxanaCard = (thread = []) => buildCard({
    firstName: 'Oxana', lastName: 'Petrova', role: 'Trainer', lineType: 'voip',
    email: 'oxana.petrova.linkedin@amari-prospect.placeholder',
    thread,
  }, NOW);

  it('overlayCard: an unverified number becomes a verify-first discovery task, not the cadence channel', () => {
    const base = { kind: 'act', urgency: 62, warmth: 1, action: 'call', channel: 'call', why: 'Call them again today.' };
    const d = overlayCard(base, oxanaCard());
    expect(d.action).toBe('discovery');            // never call/text/linkedin on the number
    expect(d.why).toMatch(/verify/i);              // the verify headline wins over the cadence why
    expect(d.why).not.toMatch(/Call them again/);  // the dial-the-number cadence why does not win
    expect(d.phoneProvenance).toBe('unverified');
  });

  it('overlayCard: engaged-by-EMAIL does not flip an unverified phone into a text on the number', () => {
    const cardEngagedByEmail = buildCard({
      firstName: 'Oxana', lastName: 'Petrova', role: 'Trainer', lineType: 'mobile',
      email: 'oxana.petrova.linkedin@amari-prospect.placeholder',
      thread: [
        { direction: 'outbound', type: 'EMAIL', body: 'Hi', callDuration: null, date: '2026-06-10T10:00:00Z' },
        { direction: 'inbound', type: 'EMAIL', body: 'Sounds interesting, tell me more?', callDuration: null, date: '2026-06-12T10:00:00Z' },
      ],
    }, NOW);
    const base = { kind: 'act', urgency: 70, warmth: 2, action: 'text', channel: 'text', why: 'Text them back.' };
    const d = overlayCard(base, cardEngagedByEmail);
    expect(d.action).toBe('discovery');
    expect(d.phoneProvenance).toBe('unverified');
    expect(d.why).not.toMatch(/^Text /);           // reply-by-email headline, never "Text ..." the number
  });

  it('overlayCard stamps phone provenance onto derived so the honesty footnote can show it', () => {
    const base = { kind: 'act', urgency: 50, warmth: 0, action: 'call', channel: 'call', why: 'x' };
    const d = overlayCard(base, oxanaCard());
    expect(d.phoneProvenance).toBe('unverified');
    expect(d.phoneNote).toMatch(/phone unverified/i);
  });

  it('overlayCard: a PROVEN import number flows through normally (engagement upgraded trust)', () => {
    const proven = buildCard({
      firstName: 'TJ', lastName: '', role: 'Trainer', lineType: 'mobile',
      email: 'tj.linkedin@amari-prospect.placeholder',
      thread: [
        { direction: 'outbound', type: 'SMS', body: 'Hi TJ', callDuration: null, date: '2026-06-10T10:00:00Z' },
        { direction: 'inbound', type: 'SMS', body: 'Sure, tell me more', callDuration: null, date: '2026-06-12T10:00:00Z' },
      ],
    }, NOW);
    const base = { kind: 'act', urgency: 70, warmth: 2, action: 'text', channel: 'text', why: 'Text them back.' };
    const d = overlayCard(base, proven);
    expect(d.channel).toBe('text');
    expect(d.phoneProvenance).toBe('proven');
  });

  it('overlayCard: an enrichment-URL-only import (real email, no source) still becomes a verify task', () => {
    // The grading-pass gap (2026-07-03): Dante Jeavon / James Fish / Rich Yokota /
    // Daivya Allmond carry real-looking emails and an empty source — only the
    // partner_linkedin_url enrichment field marks them as imports.
    const urlOnly = buildCard({
      firstName: 'James', lastName: 'Fish', role: 'Trainer', lineType: 'mobile',
      email: 'james.fish@gmail.com', source: null,
      linkedinUrl: 'https://linkedin.com/in/james-fish-sf',
      thread: [],
    }, NOW);
    const base = { kind: 'act', urgency: 62, warmth: 1, action: 'call', channel: 'call', why: 'Call them again today.' };
    const d = overlayCard(base, urlOnly);
    expect(d.action).toBe('discovery');
    expect(d.why).toMatch(/verify/i);
    expect(d.phoneProvenance).toBe('unverified');
  });

  it('trusted-flip: a dm-verified discovery card restores a Send-leading cadence why with the FINAL verb + channel', () => {
    // LeRocman Hall / James Anderson / Glenn: dm-verified flips discovery back to pitch, but
    // the cadence why leads with "Send" (not Call/Text) and carries a "(text; ...)" hint —
    // the old ^(Call|Text) rewrite left "Send step 2 of 5 now (text; ...)" under a Call pill
    // on a landline. The verb AND the channel hint must match the final channel.
    const p = card({
      firstName: 'lerocman', lastName: 'hall', tags: ['trainer-facility', 'dm-verified'],
      phoneType: 'landline',
      derived: { kind: 'act', action: 'discovery', channel: 'call', warmth: 0, urgency: 50,
                 why: 'Call and ask who handles partnerships, then get a name.',
                 _cadenceWhy: 'Send step 2 of 5 now (text; last touch 31d ago).' },
    });
    const r = finalizePlay(p);
    expect(r.action).toBe('call');                 // landline → call
    expect(r.why).toMatch(/^Call /);               // verb matches the pill
    expect(r.why).not.toMatch(/^Send /);           // "Send"-leading is rewritten
    expect(r.why).not.toMatch(/\(text;/);          // the channel hint no longer contradicts the call
  });

  it('trusted-flip: a textable line keeps the Text verb on a Send-leading cadence why', () => {
    const p = card({
      firstName: 'glenn', tags: ['trainer-solo'], phoneType: 'mobile',
      derived: { kind: 'act', action: 'discovery', channel: 'call', warmth: 0, urgency: 50,
                 why: 'Call and ask who handles partnerships.',
                 _cadenceWhy: 'Send step 3 of 5 now (call; last touch 12d ago).' },
    });
    const r = finalizePlay(p);
    expect(r.action).toBe('text');
    expect(r.why).toMatch(/^Text /);
    expect(r.why).not.toMatch(/\(call;/);
  });

  it('finalizePlay: never reshapes an unverified verify-first card (guard preserves the headline)', () => {
    // A facility contact with no named owner would normally be forced onto the generic
    // "call and ask who handles partnerships" discovery card — but here the number is the
    // thing we don't trust, so the verify-first headline and discovery action must stand.
    const p = card({
      firstName: 'oxana', lastName: 'petrova',
      derived: { kind: 'act', action: 'discovery', channel: 'call', warmth: 0, urgency: 50,
                 why: "Verify Oxana's number before any outreach — it came from import research.",
                 phoneProvenance: 'unverified' },
    });
    const r = finalizePlay(p);
    expect(r.action).toBe('discovery');
    expect(r.why).toMatch(/verify/i);              // not overwritten by the generic discovery why
  });
});
