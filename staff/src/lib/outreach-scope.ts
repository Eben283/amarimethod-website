import type { PartnerProspect } from '../types/staff';
import type { PartnerLastSignal, PartnerStage } from '../types/staff';

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

type VerifiedOutcome = {
  signal: PartnerLastSignal;
  newStage: PartnerStage | null;
  signalAt: string | null;
  followupAt: string | null;
};

/**
 * Keep the just-saved row consistent while GHL's search index catches up.
 * Closing outcomes must stop being actionable in search and collapsed cards
 * immediately after the authoritative endpoint confirms them.
 */
export function applyVerifiedOutcome(
  prospect: PartnerProspect,
  outcome: VerifiedOutcome,
  touched: boolean,
): PartnerProspect {
  const stage = outcome.newStage ?? prospect.partnerStage;
  let derived = prospect.derived;
  if (stage === 'dropped' || stage === 'future-potential') {
    const { channel: _channel, ...prior } = derived ?? { kind: 'aside' as const, urgency: 0, why: '', action: null };
    derived = {
      ...prior,
      kind: 'aside',
      urgency: 0,
      why: '',
      action: null,
      asideReason: stage === 'dropped' ? 'Set aside' : 'Saved for later',
    };
  } else if (stage === 'session-booked' || stage === 'partner') {
    const { channel: _channel, ...prior } = derived ?? { kind: 'converted' as const, urgency: 0, why: '', action: null };
    derived = {
      ...prior,
      kind: 'converted',
      urgency: 0,
      why: '',
      action: null,
      asideReason: stage === 'session-booked' ? 'Session booked' : 'Active partner',
    };
  }
  return {
    ...prospect,
    partnerStage: stage,
    partnerFollowupAt: outcome.followupAt ?? prospect.partnerFollowupAt,
    ...(touched ? {
      partnerLastSignal: outcome.signal,
      partnerLastSignalAt: outcome.signalAt,
    } : {}),
    derived,
  };
}
