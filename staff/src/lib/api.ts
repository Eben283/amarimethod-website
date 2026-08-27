const API_BASE = '/api';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(errorData.error || 'Request failed', response.status);
    }

    return response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function staffLogin(pin: string): Promise<{ authenticated: boolean; user: string }> {
  return fetchApi('/staff-auth', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export type CommunicationChannel = 'in_app' | 'email' | 'sms';
export type CommunicationCadence = 'immediate' | 'digest';
export type CommunicationChannelStatus = 'live' | 'surface_only' | 'not_wired';

export interface CommunicationCategoryPreference {
  enabled: boolean;
  cadence: CommunicationCadence;
  channels: Record<CommunicationChannel, boolean>;
}

export interface TeamCommunicationPreferences {
  version: number;
  timezone: string;
  quietHours: { enabled: boolean; start: string; end: string };
  categories: Record<string, CommunicationCategoryPreference>;
  escalation: {
    enabled: boolean;
    afterMinutes: number;
    fallbackChannel: 'sms' | 'email' | null;
    fallbackStaff: string | null;
  };
}

export interface CommunicationCurrentRoute {
  id: string;
  label: string;
  description: string;
  currentOwner: string;
  currentCadence: CommunicationCadence;
  currentRoute: string;
  channels: Record<CommunicationChannel, CommunicationChannelStatus>;
}

export interface ExternalCommunicationRoute {
  id: string;
  label: string;
  currentRoute: string;
  controlStatus: 'external';
}

export interface TeamCommunicationPreferencesResponse {
  success: true;
  user: string;
  preferences: TeamCommunicationPreferences;
  saved: boolean;
  storageAvailable: boolean;
  updatedAt: string | null;
  appliedToDelivery: false;
  deliveryControlStatus: 'foundation_only';
  currentRoutes: CommunicationCurrentRoute[];
  externalRoutes: ExternalCommunicationRoute[];
}

export async function getTeamCommunicationPreferences(): Promise<TeamCommunicationPreferencesResponse> {
  return fetchApi('/staff-communication-preferences');
}

export async function saveTeamCommunicationPreferences(preferences: TeamCommunicationPreferences): Promise<TeamCommunicationPreferencesResponse> {
  return fetchApi('/staff-communication-preferences', {
    method: 'PUT',
    body: JSON.stringify({ preferences }),
  });
}

export async function getDayData(date?: string, endDate?: string, includeCancelled?: boolean): Promise<import('../types/staff').TodayAppointment[]> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (endDate) params.set('endDate', endDate);
  if (includeCancelled) params.set('includeCancelled', '1');
  const qs = params.toString();
  return fetchApi(`/staff-data${qs ? `?${qs}` : ''}`);
}

export async function getCalendarSummary(date: string, endDate?: string): Promise<import('../types/staff').TodayAppointment[]> {
  const params = new URLSearchParams({ date, summary: '1' });
  if (endDate) params.set('endDate', endDate);
  return fetchApi(`/staff-data?${params}`);
}

export interface StaffAppointmentSlot {
  date: string;
  hour: number;
  minute: number;
  datetime: string;
  source: 'garrett_internal_schedule';
}

export interface StaffAppointmentAvailability {
  appointment: { id: string; title: string; startTime: string; calendarName: string } | null;
  service?: { id: string; label: string; durationMinutes: number } | null;
  slots: StaffAppointmentSlot[];
  timezone: string;
  source: 'garrett_internal_schedule';
  publicRestrictionsApplied: false;
  guidance: string;
}

export interface StaffAppointmentCommandResult {
  status: 'completed';
  action: 'schedule' | 'cancel' | 'reschedule';
  actor: 'Eben' | 'Garrett';
  appointmentId: string;
  replacementAppointmentId?: string;
  contactId: string;
  previousStartTime?: string;
  newStartTime?: string;
  appointmentStatus: string;
  reminderVerification: 'pending_event_evidence';
}

export async function getStaffAppointmentAvailability(input: {
  contactId?: string;
  appointmentId?: string;
  sessionType?: string;
  startDate: string;
  endDate: string;
}): Promise<StaffAppointmentAvailability> {
  return fetchApi('/staff-appointments', {
    method: 'POST',
    body: JSON.stringify({ action: 'availability', ...input }),
  });
}

export interface StaffAppointmentType {
  id: string;
  label: string;
  durationMinutes: number;
}

export async function getStaffAppointmentTypes(): Promise<{ types: StaffAppointmentType[] }> {
  return fetchApi('/staff-appointments', {
    method: 'POST',
    body: JSON.stringify({ action: 'list-types' }),
  });
}

export async function scheduleStaffAppointment(input: {
  contactId: string;
  sessionType: string;
  startTime: string;
  idempotencyKey: string;
}): Promise<StaffAppointmentCommandResult> {
  return fetchApi('/staff-appointments', {
    method: 'POST',
    body: JSON.stringify({ action: 'schedule', ...input }),
  });
}

export async function changeStaffAppointment(input: {
  action: 'cancel' | 'reschedule';
  contactId: string;
  appointmentId: string;
  idempotencyKey: string;
  startTime?: string;
}): Promise<StaffAppointmentCommandResult> {
  return fetchApi('/staff-appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type StaffCalendarReadiness = 'ready' | 'attention' | 'legacy' | 'specialist';

export interface StaffCalendarDefinition {
  id: string;
  key: string;
  name: string;
  group: 'sessions' | 'discovery' | 'studies';
  lifecycle: 'current' | 'legacy' | 'specialist';
  location: string;
  durationMinutes: number | null;
  intervalMinutes: number | null;
  bufferMinutes: number | null;
  bookingOwner: string;
  paymentOwner: string;
  appointmentStore: string;
  remindersOwner: string;
  publicPath?: string | null;
  staffBookable: boolean;
  readiness: StaffCalendarReadiness;
  readinessNote: string;
  timezone: string;
}

export interface StaffCalendarRegistry {
  source: 'owned-registry';
  timezone: string;
  editable: false;
  editingBoundary: string;
  groups: Array<{ id: 'sessions' | 'discovery' | 'studies'; label: string; count: number }>;
  calendars: StaffCalendarDefinition[];
  workHours: {
    timezone: string;
    weekdays: string[];
    openFrom: string;
    openTo: string;
    firstSessionStart: string;
    lastSessionStart: string;
  } | null;
}

export async function getStaffCalendars(): Promise<StaffCalendarRegistry> {
  return fetchApi('/staff-calendars');
}

export interface AppointmentProjectionReadiness {
  configured: boolean;
  shadowOnly: true;
  state: 'ready' | 'attention' | 'unavailable';
  generatedAt: string;
  liveScheduleFallback: true;
  reason?: string;
  coverage?: { observationsRead: number; totalObservations: number; truncated: boolean };
  reconciliation?: {
    summary: {
      appointments: number;
      observations: number;
      conflicts: number;
      historyGaps: number;
      stateCounts: Record<'matched' | 'baseline' | 'unobserved' | 'mismatch' | 'orphaned', number>;
    };
    records: Array<{
      providerAppointmentId: string;
      state: 'matched' | 'baseline' | 'unobserved' | 'mismatch' | 'orphaned';
      historyComplete: boolean;
      status: string;
      startsAt: string | null;
      endsAt: string | null;
      timezone: string | null;
      observationCount: number;
      issueCodes: string[];
    }>;
    issues: Array<{ code: string; providerAppointmentId?: string }>;
  };
  bufferPolicy: {
    state: 'confirmed';
    runtimeAppOwnedMinutes: 20;
    historicalDocumentedMinutes: 10;
    blocksWriteAuthority: false;
    note: string;
  };
}

export async function getAppointmentProjectionReadiness(): Promise<AppointmentProjectionReadiness> {
  return fetchApi('/staff-appointment-readiness');
}

export type OpsSystemSummary = {
  id: string;
  label: string;
  state: string;
  status: string;
  group?: string;
  note?: string | null;
};

export type OpsSystemsBoard = {
  overall: 'green' | 'red' | 'unknown';
  attentionCount: number;
  generatedAt: string;
  systems: OpsSystemSummary[];
};

export async function getOpsSystemsBoard(): Promise<OpsSystemsBoard> {
  return fetchApi('/ops/systems');
}

/**
 * Safe, Staff-facing projection of the operations ledger.
 *
 * The API intentionally returns operational metadata only. In particular,
 * these types have no contact/person, message, or provider-payload fields.
 */
export type OpsLedgerActivity = {
  id: string;
  taskId: string;
  taskLabel: string;
  actor: string;
  requestedBy: string;
  outcome: 'completed' | 'failed' | 'blocked' | 'in_progress' | 'unknown' | string;
  at: string | null;
  counts: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
  };
};

export type OpsLedgerChange = {
  id: string;
  taskId: string | null;
  taskLabel: string | null;
  kind: 'release' | 'config' | string;
  label: string;
  from: string | null;
  to: string | null;
  verification: string | null;
  rollback: string | null;
  at: string | null;
};

export type OpsLedgerIncident = {
  id: string;
  status: 'open' | 'resolved' | string;
  severity: 'low' | 'medium' | 'high' | 'critical' | string;
  title: string;
  taskId: string | null;
  taskLabel: string | null;
  releaseId: string | null;
  releaseLabel: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
};

export type OpsLedger = {
  generatedAt: string;
  activity: OpsLedgerActivity[];
  changes: OpsLedgerChange[];
  incidents: OpsLedgerIncident[];
};

export async function getOpsLedger(): Promise<OpsLedger> {
  return fetchApi('/staff-operations-ledger');
}

export type StaffAmariMailReadiness = {
  actor: 'Eben' | 'Garrett';
  mailbox: string;
  oauthConfigured: boolean;
  configurationStatus: 'configured' | 'unconfigured';
  connectionStatus: 'unconfigured' | 'absent' | 'invalid' | 'verified';
  grantPresent: boolean;
  grantConnected: boolean;
  grantVerified: boolean;
  profileReady: boolean;
  scopesReady: boolean;
  sendAsReady: boolean;
  credentialReady: boolean;
  deliveryEnabled: false;
  replySyncEnabled: false;
  fallbackProvider: null;
  blockers: string[];
};

export async function getStaffAmariMailReadiness(): Promise<StaffAmariMailReadiness> {
  return fetchApi('/staff-amari-mail-auth');
}

export async function startStaffAmariMailAuthorization(): Promise<{ authorizationUrl: string; deliveryEnabled: false }> {
  return fetchApi('/staff-amari-mail-auth', { method: 'POST' });
}

export type GmailReplySyncGapReason =
  | 'provider_message_missing'
  | 'body_truncated'
  | 'metadata_truncated'
  | 'metadata_unusable';

export interface StaffGmailReplyReadiness {
  actor: 'Eben' | 'Garrett';
  mailbox: string;
  state: 'no_baseline' | 'quiet' | 'review';
  replySyncEnabled: false;
  checkpoint: { historyId: string; observedAt: string } | null;
  syncGaps: Array<{
    messageId: string;
    historyId: string;
    reason: GmailReplySyncGapReason;
    observedAt: string;
  }>;
}

export async function getStaffGmailReplyReadiness(): Promise<StaffGmailReplyReadiness> {
  return fetchApi('/staff-gmail-reply-readiness');
}

export async function searchContacts(query: string): Promise<import('../types/staff').ContactListItem[]> {
  return fetchApi(`/staff-contacts?query=${encodeURIComponent(query)}`);
}

export interface OwnedContactSearchItem {
  id: string;
  providerContactId: string | null;
  name: string;
  email: string;
  phone: string;
}

export async function searchOwnedContacts(query: string): Promise<OwnedContactSearchItem[]> {
  return fetchApi(`/staff-owned-contacts?query=${encodeURIComponent(query)}`);
}

export async function setFoundersCircle(
  contactId: string,
  action: 'add' | 'remove',
): Promise<{ success: boolean; isFoundersCircle: boolean }> {
  return fetchApi('/staff-founders-circle', {
    method: 'POST',
    body: JSON.stringify({ contactId, action }),
  });
}

export async function getContactDetail(
  id: string,
  debug = false,
): Promise<import('../types/staff').ContactDetail & { _debug?: unknown }> {
  return fetchApi(`/staff-contact?id=${encodeURIComponent(id)}${debug ? '&debug=1' : ''}`);
}

export async function getContactAutomationEvidence(
  contactId: string,
): Promise<import('../types/staff').ContactAutomationEvidence> {
  return fetchApi(`/staff-automations?view=contact&contactId=${encodeURIComponent(contactId)}`);
}

export async function getAutomationFamilies(): Promise<import('../types/staff').AutomationFamiliesResponse> {
  return fetchApi('/staff-automations?view=families');
}

export async function getAutomationFamily(
  key: string,
): Promise<import('../types/staff').AutomationFamilyResponse> {
  const detail = await fetchApi<import('../types/staff').AutomationFamilyResponse>(`/staff-automations?view=family&key=${encodeURIComponent(key)}`);
  if (key !== 'initial-session-reminders') return detail;
  const enrollments = await Promise.all(detail.enrollments.map(async (enrollment) => {
    if (enrollment.contactName && enrollment.contactPhone) return enrollment;
    const reference = enrollment.providerContactId || enrollment.contactId;
    if (!reference) return enrollment;
    try {
      const matches = await searchOwnedContacts(reference);
      const person = matches.find((candidate) => candidate.providerContactId === enrollment.providerContactId || candidate.id === enrollment.contactId) || matches[0];
      return person ? { ...enrollment, contactId: person.id, providerContactId: person.providerContactId, contactName: person.name, contactPhone: person.phone } : enrollment;
    } catch { return enrollment; }
  }));
  return { ...detail, enrollments };
}

export async function getReliabilitySpine(family = 'follow-up-session-reminders', sourceEventId?: string): Promise<import('../types/staff').ReliabilitySpineResponse> {
  const suffix = sourceEventId ? `&sourceEventId=${encodeURIComponent(sourceEventId)}` : '';
  return fetchApi(`/staff-automations?view=reliability&family=${encodeURIComponent(family)}${suffix}`);
}

export async function saveAutomationWorkflowDraft(document: import('../types/staff').CanonicalWorkflow): Promise<{ success: true; document: import('../types/staff').CanonicalWorkflow; publishedVersion: number }> {
  return fetchApi('/staff-automations?view=workflow-draft', { method: 'POST', body: JSON.stringify({ document }) });
}

export async function publishAutomationWorkflow(workflowId: string, version: number, expectedPublishedVersion: number): Promise<{ success: true; document: import('../types/staff').CanonicalWorkflow }> {
  return fetchApi('/staff-automations?view=workflow-publish', { method: 'POST', body: JSON.stringify({ workflowId, version, expectedPublishedVersion }) });
}

export async function addNote(contactId: string, body: string): Promise<{ success: boolean }> {
  return fetchApi('/staff-note', {
    method: 'POST',
    body: JSON.stringify({ contactId, body }),
  });
}

export async function updateNote(contactId: string, noteId: string, body: string): Promise<{ success: boolean }> {
  return fetchApi('/staff-note', {
    method: 'PUT',
    body: JSON.stringify({ contactId, noteId, body }),
  });
}

export interface MarkAttendedResult {
  success: boolean;
  alreadyAttended: boolean;
  appointmentUpdated: boolean;
  sessionCountUpdated: boolean;
  isSession: boolean;
  sessionsCompleted: number;
  sessionsRemaining: number;
  paymentRecorded?: boolean;
}

export interface PaymentCapture {
  paymentStatus?: string;
  paymentMethod?: string | null;
  compNote?: string | null;
}

export async function markAttended(
  appointmentId: string,
  contactId: string,
  appointmentTitle: string,
  calendarName?: string,
  payment?: PaymentCapture,
): Promise<MarkAttendedResult> {
  return fetchApi('/staff-mark-attended', {
    method: 'POST',
    body: JSON.stringify({
      appointmentId,
      contactId,
      appointmentTitle,
      calendarName: calendarName || '',
      ...(payment?.paymentStatus ? { paymentStatus: payment.paymentStatus } : {}),
      ...(payment?.paymentMethod ? { paymentMethod: payment.paymentMethod } : {}),
      ...(payment?.compNote ? { compNote: payment.compNote } : {}),
    }),
  });
}

export interface PurchaseEntry {
  date: string | null;
  amount: number;
  label: string;
}

export interface OwedStatus {
  status: 'owed' | 'square' | 'paid-legacy' | 'unavailable';
  name?: string | null;
  purchases?: PurchaseEntry[];
  shortBy?: number | null;
  confidence?: 'high' | 'medium';
  reason?: string;
  totalPaid?: number;
  sessionsPurchased?: number;
  attendedBillable?: number;
  unknownCount?: number;
  chargeCount?: number;
}

export async function getOwedStatus(contactId: string): Promise<OwedStatus> {
  return fetchApi(`/staff-owed?contactId=${encodeURIComponent(contactId)}`);
}

export interface OwedRosterRow {
  contactId: string;
  name: string;
  attendedBillable: number;
  lastSessionMs?: number;
}

export interface OwedListResponse {
  roster: OwedRosterRow[];
  rosterSize?: number;
  windowDays?: number;
}

// Lightweight active-client roster (no Stripe). The page resolves each one's
// owed status via getOwedStatus separately (see staff-owed-list.js rationale).
export async function getOwedList(): Promise<OwedListResponse> {
  return fetchApi('/staff-owed-list');
}

// A roster row enriched with its resolved owed status.
export type OwedRow = OwedRosterRow & OwedStatus;

export async function saveProgress(
  contactId: string,
  progress: { modules: Record<string, boolean>; yogaBlockSize: string | null; bodyGraph: Record<string, string | null> },
): Promise<{ success: boolean }> {
  return fetchApi('/staff-save-progress', {
    method: 'POST',
    body: JSON.stringify({ contactId, progress }),
  });
}

export async function sendToolkit(contactId: string): Promise<{ success: boolean }> {
  return fetchApi('/staff-send-toolkit', {
    method: 'POST',
    body: JSON.stringify({ contactId }),
  });
}

export type PayLinkProduct =
  | '6-week-practice'
  | '12-week-practice'
  | 'initial-in-person'
  | 'initial-virtual'
  | '4-session-series'
  | '8-session-series'
  | 'upgrade-initial-to-4'
  | 'upgrade-initial-to-8'
  | 'upgrade-4-to-8'
  | 'living-practice'
  | 'follow-up';

export async function sendPayLink(
  contactId: string,
  product: PayLinkProduct,
): Promise<{ success: boolean; product: PayLinkProduct }> {
  return fetchApi('/staff-send-paylink', {
    method: 'POST',
    body: JSON.stringify({ contactId, product }),
  });
}

export interface StripeSavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export async function getStripeSavedCards(contactId: string): Promise<{ available: boolean; reason?: string | null; cards: StripeSavedCard[] }> {
  return fetchApi(`/staff-stripe-cards?contactId=${encodeURIComponent(contactId)}`);
}

export async function createStripeCheckout(
  contactId: string,
  offer: PayLinkProduct,
): Promise<{ checkout: { id: string; url: string; expiresAt: number | null } }> {
  return fetchApi('/staff-create-stripe-checkout', {
    method: 'POST',
    body: JSON.stringify({ contactId, offer }),
  });
}

// ── Staff POS sales ─────────────────────────────────────────────────────────
// Durable drafts + Stripe Checkout Session creation per payment leg.
export type PosPaymentMethod = 'saved-card' | 'manual-card' | 'hsa-card' | 'checkout-link' | 'cash' | 'other';
export type PosSaleStatus = 'draft' | 'awaiting_payment' | 'partially_paid' | 'paid';
export type PosLegStatus = 'planned' | 'checkout_open' | 'paid' | 'failed';

export interface PosClient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isFoundersCircle?: boolean;
}

export interface PosDraftLineInput {
  productKey?: string;
  quantity?: number;
  customLabel?: string;
  customReason?: string;
  customAmountCents?: number;
}

export interface PosPaymentLegInput {
  method: PosPaymentMethod;
  amountCents: number;
}

export interface PosPaymentLeg {
  id: string;
  method: PosPaymentMethod;
  amountCents: number;
  status: PosLegStatus;
  stripeCheckoutSessionId?: string | null;
  stripeCheckoutUrl?: string | null;
  stripePaymentIntentId?: string | null;
  cashReceivedCents?: number | null;
  paidAt?: string | null;
}

export interface PosSale {
  id: string;
  status: PosSaleStatus;
  version: number;
  client: PosClient;
  cart: Array<{ kind: 'catalog' | 'custom'; productKey: string | null; productVersion?: number | null; label: string; reason?: string; quantity: number; unitAmountCents: number; lineTotalCents: number; fulfillmentPolicy?: 'provider-linked' | 'none' | 'session-credit' | 'living-practice-access' }>;
  totalCents: number;
  paymentLegs: PosPaymentLeg[];
  fulfillmentStatus?: string | null;
  fulfillmentError?: string | null;
  fulfilledAt?: string | null;
  fulfillment?: {
    remaining?: number;
    seriesType?: string | null;
    notes?: string[];
    packagePurchased?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
  audit: Array<{ at: string; actor: string; action: string; detail: string }>;
}

export interface PosTextPreview {
  recipient: string;
  amountCents: number;
  message: string;
  sendingEnabled: false;
}

export interface PosCheckoutOpen {
  legId: string;
  url: string;
  sessionId: string;
}

export type StaffProductPolicy = 'current' | 'legacy' | 'custom';
export interface StaffProduct {
  key: string;
  version: number;
  name: string;
  amountCents: number;
  currency: 'USD';
  category: 'service' | 'practice-support' | 'retail';
  description: string;
  internalReason: string;
  salesPolicy: StaffProductPolicy;
  source: 'built-in' | 'staff-created';
  active: boolean;
  availableInPos: boolean;
  readiness: 'ready' | 'needs-fulfillment';
  readinessReason: string | null;
  fulfillmentMode: 'linked' | 'manual' | 'owned-receipt';
  fulfillmentPolicy: 'provider-linked' | 'none' | 'session-credit' | 'living-practice-access';
  fulfillmentSummary: string;
  createdAt: string | null;
  createdBy: string | null;
}

export interface StaffProductDefinition {
  name: string;
  classification: string;
  sessions: number;
  livingPractice: boolean;
  packagePurchase: boolean;
  purchaseBehavior: 'credit' | 'draw-down' | 'no-credit';
  staffSaleState: 'ready' | 'needs-fulfillment' | 'reference-only';
  amountCents: number | null;
  currency: 'USD' | null;
  salesPolicy: StaffProductPolicy | 'reference';
  fulfillmentSummary: string;
}

export interface StaffProductCoverage {
  source: 'code-known-reference';
  liveProviderVerified: false;
  counts: {
    knownDefinitions: number;
    staffCatalog: number;
    referenceOnly: number;
    customProducts: number | null;
  };
  definitions: StaffProductDefinition[];
}

export interface StaffProductsResponse {
  products: StaffProduct[];
  coverage: StaffProductCoverage;
  canCreate: boolean;
  storage: 'owned-d1' | 'unavailable';
  error?: string | null;
}

export async function getStaffProducts(): Promise<StaffProductsResponse> {
  return fetchApi('/staff-products');
}

export async function createStaffProduct(input: {
  requestId: string;
  name: string;
  amountCents: number;
  category: StaffProduct['category'];
  description: string;
  internalReason: string;
  availableInPos: boolean;
}): Promise<{ product: StaffProduct }> {
  return fetchApi('/staff-products', { method: 'POST', body: JSON.stringify(input) });
}

export type StaffMediaKind = 'image' | 'video' | 'document' | 'file';
export interface StaffMediaFolder {
  id: string;
  parentId: string | null;
  name: string;
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StaffMediaAsset {
  id: string;
  folderId: string | null;
  name: string;
  originalName: string;
  mimeType: string;
  kind: StaffMediaKind;
  sizeBytes: number;
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  previewUrl: string;
  downloadUrl: string;
  internalUrl: string;
}

export interface StaffMediaResponse {
  folders: StaffMediaFolder[];
  assets: StaffMediaAsset[];
  storage: 'owned-d1-r2';
  uploadReady: boolean;
}

export async function getStaffMedia(includeArchived = false): Promise<StaffMediaResponse> {
  return fetchApi(`/staff-media${includeArchived ? '?archived=1' : ''}`);
}

export async function updateStaffMedia(input: Record<string, unknown>): Promise<{ asset?: StaffMediaAsset; folder?: StaffMediaFolder }> {
  return fetchApi('/staff-media', { method: 'POST', body: JSON.stringify(input) });
}

export interface StaffSiteMediaImport {
  imported: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
  total: number;
  nextOffset: number;
}

export async function importStaffSiteMedia(offset = 0): Promise<StaffSiteMediaImport> {
  return fetchApi('/staff-media', { method: 'POST', body: JSON.stringify({ action: 'import_site_assets', offset }) });
}

export async function uploadStaffMedia(file: File, folderId: string | null): Promise<{ asset: StaffMediaAsset }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch('/api/staff-media-upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Amari-File-Name': encodeURIComponent(file.name),
        'X-Amari-File-Size': String(file.size),
        ...(folderId ? { 'X-Amari-Folder-Id': encodeURIComponent(folderId) } : {}),
      },
      body: file,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new ApiError(body.error || 'Upload failed', response.status);
    }
    return response.json();
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw new ApiError('Upload timed out. Try a smaller file.', 408);
    throw cause;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getPosSale(id: string): Promise<{ sale: PosSale }> {
  return fetchApi(`/staff-pos-sales?id=${encodeURIComponent(id)}`);
}

export async function createPosSale(input: { client: PosClient; cart: PosDraftLineInput[]; paymentLegs: PosPaymentLegInput[] }): Promise<{ sale: PosSale }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'create', ...input }) });
}

export async function savePosSale(input: { id: string; version: number; client: PosClient; cart: PosDraftLineInput[]; paymentLegs: PosPaymentLegInput[] }): Promise<{ sale: PosSale }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'save', ...input }) });
}

export async function startPosCheckout(input: {
  id?: string;
  version?: number;
  client: PosClient;
  cart: PosDraftLineInput[];
  paymentLegs: PosPaymentLegInput[];
}): Promise<{ sale: PosSale; checkouts: PosCheckoutOpen[] }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'start-checkout', ...input }) });
}

export async function chargePosSavedCard(input: {
  id?: string;
  version?: number;
  client: PosClient;
  cart: PosDraftLineInput[];
  paymentLegs: PosPaymentLegInput[];
  paymentMethodId: string;
  paymentLegId?: string;
  confirmed: true;
}): Promise<{ sale: PosSale; fulfillment?: Record<string, unknown>; card?: { brand: string; last4: string } }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'charge-saved-card', ...input }) });
}

export async function recordPosCash(input: {
  id?: string;
  version?: number;
  client: PosClient;
  cart: PosDraftLineInput[];
  paymentLegs: PosPaymentLegInput[];
  paymentLegId?: string;
  cashReceivedCents: number;
}): Promise<{ sale: PosSale; fulfillment?: Record<string, unknown> }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'record-cash', ...input }) });
}

export async function fulfillPosSale(id: string): Promise<{ sale: PosSale; fulfillment?: Record<string, unknown> }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'fulfill', id }) });
}

export async function previewPosCheckoutText(id: string): Promise<{ sale: PosSale; preview: PosTextPreview }> {
  return fetchApi('/staff-pos-sales', { method: 'POST', body: JSON.stringify({ action: 'preview-checkout-text', id }) });
}

// ── Garrett's Day tasks (Schedule tab directive list) ───────────────────────
export interface StaffTask {
  id: string;
  text: string;
  done: boolean;
  addedBy: string;
  createdAt: string;
  doneAt?: string | null;
}

// The full Schedule-tab "Garrett's Day" state: the goal (why), the pinned rule,
// and the checkable tasks. (Bookings are tracked in the funnel, not here.)
export interface StaffDay {
  goal: string;
  rule: string;
  tasks: StaffTask[];
}

export async function getTasks(): Promise<StaffDay> {
  return fetchApi('/staff-tasks');
}

type TaskAction =
  | { action: 'add'; text: string }
  | { action: 'edit'; id: string; text: string }
  | { action: 'toggle'; id: string }
  | { action: 'delete'; id: string }
  | { action: 'clear-done' }
  | { action: 'set-goal'; text: string }
  | { action: 'set-rule'; text: string };

export async function mutateTask(input: TaskAction): Promise<StaffDay> {
  return fetchApi('/staff-tasks', { method: 'POST', body: JSON.stringify(input) });
}

// Amari-owned, person-specific dated follow-ups. These persist in the owned CRM
// database and never trigger a message, booking, payment, or GHL workflow.
export interface OwnedFollowup {
  id: string;
  contactId: string;
  providerContactId: string | null;
  contactName: string;
  title: string;
  dueOn: string;
  completedAt: string | null;
  createdBy: string;
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getOwnedFollowups(): Promise<{ success: boolean; followups: OwnedFollowup[]; truncated?: boolean }> {
  return fetchApi('/staff-followups');
}

export async function createOwnedFollowup(input: {
  contactId: string;
  title: string;
  dueOn: string;
}): Promise<{ success: boolean; followup: OwnedFollowup }> {
  return fetchApi('/staff-followups', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...input }),
  });
}

export async function setOwnedFollowupComplete(
  id: string,
  completed: boolean,
): Promise<{ success: boolean; followup: OwnedFollowup }> {
  return fetchApi('/staff-followups', {
    method: 'POST',
    body: JSON.stringify({ action: completed ? 'complete' : 'reopen', id }),
  });
}

// One-tap post-call text (the "just left a voicemail" nudge). Sends the
// staff-chosen pre-written body via GHL.
export async function sendFollowupText(
  contactId: string,
  message: string,
): Promise<{ success: boolean; deduped?: boolean; sentTo?: string }> {
  return fetchApi('/staff-send-text', {
    method: 'POST',
    body: JSON.stringify({ contactId, message }),
  });
}

// One-tap custom email — sends a staff-composed subject + body THROUGH GHL, so it's
// logged on the contact's timeline (traceable) exactly like the SMS path. Body is HTML.
export async function sendFollowupEmail(
  contactId: string,
  subject: string,
  html: string,
): Promise<{ success: boolean; deduped?: boolean; sentTo?: string }> {
  return fetchApi('/staff-send-email', {
    method: 'POST',
    body: JSON.stringify({ contactId, subject, html }),
  });
}

// ── Sharpen (call-craft card feed) ──────────────────────────────────────────
export type SharpenCategory = 'frame' | 'objection' | 'discovery' | 'close' | 'real-call';
// kind = what TYPE of card this is (orthogonal to topic/category): a data-derived
// trend (bucket), a single replayable real-call win (move), or evergreen technique
// (craft). Drives the card background colour. Defaults to 'craft' when absent.
export type SharpenKind = 'bucket' | 'move' | 'craft';
export interface SharpenCard {
  id: string;
  category: SharpenCategory;
  kind?: SharpenKind;
  title: string;
  body: string;
  addedBy?: string;
  createdAt?: string;
}

export async function getSharpen(): Promise<{ cards: SharpenCard[] }> {
  return fetchApi('/staff-sharpen');
}

type SharpenAction =
  | { action: 'add'; category: SharpenCategory; title: string; body: string }
  | { action: 'edit'; id: string; category: SharpenCategory; title: string; body: string }
  | { action: 'delete'; id: string };

export async function mutateSharpen(input: SharpenAction): Promise<{ cards: SharpenCard[] }> {
  return fetchApi('/staff-sharpen', { method: 'POST', body: JSON.stringify(input) });
}

export async function trackSharpenSeen(cardId?: string): Promise<void> {
  try {
    await fetchApi('/staff-sharpen', {
      method: 'POST',
      body: JSON.stringify({ action: 'seen', ...(cardId ? { cardId } : {}) }),
    });
  } catch {
    // fire-and-forget — observability write, not user-visible
  }
}

export async function staffCheckIn(
  contactId: string,
  payload: { typedName: string; signatureImage: string },
): Promise<{ success: boolean; kvKey: string; signedAt: string; agreementVersion: string }> {
  return fetchApi('/staff-checkin', {
    method: 'POST',
    body: JSON.stringify({ contactId, ...payload }),
  });
}

export type StaffAttestation =
  | { found: false; lookupFailed?: boolean }
  | {
      found: true;
      typedName: string;
      signatureImage: string;
      agreementVersion: string;
      signedAt: string;
    };

export async function getStaffAttestation(contactId: string): Promise<StaffAttestation> {
  return fetchApi(`/staff-attestation?contactId=${encodeURIComponent(contactId)}`);
}

export async function togglePrepaid(
  contactId: string,
  prepaid: boolean,
): Promise<{ success: boolean; prepaid: boolean }> {
  return fetchApi('/staff-toggle-prepaid', {
    method: 'POST',
    body: JSON.stringify({ contactId, prepaid }),
  });
}

export async function getConversations(
  filter: import('../types/staff').ConversationFilter = 'needs_reply',
  debug = false,
): Promise<import('../types/staff').ConversationsResponse & { debug?: unknown }> {
  return fetchApi(`/staff-conversations?filter=${encodeURIComponent(filter)}${debug ? '&debug=1' : ''}`);
}

export async function getBalances(
  refresh = false,
): Promise<import('../types/staff').BalancesResponse> {
  return fetchApi(`/staff-balances${refresh ? '?refresh=1' : ''}`);
}

export async function getOutreachCards(): Promise<import('../types/staff').OutreachSnapshotResponse> {
  return fetchApi('/staff-outreach-cards');
}

export async function getPartnerProspects(): Promise<import('../types/staff').PartnerProspectsResponse> {
  return fetchApi('/staff-partner-prospects');
}

// Persist a "no reply needed" dismissal so it survives page reloads.
// lastMessageDate is stored so a new inbound message auto-un-dismisses.
export async function dismissReply(contactId: string, lastMessageDate: string | null): Promise<void> {
  try {
    await fetchApi('/staff-reply-dismiss', { method: 'POST', body: JSON.stringify({ contactId, lastMessageDate }) });
  } catch {
    // fire-and-forget — UI already updated optimistically
  }
}

export interface PartnerActivityResponse {
  contactId: string;
  generatedAt: string;
  events: import('../types/staff').PartnerActivityEvent[];
  totalFetched: number;
  truncated: boolean;
}

export async function getPartnerActivity(contactId: string): Promise<PartnerActivityResponse> {
  return fetchApi(`/staff-partner-activity?contactId=${encodeURIComponent(contactId)}`);
}

export interface PartnerOutcomeResult {
  success: boolean;
  contactId: string;
  signal: import('../types/staff').PartnerLastSignal;
  newStage: import('../types/staff').PartnerStage | null;
  signalAt: string;
  followupAt: string | null;
}

export async function recordPartnerOutcome(
  payload: import('../types/staff').PartnerOutcomeRequest,
): Promise<PartnerOutcomeResult> {
  return fetchApi('/staff-partner-outcome', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Verification flywheel: a discovery call found the decision-maker. Tags the contact
// dm-verified (→ play-decision flips discovery to pitch) and optionally repoints the
// record to the real person (name / direct line).
export async function verifyDecisionMaker(
  contactId: string,
  dm: { dmFirstName?: string; dmLastName?: string; dmPhone?: string },
): Promise<{ success: boolean }> {
  return fetchApi('/staff-partner-verify', {
    method: 'POST',
    body: JSON.stringify({ contactId, ...dm }),
  });
}

export async function toggleOutreachVerified(
  contactId: string,
  verified: boolean,
): Promise<{ success: boolean; contactId: string; verified: boolean }> {
  return fetchApi('/staff-partner-toggle-verified', {
    method: 'POST',
    body: JSON.stringify({ contactId, verified }),
  });
}

// Inline-edit a single field on a partner contact. Whitelisted server-side
// (see functions/api/staff-partner-update-field.js EDITABLE_FIELDS for the list).
export type EditableFieldKey =
  | 'phone' | 'email' | 'website' | 'companyName' | 'address1' | 'city' | 'state' | 'postalCode'
  | 'partnerInstagram' | 'partnerLinkedinUrl' | 'partnerFacility' | 'partnerFacilityRole'
  | 'partnerOtherUrls' | 'partnerRundown';

export async function updateContactField(
  contactId: string,
  field: EditableFieldKey,
  value: string,
): Promise<{ success: boolean; contactId: string; field: string; value: string; changed: boolean; previousValue?: string }> {
  return fetchApi('/staff-partner-update-field', {
    method: 'POST',
    body: JSON.stringify({ contactId, field, value }),
  });
}

// Triggers the partner-activity-refresh Worker on-demand.
// Returns 202 immediately; the worker runs ~10-15 min in the background
// and writes its result to KV (surfaced as activityRefreshAt next reload).
export async function triggerActivityRefresh(): Promise<{ triggered: boolean; message: string }> {
  return fetchApi('/staff-refresh-activity', { method: 'POST' });
}

// ── Funnel (sales funnel, v2 event-level snapshot) ────────────────────────
// Snapshot is computed out-of-band by ~/.claude/ghl-mcp/funnel.mjs and cached
// in KV; /staff-funnel just serves it. Events are sliced into date ranges
// client-side. See functions/api/staff-funnel.js.
export interface FunnelCallEvent {
  d: string;                       // YYYY-MM-DD (Pacific)
  o: 'none' | 'vm' | 'talk';       // no answer · voicemail left · talked
  c: string;                       // cohort
}
export interface FunnelSessionEvent {
  d: string;                       // booking date (when it was booked)
  sessionDate?: string;            // the scheduled session date
  status?: 'attended' | 'noshow' | 'cancelled' | 'pending';
  showed: boolean;
  eightSeries?: boolean;           // contact-matched purchase after attendance
  firstSeriesEquivs?: number;
  downstreamEquivs?: number;
  c: string;
}
export interface FunnelSaleEvent {
  d: string;
  s: number;                       // sessions sold (8-pack=8, 4-pack=4, single=1…)
  k: string;                       // kind label
  c: string;
  r: boolean;                      // repeat buyer
  who: string;
}
export interface FunnelData {
  v?: number;
  generatedAt: string | null;
  empty?: boolean;
  windowDays?: number;
  goal?: { packsPerMonth: number; sessionsPerPack: number };
  calls?: FunnelCallEvent[];
  texts?: { d: string }[];         // outbound SMS, one touch per contact-day
  emails?: { d: string }[];        // outbound email, one touch per contact-day
  sessions?: FunnelSessionEvent[];
  sales?: FunnelSaleEvent[];
  cohort?: { attended: number; firstSeriesBuyers: number; downstreamBuyers: number; downstreamBuyerRate: number; firstSeriesEquivs: number; downstreamEquivs: number; expectedEquivsPerAttended: number };
  trailing90?: { calls: number; equivs: number; callsPerEquiv: number | null };
  targets?: { calls: number; talk: number; booked: number; showed: number; sales: number; source?: string; asOf?: string };
  paceLine?: string;
}

export async function getFunnel(): Promise<FunnelData> {
  return fetchApi('/staff-funnel');
}

// ── Revenue (server-side Stripe aggregates; staff-authenticated) ───────────
export interface StaffRevenueMonth {
  month: string; // YYYY-MM, Pacific time
  gross: number;
  fees: number;
  net: number;
  chargeCount: number;
}

export interface StaffRevenueData {
  generatedAt: string;
  timezone: string;
  thisMonth: StaffRevenueMonth;
  trend: StaffRevenueMonth[];
}

export async function getStaffRevenue(months = 12): Promise<StaffRevenueData> {
  return fetchApi(`/staff-revenue?months=${encodeURIComponent(months)}`);
}

export interface FunnelRefreshResult {
  triggered: boolean;
  summary?: {
    status?: string;
    snapshotKey?: string;
    durationMs?: number;
    calls?: number;
    sessions?: number;
    sales?: number;
    sessionsSold?: number;
  };
  error?: string;
}

// Triggers the funnel-refresh Worker and WAITS for it (the worker runs the full
// GHL pull inline, ~45s, then writes funnel:latest). Unlike the shared fetchApi
// (15s timeout) this uses a 90s ceiling so the inline run isn't cut off. The
// caller should poll getFunnel() afterward until generatedAt advances.
export async function triggerFunnelRefresh(): Promise<FunnelRefreshResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${API_BASE}/staff-funnel-refresh`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({ triggered: false, error: 'Request failed' }));
    if (!response.ok && response.status !== 202) {
      throw new ApiError(data.error || 'Refresh failed', response.status);
    }
    return data as FunnelRefreshResult;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // The worker keeps running server-side; treat as "triggered" so the
      // caller polls for the new snapshot.
      return { triggered: true, error: 'timed out — still refreshing' };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Follow-Up brief (Claude-drafted: who they are + talking points + texts) ──
export interface FollowupBrief {
  summary: string;
  talkingPoints: string[];
  drafts: { channel: 'text' | 'call' | 'email'; text: string }[];
}

// Calls the Claude-backed brief endpoint. Uses its own 45s ceiling (the model
// call exceeds fetchApi's 15s timeout). `contact` is the known card context.
export async function buildFollowupBrief(
  contactId: string,
  contact: Record<string, unknown>,
): Promise<FollowupBrief> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${API_BASE}/staff-followup-brief`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ contactId, contact }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    if (!response.ok) throw new ApiError(data.error || 'Failed to build brief', response.status);
    return data as FollowupBrief;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('The brief took too long. Try again.', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Call-coach (daily worker: recording → Whisper → Claude coaching) ─────────
export interface CallCoach {
  contactId: string;
  contactName?: string;
  date: string;
  hasAudio?: boolean;
  callCount?: number;
  textCount?: number;
  coaching: {
    summary: string;
    whatWorked: string[];
    whatToImprove: string[];
    objections: string[];
    nextStep: string;
    actionLine?: string;
    holdState?: 'active' | 'cool-off' | 'close-loop';
    suggestedReply?: string;
    signal?: string;
  };
}

// Returns the contact's coaching for `date` (defaults to yesterday, the cron's
// output day), or null if there's none — silent, not an error on the card.
export async function getCallCoach(contactId: string, date?: string): Promise<CallCoach | null> {
  try {
    const qs = `contactId=${encodeURIComponent(contactId)}${date ? `&date=${date}` : ''}`;
    // Reader returns 200 with coaching:null when there's none — treat as no coaching.
    const r = await fetchApi<{ coaching?: unknown } & Record<string, unknown>>(`/call-coach?${qs}`);
    return r && r.coaching ? (r as unknown as CallCoach) : null;
  } catch {
    return null;
  }
}

// Fire-and-forget: tells the call-coach worker to process a single contact
// immediately. Returns without waiting for the worker to finish (returns 202).
export async function triggerCoachOne(contactId: string): Promise<void> {
  try {
    await fetchApi('/staff-coach-one', { method: 'POST', body: JSON.stringify({ contactId }) });
  } catch {
    // fire-and-forget — ignore errors
  }
}

// ── Outreach coach (local generator: cadence + thread + voice → who/why/message)
export interface OutreachCoach {
  contactId: string;
  name?: string;
  bucket?: string;        // dropped-reply | gone-quiet | never-followed-up | referral
  whyNow: string;         // why this person is surfaced right now
  message: string;        // the ready-to-send draft in Garrett's voice
  variations?: string[];  // 2-3 wordings to choose from (message is variations[0])
  channel?: 'call' | 'text' | 'email';
  email?: { subject: string; body: string }; // email-shaped draft — distinct from message (SMS-shaped), not a copy of it
  sms?: string[];          // channel-explicit mirror of `variations` for text-shaped rungs
  callScript?: string[];   // channel-explicit script(s) for call-shaped rungs (read-only, copy-to-clipboard)
  angle?: string;          // which rung of the angle ladder this touch is (identity | gift | honest-why | substance | gentle-no | guarantee-fallback)
  angleLabel?: string;     // human-readable version of `angle`, shown on the card so Garrett sees why this touch says what it says
  step?: number;           // touch number in the cadence sequence
  variant?: 'cold' | 'warm';
  generatedAt?: string;
}

// Returns the contact's outreach-coach record, or null if there's none — silent,
// not an error on the card. Reader returns 200 with coach:null when absent.
export async function getOutreachCoach(contactId: string): Promise<OutreachCoach | null> {
  try {
    const r = await fetchApi<{ coach?: OutreachCoach | null }>(
      `/outreach-coach?contactId=${encodeURIComponent(contactId)}`,
    );
    return r && r.coach && (r.coach.message || r.coach.variations?.length) ? r.coach : null;
  } catch {
    return null;
  }
}

// ── Pipeline view (Eben's Kanban: Touch 1-6 → Discovery → First Session → Pack 1-3+)
export interface PipelineCard {
  id: string;
  name: string;
  touchCount: number;
  sessionsCompleted: number;
  sessionsRemaining: number;
  seriesType: string;
  purchaseCount: number;
  sessionsPurchased: number;
  hasSentReferral: boolean;
  lastActivity: string | null;
  dateAdded: string | null;
}

export interface PipelineColumns {
  'touch-1': PipelineCard[];
  'touch-2': PipelineCard[];
  'touch-3': PipelineCard[];
  'touch-4': PipelineCard[];
  'touch-5': PipelineCard[];
  'touch-6': PipelineCard[];
  'discovery-noshow': PipelineCard[];
  'session-noshow': PipelineCard[];
  discovery: PipelineCard[];
  'first-session': PipelineCard[];
  'multipack-1': PipelineCard[];
  'multipack-2': PipelineCard[];
}

export interface PipelineCohortMetrics {
  reachedOut: number;
  discoveryAttended: number;
  initialResolved: number;
  initialAttended: number;
  initialNoShows: number;
  firstPurchasers: number;
  repeatPurchasers: number;
}

export interface PipelineData {
  columns: PipelineColumns;
  cohortMetrics: PipelineCohortMetrics;
}

export async function getPipeline(): Promise<PipelineData> {
  return fetchApi<PipelineData>('/staff-pipeline');
}

// ── Study capture — intake + before/after pain (elbow / jaw / foot / hand)
export async function getStudyCapture(
  contactId: string,
  studySlug: string,
): Promise<import('../types/staff').ElbowStudyRecord | null> {
  const r = await fetchApi<{ record: import('../types/staff').ElbowStudyRecord | null }>(
    `/staff-study?contactId=${encodeURIComponent(contactId)}&studySlug=${encodeURIComponent(studySlug)}`,
  );
  return r.record;
}

export async function saveStudyCapture(
  contactId: string,
  studySlug: string,
  record: import('../types/staff').ElbowStudyRecord,
): Promise<import('../types/staff').ElbowStudyRecord> {
  const r = await fetchApi<{ record: import('../types/staff').ElbowStudyRecord }>('/staff-study', {
    method: 'POST',
    body: JSON.stringify({ contactId, studySlug, record }),
  });
  return r.record;
}

/** @deprecated Use getStudyCapture(contactId, 'tennis-elbow') */
export async function getElbowStudy(
  contactId: string,
): Promise<import('../types/staff').ElbowStudyRecord | null> {
  return getStudyCapture(contactId, 'tennis-elbow');
}

/** @deprecated Use saveStudyCapture(contactId, 'tennis-elbow', record) */
export async function saveElbowStudy(
  contactId: string,
  record: import('../types/staff').ElbowStudyRecord,
): Promise<import('../types/staff').ElbowStudyRecord> {
  return saveStudyCapture(contactId, 'tennis-elbow', record);
}

// ── Field table studies — secured record capture + paper-baseline queue
export async function listFieldStudyParticipants(
  includeBookings = false,
): Promise<import('../types/staff').FieldStudyQueueItem[]> {
  const r = await fetchApi<{ records: import('../types/staff').FieldStudyQueueItem[] }>(
    `/staff-field-study${includeBookings ? '?includeBookings=1' : ''}`,
  );
  return r.records;
}

export async function getCommunityRelationships(): Promise<import('../types/staff').CommunityRelationship[]> {
  const result = await fetchApi<{ partners: import('../types/staff').CommunityRelationship[] }>('/staff-community');
  return result.partners;
}

export async function getCommunityRelationshipImage(
  partnerId: string,
  imageIndex = 0,
): Promise<import('../types/staff').CommunityRelationshipImage> {
  return fetchApi(`/staff-community-image?partnerId=${encodeURIComponent(partnerId)}&image=${imageIndex}`);
}

export async function recordCommunityTouch(input: {
  relationship: import('../types/staff').CommunityRelationship;
  notes: string;
  relationship_stage: import('../types/staff').CommunityRelationshipStage;
  workshop_signal: boolean;
  next_visit_on: string;
  event_on: string;
  event_title: string;
  event_details: string;
}): Promise<{ partner: import('../types/staff').CommunityRelationship }> {
  return fetchApi('/staff-community-touch', { method: 'POST', body: JSON.stringify(input) });
}

export async function getFieldStudyParticipant(
  recordId: string,
): Promise<import('../types/staff').FieldStudyParticipant | null> {
  const r = await fetchApi<{ record: import('../types/staff').FieldStudyParticipant | null }>(
    `/staff-field-study?recordId=${encodeURIComponent(recordId)}&includeBookings=1`,
  );
  return r.record;
}

export async function enrollFieldStudyParticipant(input: {
  fieldStudyKey: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paperDate: string;
  firstSessionCompleted: boolean;
  canUseFirstName: boolean;
  afterSessionOnePain: number | null;
  participantQuote: string;
}): Promise<import('../types/staff').FieldStudyParticipant> {
  const r = await fetchApi<{ record: import('../types/staff').FieldStudyParticipant }>('/staff-field-study', {
    method: 'POST',
    body: JSON.stringify({ action: 'enroll', ...input }),
  });
  return r.record;
}

export async function saveFieldStudyBaseline(
  recordId: string,
  baseline: Omit<import('../types/staff').FieldStudyBaseline, 'capturedAt'>,
): Promise<import('../types/staff').FieldStudyParticipant> {
  const r = await fetchApi<{ record: import('../types/staff').FieldStudyParticipant }>('/staff-field-study', {
    method: 'POST',
    body: JSON.stringify({ action: 'save-baseline', recordId, baseline }),
  });
  return r.record;
}

export interface FieldStudySlot {
  date: string;
  hour: number;
  minute: number;
  datetime: string;
}

export async function getFieldStudySlots(
  recordId: string,
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<FieldStudySlot[]> {
  const r = await fetchApi<{ slots: FieldStudySlot[] }>('/staff-field-study', {
    method: 'POST',
    body: JSON.stringify({ action: 'get-slots', recordId, startDate, endDate, timezone }),
  });
  return r.slots;
}

export async function bookFieldStudyFollowup(
  recordId: string,
  startTime: string,
  timezone: string,
  idempotencyKey: string,
): Promise<{ appointment: { id: string; startTime: string } }> {
  return fetchApi('/staff-field-study', {
    method: 'POST',
    body: JSON.stringify({ action: 'book-followup', recordId, startTime, timezone, idempotencyKey }),
  });
}

export async function getCrmMirrorAccessUrl(view?: 'client-desk'): Promise<{ url: string; expiresInSeconds: number }> {
  const query = view === 'client-desk' ? '?view=client-desk' : '';
  return fetchApi(`/staff-crm-mirror-access${query}`, { method: 'POST' });
}

export async function getAutomationWatchAccessUrl(): Promise<{ url: string; expiresInSeconds: number }> {
  return fetchApi('/staff-automation-watch-access', { method: 'POST' });
}

// Staff Operations Ledger is a read-only browser surface. The server returns
// projections only; raw provider records, contact identity, and event payloads
// are intentionally absent from these types.
export type StaffOperationsLedgerResource = 'entries' | 'tasks' | 'releases' | 'incidents';

export interface StaffOperationsLedgerEntry {
  id?: string;
  at?: string;
  atMs?: number;
  createdAt?: string;
  timestamp?: string;
  type?: string;
  eventType?: string;
  kind?: string;
  status?: string;
  outcome?: string;
  reason?: string;
  reasonCode?: string;
  summary?: string;
  source?: string;
  sourceSystem?: string;
  pathId?: string;
  taskId?: string;
  releaseId?: string;
  incidentId?: string;
  actor?: string;
}

export interface StaffOperationsLedgerTask {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  dueAt?: string;
  completedAt?: string;
  status?: string;
  priority?: string;
  title?: string;
  summary?: string;
  source?: string;
  releaseId?: string;
  incidentId?: string;
  actor?: string;
}

export interface StaffOperationsLedgerRelease {
  id?: string;
  createdAt?: string;
  releasedAt?: string;
  status?: string;
  version?: string;
  environment?: string;
  source?: string;
  summary?: string;
  rollback?: boolean;
  commitSha?: string;
  changeType?: string;
  actor?: string;
}

export interface StaffOperationsLedgerIncident {
  id?: string;
  createdAt?: string;
  openedAt?: string;
  resolvedAt?: string;
  status?: string;
  severity?: string;
  title?: string;
  summary?: string;
  source?: string;
  pathId?: string;
  releaseId?: string;
  actor?: string;
}

export interface StaffOperationsLedgerResponse {
  success: true;
  configured: boolean;
  nextCursor: string | null;
  generatedAt?: string;
  entries?: StaffOperationsLedgerEntry[];
  tasks?: StaffOperationsLedgerTask[];
  releases?: StaffOperationsLedgerRelease[];
  incidents?: StaffOperationsLedgerIncident[];
}

export interface StaffOperationsLedgerQuery {
  resource?: StaffOperationsLedgerResource;
  limit?: number;
  cursor?: string;
  status?: string;
  type?: string;
  eventType?: string;
  outcome?: string;
  source?: string;
  pathId?: string;
  releaseId?: string;
  incidentId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export async function getStaffOperationsLedger(
  query: StaffOperationsLedgerQuery = {},
): Promise<StaffOperationsLedgerResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchApi(`/staff-operations-ledger${suffix}`);
}

export { ApiError };
