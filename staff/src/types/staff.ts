export interface StaffAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type CommunityRelationshipStage = 'host' | 'engaged_host' | 'partner' | 'workshop_opportunity';

export interface CommunityRelationship {
  id: string;
  business_name: string;
  location: string | null;
  study: string | null;
  flyer_location: string | null;
  contact: { name: string | null; role: string | null; phone: string | null; email: string | null } | null;
  relationship_stage: CommunityRelationshipStage;
  workshop_signal: boolean;
  next_visit_on: string | null;
  event_on: string | null;
  event_title: string | null;
  event_details: string | null;
  latest_note: string | null;
  latest_visit_at: string | null;
  visit_count: number;
  image_count: number;
}

export interface CommunityRelationshipImage {
  image_count: number;
  image_data_url: string | null;
}

// Per-session payment status, keyed per appointment (see functions/lib/session-payment.js).
export type PaymentStatus =
  | 'paid'
  | 'comped'
  | 'on-package'
  | 'pay-next-visit'
  | 'owed'
  | 'unknown';

export interface TodayAppointment {
  id: string;
  calendarId: string;
  contactId: string;
  contactName: string;
  startTime: string;
  endTime: string;
  title: string;
  calendarName: string;
  appointmentStatus?: string;
  sessionsRemaining: number;
  sessionsCompleted: number;
  seriesType: string;
  tags: string[];
  sessionPrepaid: boolean;
  paymentStatus?: PaymentStatus;
  paymentMethod?: string | null;
  paymentNote?: string | null;
  /** Video conference URL from the GHL appointment (Zoom/Google Meet). Null for in-person. */
  meetingLocation?: string | null;
  authority?: 'owned' | 'provider_mirror';
  providerSyncState?: 'not_required' | 'pending' | 'synced' | 'retryable' | 'manual_review';
  truthState?: 'authoritative' | 'propagating' | 'mirrored' | 'degraded';
  providerAppointmentId?: string | null;
}

export interface ContactListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastAppointment: string | null;
  sessionsRemaining: number;
  seriesType: string;
  /** Legacy 4/8 package clients tagged founders-circle. */
  isFoundersCircle?: boolean;
}

export interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  seriesType: string;
  sessionsCompleted: number;
  sessionsRemaining: number;
  sessionPrepaid: boolean;
  agreementSigned?: boolean;
  tags: string[];
  isFoundersCircle?: boolean;
  dateAdded: string;
  lastAppointment: string | null;
  appointments: ContactAppointment[];
  notes: ContactNote[];
  messages: ContactMessage[];
  quizResults: QuizResults | null;
  clientProgress: {
    modules: Record<string, boolean>;
    yogaBlockSize: '3' | '4' | null;
    bodyGraph: Record<string, 'active' | 'passive' | null>;
  } | null;
  // Ledger diagnostics — drive the warning icon + hover tooltip in the
  // client detail Session Progress card. Surfaces low-confidence
  // derivations, manual locks, and the displayed-vs-derived divergence.
  ledgerConfidence?: 'high' | 'low';
  ledgerAmbiguities?: string[];
  ledgerManualLock?: boolean;
  ledgerDisplaySource?: 'derived' | 'derived-matches-field' | 'manual-lock' | 'low-confidence-fallback' | 'empty';
  ledgerDerivedRemaining?: number;
  ledgerPurchased?: number | null;
  ledgerAttended?: number;
}

export interface ContactAppointment {
  id: string;
  calendarId: string;
  title: string;
  calendarName: string;
  startTime: string;
  endTime: string;
  status: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: string | null;
  paymentNote?: string | null;
}

export interface ContactNote {
  id: string;
  body: string;
  dateAdded: string;
}

export interface ContactMessage {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  dateAdded: string;
  type: string;
}

export interface ContactAutomationEvent {
  ts: number;
  engine: string | null;
  flowKey: string | null;
  definitionVersion?: number | null;
  contactId: string | null;
  appointmentId: string | null;
  stepIndex: number | null;
  action: string | null;
  outcome: string | null;
  displayOutcome?: string | null;
  channel: string | null;
  messageRef: string | null;
  family?: { key: string; name: string } | null;
  detail: Record<string, unknown> | null;
  evidence?: { source?: string; gaps?: AutomationEvidenceGap[] };
}

export interface ContactAutomationEnrollment {
  engine: string;
  key: string;
  enrollmentId: string;
  contactId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  providerContactId?: string | null;
  appointmentId?: string | null;
  definitionVersion?: number | null;
  startAt?: number | null;
  enteredAt: number | null;
  status: string;
  guardUnchecked?: boolean;
  family?: { key: string; name: string } | null;
  nextStep: {
    stepIndex: number;
    template: string | null;
    dueAt: number;
    type: string | null;
  } | null;
  evidence?: { source?: string; gaps?: AutomationEvidenceGap[] };
}

export interface ContactAutomationEvidence {
  success: boolean;
  configured: boolean;
  contactId?: string;
  enrollments?: ContactAutomationEnrollment[];
  events?: ContactAutomationEvent[];
  coverage?: { eventLimit: number; eventsTruncated: boolean };
  evidence?: { gaps?: AutomationEvidenceGap[] };
}

export interface AutomationEvidenceGap {
  code: string;
  label: string;
}

export interface AutomationSourceRecord {
  name: string;
  status: 'published' | 'draft';
  sourceSystem: 'external_workflow_inventory';
  evidenceKind: 'documented_record_metadata';
}

export interface AutomationOwnedStep {
  stepIndex: number;
  at?: string;
  after?: string;
  type?: string;
  kind?: string;
  template?: string | null;
  [key: string]: unknown;
}

export interface AutomationMessagePreviewNotice {
  stepIndex: number;
  audience: 'client' | 'internal';
  channel: 'email' | 'sms';
  from?: string;
  subject?: string;
  preheader?: string;
  body: string;
}

export interface AutomationMessagePreview {
  status: 'source_verified_read_only';
  label: string;
  notices: AutomationMessagePreviewNotice[];
}

export interface AutomationCutoverRequirement {
  code: string;
  status: 'proven' | 'blocked' | 'review';
  label: string;
  detail: string;
}

export interface AutomationCutoverReadiness {
  status: 'not_eligible' | 'active' | 'unknown';
  label: string;
  summary: string;
  requirements: AutomationCutoverRequirement[];
}

export interface AutomationOwnedDefinition {
  id: string;
  engine: 'reminder' | 'nurture' | 'morning-sms';
  key: string;
  name: string;
  definitionVersion: number;
  mode: string;
  authority?: 'executable_definition';
  trigger: Record<string, unknown>;
  agendaCopy?: {
    unavailable: string;
    empty: string;
    header: string;
    appointmentLine: string;
    footer: string;
  };
  exits: Array<Record<string, unknown>>;
  steps: Array<AutomationOwnedStep & { id?: string; parentId?: string | null; handler?: string; messageKind?: 'prepare' | 'meeting'; copy?: string; logic?: string[]; provider?: string; owner?: string; label?: string; at?: string; idempotency?: string }>;
  messagePreview?: AutomationMessagePreview;
  cutoverReadiness?: AutomationCutoverReadiness;
  source: { kind: 'owned_code'; path: string };
}

export interface AutomationFamily {
  key: string;
  name: string;
  lifecycle: 'platform' | 'acquisition' | 'sessions' | 'commerce' | 'partners' | 'studies' | 'archive';
  kind: 'operational' | 'evidence_only';
  operatingState: 'active' | 'in_person_live' | 'not_live';
  purpose: string;
  implementationUnits: string[];
  runtimeFlowKeys: string[];
  ownedDefinitionIds: string[];
  ownedDefinitions: AutomationOwnedDefinition[];
  sourceRecords: AutomationSourceRecord[];
  counts: {
    ownedDefinitions: number;
    sourceRecords: number;
    publishedSourceRecords: number;
    draftSourceRecords: number;
  };
  evidence: {
    definitionSource: string;
    executionHistoryImported: boolean;
    gaps: AutomationEvidenceGap[];
  };
  mapAuthority: 'executable_definition' | 'verified_operating_diagram' | 'not_mapped';
  cutoverTree?: AutomationCutoverTree;
}

export interface AutomationCutoverTreeNode {
  id: string;
  parentId: string | null;
  label: string;
  state: 'verified_ghl' | 'legacy_ghl' | 'owned_shadow' | 'owned_live' | 'proven_owned' | 'gap';
  evidence: string;
  detail: string;
}

export interface AutomationCutoverTree {
  status: 'draft_evidence_map' | 'live_workflow';
  title: string;
  summary: string;
  nodes: AutomationCutoverTreeNode[];
}

export interface AutomationInventorySummary {
  asOf: string;
  sourcePath: string;
  sourceRecords: number;
  publishedSourceRecords: number;
  draftSourceRecords: number;
  operationalFamilies: number;
  evidenceOnlyGroups: number;
  ownedDefinitions: number;
}

export interface AutomationFamiliesResponse {
  success: boolean;
  configured: boolean;
  registryVersion: number;
  summary: AutomationInventorySummary;
  families: AutomationFamily[];
  evidence: { gaps: AutomationEvidenceGap[] };
}

export interface AutomationFamilyResponse {
  success: boolean;
  configured: boolean;
  registryVersion: number;
  family: AutomationFamily;
  enrollments: ContactAutomationEnrollment[];
  events: ContactAutomationEvent[];
  coverage: { enrollmentsTruncated: boolean; eventsTruncated: boolean };
  runtime?: { verified: boolean; flows?: Array<{ verifiedAt?: string; flow?: { key: string; name: string; definitionVersion: number; configuredMode: string; delivery: 'active' | 'shadow' | 'disabled' | 'unpublished'; receiptCoverage?: { sms: 'terminal_status_reconciled'; email: 'provider_acceptance_only' } }; receiptHealth?: { status: 'healthy' | 'degraded'; checkedAt: string; checked: number; recorded: number; pending: number; errors: number; lookbackDays: number; batchLimit: number } | null; definition?: CanonicalWorkflow | null; versions?: Array<{ version: number; state: 'draft' | 'published' | 'retired'; created_at: number; published_at: number | null }> }> };
  evidence: { gaps: AutomationEvidenceGap[] };
}

export interface ReliabilitySourceEvent {
  source_event_id: string;
  provider: string;
  provider_event_id: string | null;
  occurred_at: number;
  received_at: number;
  authentication_result: 'authenticated' | 'rejected';
  normalization_state: 'normalized' | 'rejected' | 'ambiguous';
  state: 'accepted' | 'rejected';
  lifecycle_instance_id: string | null;
  lifecycle_state: string | null;
  obligation_count: number;
  open_exception_count: number;
}

export interface ReliabilityException {
  exception_id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  accountable_owner: string;
  next_safe_action: string;
  state: string;
  opened_at: number;
}

export interface ReliabilitySourceEventDetail {
  sourceEvent: ReliabilitySourceEvent & { normalized_json: string | null; identity_key: string; source_version: string; runtime_version: string };
  lifecycle: null | { lifecycle_instance_id: string; family: string; scope: string; person_id: string; appointment_id: string; definition_version: number; runtime_version: string; state: string };
  obligations: Array<{ obligation_id: string; obligation_key: string; kind: string; deadline_at: number; owner_role: string; closer: string; state: string }>;
  transitions: Array<{ source_transition_id: string; sequence: number; transition: 'received' | 'authenticated' | 'normalized' | 'accepted' | 'rejected' | 'deduplicated' | 'dispatched'; occurred_at: number; detail_json: string | null }>;
  exceptions: ReliabilityException[];
}

export interface ReliabilitySpineResponse {
  success: true;
  configured: boolean;
  family: 'follow-up-session-reminders' | 'no-show-missed-count';
  route: {
    accepted: Array<{ id: string; transition: 'received' | 'authenticated' | 'normalized' | 'accepted' | 'dispatched'; label: string; detail: string }>;
    rejected: { id: string; transition: 'rejected'; label: string; detail: string };
  };
  health: { truth: 'Known' | 'Unknown' | 'Degraded'; reason: string; checkedAt: number; coveredAt?: number; authority?: string; sourceVersion?: string; runtimeVersion?: string };
  sourceEvents: ReliabilitySourceEvent[];
  exceptions: ReliabilityException[];
  sourceEventDetail?: ReliabilitySourceEventDetail | null;
  sourceEventTotal?: number | null;
  exceptionTotal?: number;
  access?: 'evidence_control' | 'assigned_actions_only';
}

export interface CanonicalWorkflow {
  kind?: 'paid_booking';
  id: string;
  name: string;
  version: number;
  executionMode: string;
  trigger: Record<string, unknown>;
  exits: Array<{ event: string; effect: string; label: string }>;
  nodes: Array<{
    id: string;
    label: string;
    at?: string;
    timing?: string;
    operator?: string;
    kind?: string;
    skipIfPast?: boolean;
    when?: Record<string, unknown> | string;
    action?: { type: string; template?: string; target?: string };
    message?: { audience: string; channel: string; from?: string; subject?: string; preheader?: string; body: string };
  }>;
  booking?: { productId: string; defaultCalendarId: string; allowedCalendarIds: string[]; durationMinutes: number; sessionTitle: string };
  recovery?: { minimumAgeSeconds: number; maximumAgeMinutes: number; retryIntervalSeconds: number; maxPerCycle: number };
}

export interface QuizResults {
  patternSignature: string;
  recoveryPotentialScore: string | null;
  primaryPainLocation: string | null;
  painDuration: string | null;
  painIntensity: string | null;
  painTrigger: string | null;
  additionalPainAreas: string | null;
  painType: string | null;
  treatmentsTried: string | null;
  treatmentResults: string | null;
  aggravatingActivities: string | null;
  dailyImpact: string | null;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  category: 'operational' | 'conversational';
  hint?: string;
}

export interface ChecklistState {
  [itemId: string]: boolean;
}

export type ConversationFilter = 'needs_reply' | 'unread' | 'reach_out' | 'all';

export type OutreachStatus =
  | 'referral-never-booked'
  | 'cancellation-not-followed-up'
  | 'pre-session-text-owed'
  | 'next-booking-owed'
  | 'recently-completed'
  | 'data-drift'
  | 'too-soon'
  | 'recently-contacted-silent'
  | 'truly-cold'
  | 'partner-no-referrals'
  | 'engaged';

export type OutreachBucket =
  | 'partner-active'
  | 'partner-pending'
  | 'partner-future'
  | 'mid-pack'
  | 'lapsed-initial'
  | 'lapsed-long'
  | 'other';

export interface OutreachAction {
  label: string;
  type: 'primary' | 'secondary' | 'destructive';
  reason: string;
}

export interface OutreachMessage {
  date: string;
  channel: 'sms' | 'email';
  body: string;
}

export interface OutreachAppointment {
  date: string;
  status: string;
  title: string;
}

export interface OutreachCard {
  contactId: string;
  name: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  bucket: OutreachBucket;
  pipelineStage: string | null;
  seriesType: string | null;
  sessionsCompleted: number | null;
  sessionsRemaining: number | null;
  totalSpend: number;
  clientReferralCount: number;
  referralSource: string | null;
  isReferral: boolean;
  lastAppointment: OutreachAppointment | null;
  nextAppointment: OutreachAppointment | null;
  cancelledAppointment: { date: string; title: string } | null;
  lastOutbound: OutreachMessage | null;
  lastInbound: OutreachMessage | null;
  daysSinceLastOutbound: number | null;
  daysSinceLastInbound: number | null;
  recommendation: {
    headline: string;
    status: OutreachStatus;
    priority: number;
    actions: OutreachAction[];
    suggestedTemplate: string | null;
  };
}

export interface OutreachSnapshotResponse {
  generatedAt: string | null;
  uploadedAt: string | null;
  counts: {
    total: number;
    byStatus?: Record<string, number>;
    byBucket?: Record<string, number>;
  };
  cards: OutreachCard[];
}

export interface ConversationSummary {
  id: string;
  contactId: string;
  contactName: string;
  email: string;
  phone: string;
  lastMessagePreview: string;
  lastMessageDate: string | null;
  lastMessageType: string;
  lastMessageDirection: 'inbound' | 'outbound';
  unreadCount: number;
  needsReply: boolean;
  assignedTo: string | null;
}

export interface ConversationsResponse {
  filter: ConversationFilter;
  total: number;
  conversations: ConversationSummary[];
}

export interface BalanceRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  seriesType: string;
  purchased: number | null;
  attended: number;
  remaining: number;
  lastSessionDate: string | null;
  prepaidOverride: boolean;
  source: string;
  confidence: 'high' | 'low';
  ambiguities: string[];
  manualLock?: boolean;
  displaySource?: 'derived' | 'derived-matches-field' | 'manual-lock' | 'low-confidence-fallback' | 'empty';
}

export interface BalancesResponse {
  generatedAt: string;
  count: number;
  totalRemaining: number;
  ledgerSource: 'session-ledger' | 'custom-field-fallback';
  rows: BalanceRow[];
}

// Partner outreach workspace
//
// v1: Queue view + Modal detail. Reads from new GHL custom fields
// (created 2026-05-23 — see ops/ref/partner-custom-fields-2026-05-22.json).
// Pipeline-stage-based kanban (v0) was abandoned per design doc.

export type PartnerCategory = 'golf' | 'tennis' | 'trainer' | 'business' | 'therapist' | 'unknown';

export type PartnerCategoryFilter = 'all' | PartnerCategory;

export type PartnerStage =
  | 'no-outreach'
  | 'working'
  | 'session-booked'
  | 'partner'
  | 'future-potential'
  | 'dropped';

export type PartnerSource =
  | 'cold-call'
  | 'walk-in'
  | 'dm'
  | 'referral'
  | 'inbound'
  | 'sheet';

export type PartnerLastSignal =
  | 'no-answer'
  | 'voicemail'
  | 'talked'
  | 'link-sent'
  // App-sent touches — Garrett composed + sent a text/email from the card.
  // Recorded so the engine sees the send (bumps count + last_signal_at, promotes
  // no-outreach→working). Only ever set from the in-app Send buttons.
  | 'texted'
  | 'emailed'
  | 'booked'
  | 'deferred'
  | 'not-interested'
  // Off-platform touch signals — GHL doesn't track these natively.
  // Treated as touches (bumps count + last_signal_at, writes note) but never
  // change partner_stage on their own.
  | 'linkedin-msg'
  | 'linkedin-req'
  | 'instagram-msg'
  | 'in-person'
  // Disposition without outreach — "wrong fit / wrong geography, won't pursue."
  // Different from 'not-interested' (they declined). Sets partner_stage=dropped
  // but does NOT set partner_last_signal/partner_last_signal_at/touch_count —
  // we never actually contacted them. Only used as the input to the outcome
  // endpoint; never persisted as a partner_last_signal value.
  | 'skip'
  // Note-only save — the user typed a note but recorded no outcome. Writes a
  // GHL "Note: …" entry and nothing else (no stage/signal/touch change).
  // Like 'skip', only an outcome-endpoint input; never persisted as a value.
  | 'note';

// Matches the existing GHL "Facility Type" field options.
export type PartnerFacilityType =
  | 'Independent'
  | 'Boutique'
  | 'Corporate'
  | 'Online/Mobile';

// Matches the existing GHL "Facility Role" field options.
export type PartnerFacilityRole =
  | 'Owner'
  | 'Manager'
  | 'Trainer'
  | 'Physical Therapist'
  | 'Front Desk'
  | 'Other';

// Matches the existing GHL "Has PT On Staff" field options.
export type HasPtOnStaff = 'Yes' | 'No' | 'Unknown';

export interface PartnerProspect {
  contactId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  category: PartnerCategory;
  tags: string[];
  phone: string | null;
  // Phone line type from the AbstractAPI sweep (KV contact:linetype) — "mobile" |
  // "landline" | "voip" | "toll_free" | "unknown" | null (unclassified). The UI
  // suppresses SMS to landline/toll_free/voip (switchboards that can't text).
  phoneType?: string | null;
  // GHL marked this contact as SMS DND (dndSettings.SMS.status === 'active') —
  // either they replied STOP or a previous text bounced (VoIP misclassified as mobile).
  textDnd?: boolean;
  email: string | null;
  website: string | null;
  /** Standard GHL contact fields populated from enrichment (May 2026) — were
   *  empty for most prospects pre-enrichment. */
  companyName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** Raw social profile string from Garrett's sheet — may be an IG handle
   *  (@handle), an Instagram URL, a Facebook page URL, or escaped text.
   *  Format with formatSocialProfile() before rendering. */
  socialProfile: string | null;
  /** LinkedIn profile URL — populated by enrichment (notes harvest + Sales Nav). */
  linkedinUrl: string | null;
  /** Instagram handle (`@name`) or full URL. Independent of socialProfile
   *  (which only exists for sheet-tracked prospects — partners aren't in the sheet). */
  instagram: string | null;
  /** Other URLs surfaced during web enrichment — semicolon-separated. UI splits
   *  on `;` and renders each as a clickable link. */
  otherUrls: string | null;
  /** 1–3 sentence rundown of who this person is (from audit/enrichment pipeline). */
  rundown: string | null;
  /** ISO timestamp of last GHL activity event (message in or out, note, etc.), or null if never touched. */
  lastActivityAt: string | null;
  /** Positive series/session evidence means this person is or was a client and
   *  must stay in People rather than new-client Outreach. */
  hasClientEvidence?: boolean;
  /** Active partner = already did the Partner Session (tag `affiliate-partner`). */
  isActivePartner: boolean;
  // New Partner custom fields (may all be null until migration runs):
  partnerStage: PartnerStage | null;
  partnerSource: PartnerSource | null;
  partnerLastSignal: PartnerLastSignal | null;
  partnerLastSignalAt: string | null;
  partnerFollowupAt: string | null;
  // Existing facility / context fields (Trainer Outreach group):
  partnerFacility: string | null;             // Trainer Facility
  partnerFacilityType: PartnerFacilityType | null;
  partnerFacilityRole: PartnerFacilityRole | null;
  hasPtOnStaff: HasPtOnStaff | null;
  outreachVerified: boolean;
  /** Number of outbound outreach actions for this contact (backfilled from /conversations,
   *  incremented on every recorded outcome). 0 if never touched or backfill hasn't run. */
  touchCount: number;
  /** Server-computed Act-Now decision (engine-merge 2026-06-14). The UI prefers this
   *  over its local derive() so there is ONE due-decision shared with the coach
   *  pipeline. Optional during rollout — UI falls back to local derive() if absent. */
  derived?: {
    kind: 'act' | 'waiting' | 'aside' | 'converted';
    urgency: number;
    why: string;
    action: 'call' | 'text' | 'reback' | 'decide' | 'discovery' | null;
    channel?: string;
    asideReason?: string;
    state?: 'cold' | 'engaged' | 'talked';
    play?: 'pitch' | 'discovery';
  };
  // Joined from Garrett's SF Personal Trainers - Outreach sheet (cached server-side)
  sheetStatus: string | null;
  sheetNotes: string | null;
  inGarrettSheet: boolean;
  /** Human-readable stage badge computed server-side from cadence state + partner_stage.
   *  Examples: "New", "Touch 2 of 6", "Warm · Touch 1 of 4", "Reply Waiting", "Breakup". */
  stageLabel?: string | null;
  /** One-line call-coach summary for the collapsed card row (actionLine or first 100 chars of summary).
   *  Null if no coached call exists for this contact. */
  callCoachLine?: string | null;
}

export type PartnerStageFilter = 'all' | PartnerStage;

export interface PartnerProspectsResponse {
  generatedAt: string;
  sheetCachedAt?: string;
  sheetRefreshError?: string | null;
  /** When partner-activity-refresh Worker last ran (writes partner_last_real_activity).
   *  Null if KV is empty (worker never run) or unreadable. */
  activityRefreshAt?: string | null;
  /** "ok" or "error" from the last Worker run. */
  activityRefreshStatus?: string | null;
  /** When the coach worker last refreshed the eligibility overlay (ISO). The UI
   *  shows a stale-data banner if this is old. Null if the worker never ran. */
  coachDataAt?: string | null;
  total: number;
  verifiedCount: number;
  unverifiedCount: number;
  countsByCategory: Record<PartnerCategory, number>;
  countsByStage: Record<PartnerStage, number>;
  prospects: PartnerProspect[];
  /** Persisted reply dismissals: { [contactId]: lastMessageDate }. A dismissal only hides
   *  the reply card when lastMessageDate matches — new messages auto-un-dismiss. */
  dismissedReplies?: Record<string, string | null>;
}

// Activity timeline event (returned by staff-partner-activity endpoint, lazy-loaded per contact)
export interface PartnerActivityEvent {
  date: string;          // ISO timestamp
  type: 'call' | 'sms' | 'email' | 'signal' | 'note' | 'appointment';
  // For signal events:
  signal?: PartnerLastSignal;
  // For note + appointment events:
  body?: string;
  // For all:
  direction?: 'inbound' | 'outbound';
  // For call events: raw outcome (failed / no-answer / completed / voicemail / …).
  // `body` carries the human label ("failed", "2m 14s"); this lets the UI color a miss.
  callStatus?: string;
}

// Outcome capture payload (POST to staff-partner-outcome)
export interface PartnerOutcomeRequest {
  contactId: string;
  signal: PartnerLastSignal;
  note?: string;
  followupAt?: string;  // for `deferred` only — when to revisit
}

// ── Study capture — per-participant intake + before/after pain (staff-study).
// Shared shape across elbow / jaw / foot / hand. Field names `arm` + `gameImpact`
// are legacy (elbow KV); the staff UI labels them per study via the registry.
export interface ElbowStudySession {
  before: number | null;
  after: number | null;
  notes: string;
  at: string | null;
}

// One filling of the validated survey: a map of {instrument item id → 0-10}.
// `baseline` is taken before session 1, `final` after session 3 (or 1-week
// follow-up). This is the outcome the case series is published on.
export interface InstrumentSnapshot {
  responses: Record<string, number | null>;
  at: string | null;
}

export interface ElbowStudyRecord {
  arm: 'left' | 'right' | 'both' | null;
  painWeeks: number | null;
  gameImpact: string;
  baseline: InstrumentSnapshot;
  final: InstrumentSnapshot;
  sessions: ElbowStudySession[];
  updatedAt: string;
}

/** Alias — same record shape for all studies. */
export type StudyCaptureRecord = ElbowStudyRecord;
export type StudyCaptureSession = ElbowStudySession;

// ── Field table studies — the six answers begin on paper, then are entered
// privately by staff. This is intentionally separate from the existing
// generalized study instrument capture above.
export interface FieldStudyBaseline {
  discomfortNow: number | null;
  worstPastSevenDays: number | null;
  easierActivity: string;
  activityDifficulty: number | null;
  dayLimit: number | null;
  activityAvoidance: number | null;
  bodyLocations: string[];
  capturedAt: string | null;
}

export interface FieldStudyBookedSession {
  id: string;
  startTime: string;
  status: string;
}

export interface FieldStudyParticipant {
  id: string;
  paperId: string;
  paperDate?: string;
  contactId: string;
  fieldStudyKey: string;
  studySlug: string;
  studyLabel: string;
  studyName: string;
  source: 'field-table';
  firstSessionCompleted: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  canUseFirstName: boolean;
  afterSessionOnePain: number | null;
  participantQuote: string;
  baseline: FieldStudyBaseline | null;
  /** Live from the Amari Study calendar — not a staff-entered guess. */
  bookedSessions?: FieldStudyBookedSession[];
  bookingStatus?: 'loaded' | 'unavailable';
  createdAt: string;
  updatedAt: string;
}

export interface FieldStudyQueueItem {
  id: string;
  paperId: string;
  fieldStudyKey?: string;
  studyName: string;
  studyLabel?: string;
  firstName: string;
  createdAt: string;
  firstSessionCompleted: boolean;
  afterSessionOnePain: number | null;
  baselineCapturedAt: string | null;
  bookedSessions?: FieldStudyBookedSession[];
  bookingStatus?: 'loaded' | 'unavailable';
}
