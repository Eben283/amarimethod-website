import { describe, expect, it } from 'vitest';
import { applyVerifiedOutcome, isPinnedUntouchedProspect, selectAcquisitionProspects, withoutNeedsReply } from './outreach-scope';
import type { PartnerProspect } from '../types/staff';

describe('Outreach scope', () => {
  it('removes people with an unanswered conversation from proactive outreach', () => {
    const rows = [{ contactId: 'a' }, { contactId: 'b' }, { contactId: 'c' }];
    expect(withoutNeedsReply(rows, new Set(['b', 'c']))).toEqual([{ contactId: 'a' }]);
  });

  it('selects only active new-client acquisition prospects', () => {
    const prospect = (overrides: Partial<PartnerProspect>): PartnerProspect => ({
      contactId: 'prospect',
      firstName: 'New',
      lastName: 'Prospect',
      fullName: 'New Prospect',
      category: 'trainer',
      tags: ['partner-prospect'],
      phone: null,
      email: null,
      website: null,
      companyName: null,
      address1: null,
      city: null,
      state: null,
      postalCode: null,
      socialProfile: null,
      linkedinUrl: null,
      instagram: null,
      otherUrls: null,
      rundown: null,
      lastActivityAt: null,
      isActivePartner: false,
      partnerStage: null,
      partnerSource: null,
      partnerLastSignal: null,
      partnerLastSignalAt: null,
      partnerFollowupAt: null,
      partnerFacility: null,
      partnerFacilityType: null,
      partnerFacilityRole: null,
      hasPtOnStaff: null,
      outreachVerified: false,
      touchCount: 0,
      sheetStatus: null,
      sheetNotes: null,
      inGarrettSheet: false,
      derived: { kind: 'act', urgency: 50, why: 'New lead', action: 'call' },
      ...overrides,
    });

    const rows = [
      prospect({ contactId: 'lower', derived: { kind: 'act', urgency: 40, why: 'Due', action: 'call' } }),
      prospect({ contactId: 'converted', isActivePartner: true, derived: { kind: 'act', urgency: 99, why: 'Bad stale state', action: 'text' } }),
      prospect({ contactId: 'former-client', hasClientEvidence: true, derived: { kind: 'act', urgency: 98, why: 'Stale prospect tag', action: 'text' } }),
      prospect({ contactId: 'waiting', derived: { kind: 'waiting', urgency: 0, why: 'Cooling off', action: null } }),
      prospect({ contactId: 'client', category: 'client' as PartnerProspect['category'], derived: { kind: 'act', urgency: 100, why: 'Generic client follow-up', action: 'text' } }),
      prospect({ contactId: 'needs-reply', derived: { kind: 'act', urgency: 90, why: 'Should stay in Communication', action: 'text' } }),
      prospect({ contactId: 'higher', derived: { kind: 'act', urgency: 70, why: 'Due now', action: 'call' } }),
    ];

    expect(selectAcquisitionProspects(rows, 3, new Set(['needs-reply'])).map((row) => row.contactId)).toEqual(['higher', 'lower']);
  });

  it('pins a priority batch until its first outreach touch', () => {
    const base = {
      contactId: 'prospect', firstName: 'New', lastName: 'Prospect', fullName: 'New Prospect',
      category: 'unknown', tags: ['partner-prospect'], phone: null, email: null, website: null,
      companyName: null, address1: null, city: null, state: null, postalCode: null,
      socialProfile: null, linkedinUrl: null, instagram: null, otherUrls: null, rundown: null,
      lastActivityAt: null, isActivePartner: false, partnerStage: null, partnerSource: null,
      partnerLastSignal: null, partnerLastSignalAt: null, partnerFollowupAt: null,
      partnerFacility: null, partnerFacilityType: null, partnerFacilityRole: null,
      hasPtOnStaff: null, outreachVerified: false, touchCount: 0, sheetStatus: null,
      sheetNotes: null, inGarrettSheet: false,
    } satisfies PartnerProspect;
    const priority = { ...base, contactId: 'priority', tags: [...base.tags, 'outreach-priority'], derived: { kind: 'act' as const, urgency: 40, why: 'New lead', action: 'call' as const } };
    const due = { ...base, contactId: 'due', derived: { kind: 'act' as const, urgency: 90, why: 'Due', action: 'call' as const } };

    expect(isPinnedUntouchedProspect(priority)).toBe(true);
    expect(selectAcquisitionProspects([due, priority], 2).map((row) => row.contactId)).toEqual(['priority', 'due']);
    expect(isPinnedUntouchedProspect({ ...priority, touchCount: 1 })).toBe(false);
  });

  it('moves a verified set-aside outcome out of every actionable/search presentation immediately', () => {
    const prospect = {
      contactId: 'prospect', firstName: 'New', lastName: 'Prospect', fullName: 'New Prospect',
      category: 'trainer', tags: ['partner-prospect'], phone: null, email: null, website: null,
      companyName: null, address1: null, city: null, state: null, postalCode: null,
      socialProfile: null, linkedinUrl: null, instagram: null, otherUrls: null, rundown: null,
      lastActivityAt: null, isActivePartner: false, partnerStage: 'working', partnerSource: null,
      partnerLastSignal: 'voicemail', partnerLastSignalAt: '2026-09-01T00:00:00Z', partnerFollowupAt: null,
      partnerFacility: null, partnerFacilityType: null, partnerFacilityRole: null, hasPtOnStaff: null,
      outreachVerified: false, touchCount: 2, sheetStatus: null, sheetNotes: null, inGarrettSheet: false,
      derived: { kind: 'act', urgency: 70, why: 'Text again', action: 'text' },
    } satisfies PartnerProspect;

    const updated = applyVerifiedOutcome(prospect, {
      signal: 'not-interested', newStage: 'dropped', signalAt: '2026-09-12T10:00:00Z', followupAt: null,
    }, true);

    expect(updated.partnerStage).toBe('dropped');
    expect(updated.partnerLastSignal).toBe('not-interested');
    expect(updated.derived).toMatchObject({ kind: 'aside', urgency: 0, action: null });
    expect(updated.derived?.why).toBe('');
    expect(selectAcquisitionProspects([updated], 3)).toEqual([]);
  });
});
