import type { PartnerProspect } from '../types/staff';

export const OUTREACH_PRIORITY_TAG = 'outreach-priority';

/**
 * A priority prospect stays pinned only until the first real outreach touch.
 * The tag can remain as batch provenance without outranking due follow-ups later.
 */
export function isPinnedUntouchedProspect(prospect: PartnerProspect) {
  return prospect.tags.includes(OUTREACH_PRIORITY_TAG)
    && prospect.touchCount === 0
    && !prospect.partnerLastSignal
    && !prospect.lastActivityAt;
}

/**
 * Staff Outreach is acquisition work, not a general relationship follow-up
 * queue. Keep this guard at the UI seam even though the server also excludes
 * converted people, so stale or older payloads cannot put clients back on Home.
 */
export function selectAcquisitionProspects(
  prospects: PartnerProspect[],
  limit = 3,
  excludeContactIds: ReadonlySet<string> = new Set(),
) {
  return prospects
    .filter((prospect) => prospect.derived?.kind === 'act')
    .filter((prospect) => !prospect.hasClientEvidence)
    .filter((prospect) => !prospect.isActivePartner)
    .filter((prospect) => prospect.partnerStage !== 'partner' && prospect.partnerStage !== 'session-booked')
    .filter((prospect) => String(prospect.category) !== 'client')
    .filter((prospect) => !excludeContactIds.has(prospect.contactId))
    .sort((a, b) =>
      Number(isPinnedUntouchedProspect(b)) - Number(isPinnedUntouchedProspect(a))
      || (b.derived?.urgency || 0) - (a.derived?.urgency || 0)
      || a.contactId.localeCompare(b.contactId))
    .slice(0, Math.max(0, limit));
}

export function withoutNeedsReply<T>(
  rows: T[],
  needsReplyIds: ReadonlySet<string>,
  contactId: (row: T) => string = (row) => (row as { contactId: string }).contactId,
) {
  return rows.filter((row) => !needsReplyIds.has(contactId(row)));
}
