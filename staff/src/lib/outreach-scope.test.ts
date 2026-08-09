import { describe, expect, it } from 'vitest';
import { selectAcquisitionProspects, withoutNeedsReply } from './outreach-scope';
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
});
