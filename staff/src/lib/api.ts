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
  const token = localStorage.getItem('staff_token');

  if (token) {
    const expiry = localStorage.getItem('staff_token_expiry');
    if (expiry && Date.now() > parseInt(expiry, 10)) {
      localStorage.removeItem('staff_token');
      localStorage.removeItem('staff_token_expiry');
      throw new ApiError('Session expired. Please log in again.', 401);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
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

export async function staffLogin(pin: string): Promise<{ token: string }> {
  return fetchApi('/staff-auth', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export async function getDayData(date?: string, endDate?: string): Promise<import('../types/staff').TodayAppointment[]> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (endDate) params.set('endDate', endDate);
  const qs = params.toString();
  return fetchApi(`/staff-data${qs ? `?${qs}` : ''}`);
}

export async function searchContacts(query: string): Promise<import('../types/staff').ContactListItem[]> {
  return fetchApi(`/staff-contacts?query=${encodeURIComponent(query)}`);
}

export async function getContactDetail(
  id: string,
  debug = false,
): Promise<import('../types/staff').ContactDetail & { _debug?: unknown }> {
  return fetchApi(`/staff-contact?id=${encodeURIComponent(id)}${debug ? '&debug=1' : ''}`);
}

export async function addNote(contactId: string, body: string): Promise<{ success: boolean }> {
  return fetchApi('/staff-note', {
    method: 'POST',
    body: JSON.stringify({ contactId, body }),
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
  | { found: false }
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

export { ApiError };
