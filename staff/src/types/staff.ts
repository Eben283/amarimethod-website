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
  | 'cancellation-not-followed-up'
  | 'pre-session-text-owed'
  | 'next-booking-owed'
  | 'recently-completed'
  | 'data-drift'
  | 'too-soon'
  | 'recently-contacted-silent'
  | 'truly-cold'
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
