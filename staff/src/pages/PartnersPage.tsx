import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Loader2, ExternalLink, AlertCircle, X, Phone, MessageSquare,
  Mail, StickyNote, Calendar, CalendarCheck, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getPartnerProspects, getPartnerActivity, recordPartnerOutcome,
  toggleOutreachVerified, ApiError,
} from '../lib/api';
import type {
  PartnerProspect, PartnerCategoryFilter, PartnerCategory, PartnerStage,
  PartnerStageFilter, PartnerLastSignal, PartnerActivityEvent,
} from '../types/staff';

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

const STALE_DAYS_THRESHOLD = 14;
const OUTREACH_STAGES: PartnerStage[] = ['no-outreach', 'working'];

// ─────────────────────────────────────────────────────────────────────────────
// Utility: friendly date format ("May 20th 2026", no time)

function friendlyDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' :
    day % 10 === 2 && day !== 12 ? 'nd' :
    day % 10 === 3 && day !== 13 ? 'rd' :
    'th';
  return `${month} ${day}${suffix} ${year}`;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function relativeDays(iso: string | null | undefined): string {
  const d = daysSince(iso);
  if (d === null) return 'not recorded';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 30) return `${d}d ago`;
  const months = Math.round(d / 30);
  return `${months}mo ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter chips, badges

const CATEGORY_FILTERS: { id: PartnerCategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'golf', label: 'Golf' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'trainer', label: 'Personal Trainer' },
];

const STAGE_FILTERS: { id: PartnerStageFilter; label: string }[] = [
  { id: 'all', label: 'All stages' },
  { id: 'no-outreach', label: 'No outreach' },
  { id: 'working', label: 'Working' },
  { id: 'session-booked', label: 'Session booked' },
  { id: 'partner', label: 'Partner' },
  { id: 'future-potential', label: 'Future potential' },
  { id: 'dropped', label: 'Dropped' },
];

const CATEGORY_BADGE: Record<PartnerCategory, string> = {
  golf: 'bg-emerald-100 text-emerald-900',
  tennis: 'bg-amber-100 text-amber-900',
  trainer: 'bg-sky-100 text-sky-900',
  unknown: 'bg-gray-100 text-gray-700',
};

const STAGE_LABEL: Record<PartnerStage, string> = {
  'no-outreach': 'No outreach',
  'working': 'Working',
  'session-booked': 'Session booked',
  'partner': 'Partner',
  'future-potential': 'Future potential',
  'dropped': 'Dropped',
};

const SIGNAL_LABEL: Record<PartnerLastSignal, string> = {
  'no-answer': 'No answer',
  'voicemail': 'Voicemail',
  'talked': 'Talked',
  'link-sent': 'Sent link',
  'booked': 'Booked',
  'deferred': 'Deferred',
  'not-interested': 'Not interested',
};

// Note: 'link-sent' intentionally NOT a manual button — sending the partner
// session link happens via GHL/staff-app send-link button, which already
// records an outbound message. The enum value still exists (some migrated
// contacts have it set from sheet status) but Garrett doesn't pick it
// manually. Future: auto-detect link-sent by scanning outbound messages
// for the partner-booking-link URL.
const OUTCOME_BUTTONS: { id: PartnerLastSignal; label: string }[] = [
  { id: 'voicemail', label: 'Voicemail' },
  { id: 'talked', label: 'Talked' },
  { id: 'booked', label: 'Booked' },
  { id: 'deferred', label: 'Deferred' },
  { id: 'not-interested', label: 'Not Interested' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Priority sort for the queue (higher score = closer to top)
//
// Order:
//  1. Working + stale (high attention)
//  2. Future Potential whose follow-up is within 7 days
//  3. Session Booked
//  4. No Outreach (still in queue to start)
//  5. Working with recent activity
//  6. Partner
//  7. Future Potential (not yet due)
//  8. Dropped

function priorityScore(p: PartnerProspect): number {
  const stage = p.partnerStage || 'no-outreach';
  const dSince = daysSince(p.lastActivityAt);
  const dToFollowup = daysSince(p.partnerFollowupAt);
  const hasPhone = !!p.phone;
  const hasRealSignal = !!p.partnerLastSignal;

  // Penalize hard if there's no phone — Garrett can't call them, so they drop
  // to the bottom of the queue. They're still visible (so they can be moved
  // forward when LinkedIn outreach is wired up), just not in his face.
  const noPhonePenalty = hasPhone ? 0 : -50;
  // Boost verified contacts — they have clean data, more actionable.
  const verifiedBoost = p.outreachVerified ? 15 : 0;
  const adjust = noPhonePenalty + verifiedBoost;

  if (stage === 'dropped') return 0 + adjust;
  if (stage === 'future-potential') {
    if (dToFollowup !== null && dToFollowup >= -7) return 80 + adjust;
    return 10 + adjust;
  }
  if (stage === 'partner') return 20 + adjust;
  if (stage === 'session-booked') return 70 + adjust;
  if (stage === 'working') {
    // Stale only when there's been real outreach that went cold (not "never touched")
    if (hasRealSignal && (dSince === null || dSince >= STALE_DAYS_THRESHOLD)) return 100 + adjust;
    return 50 + adjust;
  }
  if (stage === 'no-outreach') return 60 + adjust;
  return 30 + adjust;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact row in the queue

// Ready view: card leads with Garrett's real sheet data (Status, Notes).
function ReadyRow({ prospect, onTap }: { prospect: PartnerProspect; onTap: () => void }) {
  const stage = (prospect.partnerStage || 'no-outreach') as PartnerStage;
  const dSince = daysSince(prospect.lastActivityAt);
  const hasRealContact = !!prospect.partnerLastSignal || !!prospect.lastActivityAt || !!prospect.sheetStatus;
  const isStale = stage === 'working' && hasRealContact && (dSince !== null && dSince >= STALE_DAYS_THRESHOLD);

  return (
    <button
      onClick={onTap}
      className={`w-full text-left bg-white rounded-md border p-3 shadow-sm hover:bg-amari-light-sand/30 transition-colors ${
        isStale ? 'border-l-2 border-l-red-500' : 'border-amari-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium text-amari-charcoal truncate">
          {prospect.fullName}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${CATEGORY_BADGE[prospect.category]}`}>
            {prospect.category === 'trainer' ? 'PT' : prospect.category}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amari-light-sand text-amari-charcoal">
            {STAGE_LABEL[stage]}
          </span>
          {isStale && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-red-700 font-medium">
              <AlertCircle className="w-3 h-3" />
              stale
            </span>
          )}
        </div>
      </div>
      {prospect.phone && (
        <p className="text-xs text-amari-charcoal mt-0.5">{prospect.phone}</p>
      )}
      {/* Sheet Status and Notes — Garrett's real curated data, leads the card */}
      {prospect.sheetStatus && (
        <p className="text-xs text-amari-charcoal font-medium mt-1">
          📋 {prospect.sheetStatus}
        </p>
      )}
      {prospect.sheetNotes && (
        <p className="text-xs text-amari-text-secondary italic mt-0.5 line-clamp-2">
          "{prospect.sheetNotes}"
        </p>
      )}
      <p className="text-[11px] text-amari-text-muted mt-1">
        Last GHL activity: {relativeDays(prospect.lastActivityAt)}
        {prospect.partnerLastSignal && ` · ${SIGNAL_LABEL[prospect.partnerLastSignal]}`}
      </p>
    </button>
  );
}

// Review view: card emphasizes the verification action and what's missing.
function ReviewRow({
  prospect,
  onTap,
  onMarkVerified,
}: {
  prospect: PartnerProspect;
  onTap: () => void;
  onMarkVerified: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();
  const handleVerify = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSubmitting(true);
    try {
      await onMarkVerified();
    } finally {
      setSubmitting(false);
    }
  };
  const missing: string[] = [];
  if (!prospect.phone) missing.push('phone');
  if (!prospect.email) missing.push('email');
  if (!prospect.partnerFacility) missing.push('facility');

  return (
    <button
      onClick={onTap}
      className="w-full text-left bg-white rounded-md border border-amari-border p-3 shadow-sm hover:bg-amari-light-sand/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium text-amari-charcoal truncate">
          {prospect.fullName}
        </p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${CATEGORY_BADGE[prospect.category]}`}>
          {prospect.category === 'trainer' ? 'PT' : prospect.category}
        </span>
      </div>
      {prospect.phone ? (
        <p className="text-xs text-amari-charcoal mt-0.5">{prospect.phone}</p>
      ) : (
        <p className="text-xs text-amari-text-muted italic mt-0.5">
          {prospect.email ? `email only: ${prospect.email}` : prospect.instagram ? `IG only: ${prospect.instagram}` : 'no contact info'}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-[11px] text-amari-text-muted mt-0.5">
          Missing: {missing.join(', ')}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2" onClick={stopProp}>
        <button
          onClick={handleVerify}
          disabled={submitting}
          className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? '...' : '✓ Mark verified'}
        </button>
        <span className="text-[11px] text-amari-text-muted">— moves to Ready view</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — full detail + actions

function ProspectModal({
  prospect,
  onClose,
  onOutcomeRecorded,
}: {
  prospect: PartnerProspect;
  onClose: () => void;
  onOutcomeRecorded: (signal: PartnerLastSignal) => void;
}) {
  const [activity, setActivity] = useState<PartnerActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);
  const [outcomeError, setOutcomeError] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [pendingDeferred, setPendingDeferred] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setActivityLoading(true);
      setActivityError('');
      try {
        const data = await getPartnerActivity(prospect.contactId);
        if (!cancelled) setActivity(data.events);
      } catch (err) {
        if (!cancelled) setActivityError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prospect.contactId]);

  const handleOutcome = async (signal: PartnerLastSignal) => {
    if (signal === 'deferred' && !followupDate) {
      setPendingDeferred(true);
      return;
    }
    setOutcomeSubmitting(true);
    setOutcomeError('');
    try {
      await recordPartnerOutcome({
        contactId: prospect.contactId,
        signal,
        note: outcomeNote.trim() || undefined,
        followupAt: signal === 'deferred' ? followupDate : undefined,
      });
      onOutcomeRecorded(signal);
      onClose();
    } catch (err) {
      setOutcomeError(err instanceof Error ? err.message : 'Failed to record outcome');
    } finally {
      setOutcomeSubmitting(false);
    }
  };

  const stage = (prospect.partnerStage || 'no-outreach') as PartnerStage;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-amari-bone-white w-full sm:max-w-2xl sm:rounded-lg shadow-xl my-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-amari-bone-white z-10 flex items-center justify-between border-b border-amari-border px-4 py-3">
          <div>
            <h2 className="text-lg font-serif text-amari-charcoal">{prospect.fullName}</h2>
            <p className="text-xs text-amari-text-muted">
              {prospect.category === 'trainer' ? 'Personal Trainer' : prospect.category} · {STAGE_LABEL[stage]}
              {prospect.partnerSource && ` · ${prospect.partnerSource}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-amari-light-sand rounded">
            <X className="w-5 h-5 text-amari-charcoal" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Contact */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Contact</h3>
            <dl className="text-sm space-y-0.5">
              {prospect.phone && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Phone</dt><dd className="text-amari-charcoal">{prospect.phone}</dd></div>
              )}
              {prospect.email && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Email</dt><dd className="text-amari-charcoal break-all">{prospect.email}</dd></div>
              )}
              {prospect.website && (
                <div className="flex gap-2">
                  <dt className="text-amari-text-muted w-24 shrink-0">Website</dt>
                  <dd>
                    <a href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-amari-accent-warm hover:underline inline-flex items-center gap-0.5">
                      {prospect.website} <ExternalLink className="w-3 h-3" />
                    </a>
                  </dd>
                </div>
              )}
              {prospect.instagram && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">IG</dt><dd className="text-amari-charcoal">@{prospect.instagram.replace(/^@/, '')}</dd></div>
              )}
              {prospect.partnerFacility && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Facility</dt><dd className="text-amari-charcoal">{prospect.partnerFacility}</dd></div>
              )}
              {prospect.partnerFacilityType && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Facility type</dt><dd className="text-amari-charcoal">{prospect.partnerFacilityType}</dd></div>
              )}
              {prospect.partnerFacilityRole && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">Role</dt><dd className="text-amari-charcoal">{prospect.partnerFacilityRole}</dd></div>
              )}
              {prospect.hasPtOnStaff && prospect.hasPtOnStaff !== 'Unknown' && (
                <div className="flex gap-2"><dt className="text-amari-text-muted w-24 shrink-0">PT on staff</dt><dd className="text-amari-charcoal">{prospect.hasPtOnStaff}</dd></div>
              )}
            </dl>
            {prospect.outreachVerified && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <CheckCircle2 className="w-3 h-3" />
                outreach verified
              </p>
            )}
          </section>

          {/* From Garrett's sheet — primary source of human-curated outreach data */}
          {(prospect.sheetStatus || prospect.sheetNotes) && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">
                From Garrett's sheet
              </h3>
              {prospect.sheetStatus && (
                <p className="text-sm text-amari-charcoal font-medium">
                  Status: {prospect.sheetStatus}
                </p>
              )}
              {prospect.sheetNotes && (
                <p className="text-sm text-amari-text-secondary italic mt-1">
                  "{prospect.sheetNotes}"
                </p>
              )}
            </section>
          )}

          {/* Follow-up date (if Future Potential) */}
          {stage === 'future-potential' && prospect.partnerFollowupAt && (
            <section className="bg-amari-light-sand rounded p-2.5 text-sm">
              <div className="inline-flex items-center gap-1.5 text-amari-charcoal">
                <Calendar className="w-4 h-4" />
                Follow up: <strong>{friendlyDate(prospect.partnerFollowupAt)}</strong>
              </div>
            </section>
          )}

          {/* Activity Timeline */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Activity Timeline</h3>
            {activityLoading ? (
              <div className="flex items-center gap-2 text-xs text-amari-text-muted py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading activity...
              </div>
            ) : activityError ? (
              <p className="text-xs text-red-700">{activityError}</p>
            ) : activity.length === 0 ? (
              <p className="text-xs text-amari-text-muted italic">No activity yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {activity.slice(0, 10).map((e, idx) => (
                  <li key={idx} className="flex gap-2 items-start">
                    <span className="text-amari-text-muted w-32 shrink-0">{friendlyDate(e.date)}</span>
                    <span className="inline-flex items-center gap-1 text-amari-charcoal">
                      {e.type === 'call' && <Phone className="w-3 h-3" />}
                      {e.type === 'sms' && <MessageSquare className="w-3 h-3" />}
                      {e.type === 'email' && <Mail className="w-3 h-3" />}
                      {e.type === 'note' && <StickyNote className="w-3 h-3" />}
                      {e.type === 'appointment' && <CalendarCheck className="w-3 h-3" />}
                      {e.type === 'call' ? `Call ${e.direction === 'inbound' ? 'received' : 'placed'}` :
                       e.type === 'sms' ? `SMS ${e.direction === 'inbound' ? 'received' : 'sent'}` :
                       e.type === 'email' ? `Email ${e.direction === 'inbound' ? 'received' : 'sent'}` :
                       e.type === 'appointment' ? (e.body || 'Appointment') :
                       'Note'}
                      {e.body && (e.type === 'note') && (
                        <span className="text-amari-text-muted ml-1">— {e.body.slice(0, 80)}{e.body.length > 80 ? '…' : ''}</span>
                      )}
                    </span>
                  </li>
                ))}
                {activity.length > 10 && (
                  <li className="text-amari-text-muted italic">… +{activity.length - 10} older events (open in GHL to see all)</li>
                )}
              </ul>
            )}
          </section>

          {/* Actions */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted mb-1.5">Actions</h3>
            <a
              href={ghlContactUrl(prospect.contactId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amari-charcoal text-white text-sm font-medium hover:opacity-90 mb-3"
            >
              Open in GHL <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <p className="text-[11px] uppercase tracking-wide text-amari-text-muted mt-2 mb-1.5">Record outcome</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {OUTCOME_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleOutcome(b.id)}
                  disabled={outcomeSubmitting}
                  className="px-3 py-1.5 rounded text-xs font-medium border border-amari-border text-amari-charcoal bg-white hover:bg-amari-light-sand disabled:opacity-50"
                >
                  {b.label}
                </button>
              ))}
            </div>
            {pendingDeferred && (
              <div className="bg-amari-light-sand rounded p-2 mb-2">
                <label className="text-xs text-amari-charcoal block mb-1">
                  When should we revisit this contact?
                </label>
                <input
                  type="date"
                  value={followupDate}
                  onChange={(e) => setFollowupDate(e.target.value)}
                  className="text-xs border border-amari-border rounded px-2 py-1 mr-2"
                />
                <button
                  onClick={() => handleOutcome('deferred')}
                  disabled={!followupDate || outcomeSubmitting}
                  className="text-xs px-2 py-1 rounded bg-amari-charcoal text-white disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            )}
            <input
              type="text"
              placeholder="Optional note about this outcome..."
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              className="w-full text-xs border border-amari-border rounded px-2 py-1.5"
            />
            {outcomeError && (
              <p className="text-xs text-red-700 mt-1.5">{outcomeError}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel summary panel

function FunnelPanel({
  countsByStage,
  total,
}: {
  countsByStage: Record<PartnerStage, number>;
  total: number;
}) {
  const stages: PartnerStage[] = ['no-outreach', 'working', 'session-booked', 'partner', 'future-potential', 'dropped'];
  const max = Math.max(...Object.values(countsByStage), 1);

  return (
    <div className="bg-white rounded-md border border-amari-border p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amari-text-muted">Funnel</h3>
        <span className="text-xs text-amari-text-muted">Total: <strong className="text-amari-charcoal">{total}</strong></span>
      </div>
      <div className="space-y-1">
        {stages.map((s) => {
          const n = countsByStage[s] || 0;
          const width = Math.max(2, (n / max) * 100);
          return (
            <div key={s} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 text-amari-text-muted">{STAGE_LABEL[s]}</span>
              <div className="flex-1 bg-amari-light-sand rounded h-3 overflow-hidden">
                <div className="bg-amari-accent-warm h-full" style={{ width: `${width}%` }} />
              </div>
              <span className="w-10 text-right text-amari-charcoal font-medium">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page

type PartnerView = 'ready' | 'review';

export default function PartnersPage() {
  const { logout } = useAuth();

  const [view, setView] = useState<PartnerView>('ready');
  const [categoryFilter, setCategoryFilter] = useState<PartnerCategoryFilter>('all');
  const [stageFilter, setStageFilter] = useState<PartnerStageFilter>('all');
  const [prospects, setProspects] = useState<PartnerProspect[]>([]);
  const [countsByCategory, setCountsByCategory] = useState<Record<PartnerCategory, number>>({
    golf: 0, tennis: 0, trainer: 0, unknown: 0,
  });
  const [countsByStage, setCountsByStage] = useState<Record<PartnerStage, number>>({
    'no-outreach': 0, 'working': 0, 'session-booked': 0,
    'partner': 0, 'future-potential': 0, 'dropped': 0,
  });
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [unverifiedCount, setUnverifiedCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [showFunnel, setShowFunnel] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getPartnerProspects();
      setProspects(data.prospects);
      setCountsByCategory(data.countsByCategory);
      setCountsByStage(data.countsByStage);
      setTotal(data.total);
      setVerifiedCount(data.verifiedCount);
      setUnverifiedCount(data.unverifiedCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load partners');
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  const visibleProspects = useMemo(() => {
    // Primary filter: view (Ready = verified only, Review = unverified only)
    let v = prospects.filter((p) =>
      view === 'ready' ? p.outreachVerified : !p.outreachVerified,
    );
    if (categoryFilter !== 'all') v = v.filter((p) => p.category === categoryFilter);
    // Stage filter only applies in Ready view
    if (view === 'ready' && stageFilter !== 'all') {
      v = v.filter((p) => (p.partnerStage || 'no-outreach') === stageFilter);
    }
    return [...v].sort((a, b) => {
      const pa = priorityScore(a);
      const pb = priorityScore(b);
      if (pa !== pb) return pb - pa;
      const da = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const db = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return da - db;
    });
  }, [prospects, view, categoryFilter, stageFilter]);

  const handleMarkVerified = async (contactId: string) => {
    // Optimistic: flip the local prospect immediately, then API persists.
    setProspects((prev) =>
      prev.map((p) => p.contactId === contactId ? { ...p, outreachVerified: true } : p),
    );
    setVerifiedCount((c) => c + 1);
    setUnverifiedCount((c) => Math.max(0, c - 1));
    try {
      await toggleOutreachVerified(contactId, true);
    } catch {
      // Roll back
      setProspects((prev) =>
        prev.map((p) => p.contactId === contactId ? { ...p, outreachVerified: false } : p),
      );
      setVerifiedCount((c) => Math.max(0, c - 1));
      setUnverifiedCount((c) => c + 1);
    }
  };

  const openProspect = useMemo(
    () => openContactId ? prospects.find((p) => p.contactId === openContactId) || null : null,
    [openContactId, prospects],
  );

  const categoryCount = (f: PartnerCategoryFilter): number => {
    if (f === 'all') return total;
    return countsByCategory[f as PartnerCategory] ?? 0;
  };

  return (
    <div className="px-3 pt-3 pb-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-serif text-amari-charcoal">Partners</h1>
        <div className="flex items-center gap-3">
          {view === 'ready' && (
            <button
              onClick={() => setShowFunnel((v) => !v)}
              className="text-xs text-amari-text-muted hover:text-amari-charcoal"
            >
              {showFunnel ? 'Hide funnel' : 'Show funnel'}
            </button>
          )}
          <button
            onClick={() => load()}
            disabled={isLoading}
            className="flex items-center gap-1 text-xs text-amari-text-muted hover:text-amari-charcoal disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* View toggle — Ready (verified, Garrett's workflow) vs Review (unverified, Eben's workflow) */}
      <div className="flex gap-1 bg-amari-light-sand rounded-md p-1 mb-3">
        <button
          onClick={() => setView('ready')}
          className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
            view === 'ready' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted hover:text-amari-charcoal'
          }`}
        >
          ✓ Ready to call <span className="opacity-70 ml-1">({verifiedCount})</span>
        </button>
        <button
          onClick={() => setView('review')}
          className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
            view === 'review' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted hover:text-amari-charcoal'
          }`}
        >
          ○ Needs review <span className="opacity-70 ml-1">({unverifiedCount})</span>
        </button>
      </div>

      {view === 'review' && (
        <p className="text-xs text-amari-text-muted mb-2 px-1">
          These contacts have partner tags but haven't been verified as ready to call. Review the data, then mark verified to move them to the Ready list.
        </p>
      )}

      {view === 'ready' && showFunnel && <FunnelPanel countsByStage={countsByStage} total={verifiedCount} />}

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
        {CATEGORY_FILTERS.map((f) => {
          const active = categoryFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setCategoryFilter(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active ? 'bg-amari-charcoal text-white' : 'bg-amari-light-sand text-amari-charcoal hover:bg-amari-light-sand/70'
              }`}
            >
              {f.label}{!isLoading && <span className="ml-1.5 opacity-70">({categoryCount(f.id)})</span>}
            </button>
          );
        })}
      </div>

      {/* Stage filter chips — only show in Ready view (stages are meaningless for unverified contacts) */}
      {view === 'ready' && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1 text-[11px]">
          {STAGE_FILTERS.map((f) => {
            const active = stageFilter === f.id;
            const count = f.id === 'all' ? verifiedCount : countsByStage[f.id as PartnerStage] || 0;
            return (
              <button
                key={f.id}
                onClick={() => setStageFilter(f.id)}
                className={`shrink-0 px-2 py-1 rounded font-medium transition-colors ${
                  active ? 'bg-amari-accent-warm text-white' : 'bg-white border border-amari-border text-amari-charcoal hover:bg-amari-light-sand/30'
                }`}
              >
                {f.label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {isLoading && prospects.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-amari-text-muted animate-spin" />
        </div>
      ) : visibleProspects.length === 0 ? (
        <p className="text-sm text-amari-text-muted text-center py-12">
          {view === 'ready' ? (
            verifiedCount === 0 ? 'No verified partners yet. Switch to "Needs review" to verify contacts.' : 'No prospects match the current filters.'
          ) : (
            'All contacts have been reviewed.'
          )}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visibleProspects.map((p) =>
            view === 'ready' ? (
              <ReadyRow
                key={p.contactId}
                prospect={p}
                onTap={() => setOpenContactId(p.contactId)}
              />
            ) : (
              <ReviewRow
                key={p.contactId}
                prospect={p}
                onTap={() => setOpenContactId(p.contactId)}
                onMarkVerified={() => handleMarkVerified(p.contactId)}
              />
            ),
          )}
        </div>
      )}

      {openProspect && (
        <ProspectModal
          prospect={openProspect}
          onClose={() => setOpenContactId(null)}
          onOutcomeRecorded={() => { load(); }}
        />
      )}
    </div>
  );
}
