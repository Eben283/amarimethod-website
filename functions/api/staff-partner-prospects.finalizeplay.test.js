import { describe, it, expect } from 'vitest';
import { finalizePlay } from './staff-partner-prospects.js';

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

  it('routes a landline text card to a call (unchanged)', () => {
    const r = finalizePlay(card({
      firstName: 'pat', lastName: 'jones', partnerFacilityRole: 'Owner', phoneType: 'landline',
    }));
    // Owner → not discovery; landline → call instead.
    expect(r.action).toBe('call');
  });

  it('leaves a non-actionable card untouched', () => {
    const aside = { derived: { kind: 'aside', action: null }, tags: [], category: 'trainer' };
    expect(finalizePlay({ ...card(), ...aside }).kind).toBe('aside');
  });
});
