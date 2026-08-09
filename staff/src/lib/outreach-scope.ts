import type { OutreachCard } from '../types/staff';

const PROACTIVE_OUTREACH_STATUSES = new Set<OutreachCard['recommendation']['status']>([
  'referral-never-booked',
  'cancellation-not-followed-up',
  'pre-session-text-owed',
  'next-booking-owed',
  'recently-contacted-silent',
  'truly-cold',
  'partner-no-referrals',
  'engaged',
]);

export function isHomeOutreachCandidate(card: OutreachCard) {
  return card.recommendation.priority > 0
    && PROACTIVE_OUTREACH_STATUSES.has(card.recommendation.status);
}

export function withoutNeedsReply<T>(
  rows: T[],
  needsReplyIds: ReadonlySet<string>,
  contactId: (row: T) => string = (row) => (row as { contactId: string }).contactId,
) {
  return rows.filter((row) => !needsReplyIds.has(contactId(row)));
}
