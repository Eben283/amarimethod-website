import { describe, expect, it } from 'vitest';
import { isHomeOutreachCandidate, withoutNeedsReply } from './outreach-scope';
import type { OutreachCard } from '../types/staff';

function card(status: OutreachCard['recommendation']['status'], priority = 50): OutreachCard {
  return {
    contactId: `contact-${status}`,
    name: status,
    firstName: status,
    email: null,
    phone: null,
    tags: [],
    bucket: 'other',
    pipelineStage: null,
    seriesType: null,
    sessionsCompleted: null,
    sessionsRemaining: null,
    totalSpend: 0,
    clientReferralCount: 0,
    referralSource: null,
    isReferral: false,
    lastAppointment: null,
    nextAppointment: null,
    cancelledAppointment: null,
    lastOutbound: null,
    lastInbound: null,
    daysSinceLastOutbound: null,
    daysSinceLastInbound: null,
    recommendation: { headline: status, status, priority, actions: [], suggestedTemplate: null },
  };
}

describe('Outreach scope', () => {
  it('keeps proactive contact recommendations and rejects operations or wait-state cards', () => {
    expect(isHomeOutreachCandidate(card('cancellation-not-followed-up'))).toBe(true);
    expect(isHomeOutreachCandidate(card('next-booking-owed'))).toBe(true);
    expect(isHomeOutreachCandidate(card('partner-no-referrals'))).toBe(true);
    expect(isHomeOutreachCandidate(card('data-drift'))).toBe(false);
    expect(isHomeOutreachCandidate(card('too-soon'))).toBe(false);
    expect(isHomeOutreachCandidate(card('recently-completed'))).toBe(false);
    expect(isHomeOutreachCandidate(card('truly-cold', 0))).toBe(false);
  });

  it('removes people with an unanswered conversation from proactive outreach', () => {
    const rows = [{ contactId: 'a' }, { contactId: 'b' }, { contactId: 'c' }];
    expect(withoutNeedsReply(rows, new Set(['b', 'c']))).toEqual([{ contactId: 'a' }]);
  });
});
