export interface StaffAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface TodayAppointment {
  id: string;
  contactId: string;
  contactName: string;
  startTime: string;
  endTime: string;
  title: string;
  calendarName: string;
  sessionsRemaining: number;
  sessionsCompleted: number;
  seriesType: string;
  tags: string[];
  sessionPrepaid: boolean;
}

export interface ContactListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastAppointment: string | null;
  sessionsRemaining: number;
  seriesType: string;
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
  tags: string[];
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
}

export interface ContactAppointment {
  id: string;
  title: string;
  calendarName: string;
  startTime: string;
  endTime: string;
  status: string;
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

export type PartnerCategory = 'golf' | 'tennis' | 'trainer' | 'unknown';

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
  | 'booked'
  | 'deferred'
  | 'not-interested'
  // Off-platform touch signals — GHL doesn't track these natively.
  // Treated as touches (bumps count + last_signal_at, writes note) but never
  // change partner_stage on their own.
  | 'linkedin-msg'
  | 'linkedin-req'
  | 'instagram-msg'
  | 'in-person';

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
  email: string | null;
  website: string | null;
  /** Raw social profile string from Garrett's sheet — may be an IG handle
   *  (@handle), an Instagram URL, a Facebook page URL, or escaped text.
   *  Format with formatSocialProfile() before rendering. */
  socialProfile: string | null;
  /** LinkedIn profile URL — populated by enrichment (notes harvest + Sales Nav). */
  linkedinUrl: string | null;
  /** ISO timestamp of last GHL activity event (message in or out, note, etc.), or null if never touched. */
  lastActivityAt: string | null;
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
  // Joined from Garrett's SF Personal Trainers - Outreach sheet (cached server-side)
  sheetStatus: string | null;
  sheetNotes: string | null;
  inGarrettSheet: boolean;
}

export type PartnerStageFilter = 'all' | PartnerStage;

export interface PartnerProspectsResponse {
  generatedAt: string;
  sheetCachedAt?: string;
  /** When partner-activity-refresh Worker last ran (writes partner_last_real_activity).
   *  Null if KV is empty (worker never run) or unreadable. */
  activityRefreshAt?: string | null;
  /** "ok" or "error" from the last Worker run. */
  activityRefreshStatus?: string | null;
  total: number;
  verifiedCount: number;
  unverifiedCount: number;
  countsByCategory: Record<PartnerCategory, number>;
  countsByStage: Record<PartnerStage, number>;
  prospects: PartnerProspect[];
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
}

// Outcome capture payload (POST to staff-partner-outcome)
export interface PartnerOutcomeRequest {
  contactId: string;
  signal: PartnerLastSignal;
  note?: string;
  followupAt?: string;  // for `deferred` only — when to revisit
}

export interface PartnerProspectsResponse {
  generatedAt: string;
  total: number;
  countsByCategory: Record<PartnerCategory, number>;
  stages: PartnerPipelineStage[];
  prospects: PartnerProspect[];
}
