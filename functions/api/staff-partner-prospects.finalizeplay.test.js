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
// buildCard says "linkedin" when the number on file is unverified import research.
// That verdict must survive overlayCard (which otherwise lets the cadence's call/text
// channel or an engaged-by-email mirror win) AND finalizePlay (which otherwise forces
// an unverified facility onto a discovery CALL card — dialing the very number we
// don't trust).
describe('overlayCard + finalizePlay — unverified import phones never become call/text', () => {
  const NOW = Date.parse('2026-06-21T12:00:00Z');
  const oxanaCard = (thread = []) => buildCard({
    firstName: 'Oxana', lastName: 'Petrova', role: 'Trainer', lineType: 'voip',
    email: 'oxana.petrova.linkedin@amari-prospect.placeholder',
    thread,
  }, NOW);

  it('overlayCard: the LinkedIn channel wins over the cadence base channel', () => {
    const base = { kind: 'act', urgency: 62, warmth: 1, action: 'call', channel: 'call', why: 'Call them again today.' };
    const d = overlayCard(base, oxanaCard());
    expect(d.channel).toBe('linkedin');
    expect(d.action).toBe('linkedin');
    expect(d.why).toMatch(/LinkedIn/);
    expect(d.why).not.toMatch(/^(Call|Text) /);
  });

  it('overlayCard: engaged-by-EMAIL does not flip an unverified phone back to text', () => {
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
    expect(d.channel).toBe('linkedin');
    expect(d.action).toBe('linkedin');
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

  it('overlayCard: an enrichment-URL-only import (real email, no source) still routes to LinkedIn', () => {
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
    expect(d.channel).toBe('linkedin');
    expect(d.action).toBe('linkedin');
    expect(d.phoneProvenance).toBe('unverified');
  });

  it('finalizePlay: never rewrites a LinkedIn-routed card into a discovery call', () => {
    // An unverified facility contact would normally be forced onto discovery
    // ("call and ask who handles partnerships") — but the number is the thing
    // we don't trust, so the LinkedIn route must stand.
    const p = card({
      firstName: 'oxana', lastName: 'petrova',
      derived: { kind: 'act', action: 'linkedin', channel: 'linkedin', warmth: 0, urgency: 50,
                 why: 'Reach Oxana on LinkedIn.', phoneProvenance: 'unverified' },
    });
    const r = finalizePlay(p);
    expect(r.action).toBe('linkedin');
    expect(r.channel).toBe('linkedin');
  });
});
