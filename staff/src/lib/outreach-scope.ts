import type { PartnerProspect } from '../types/staff';

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
    .sort((a, b) => (b.derived?.urgency || 0) - (a.derived?.urgency || 0))
    .slice(0, Math.max(0, limit));
}

export function withoutNeedsReply<T>(
  rows: T[],
  needsReplyIds: ReadonlySet<string>,
  contactId: (row: T) => string = (row) => (row as { contactId: string }).contactId,
) {
  return rows.filter((row) => !needsReplyIds.has(contactId(row)));
}
