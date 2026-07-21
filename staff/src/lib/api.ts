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

export async function getDayData(date?: string, endDate?: string, includeCancelled?: boolean): Promise<import('../types/staff').TodayAppointment[]> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (endDate) params.set('endDate', endDate);
  if (includeCancelled) params.set('includeCancelled', '1');
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
  showed: boolean;
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
  trailing90?: { calls: number; equivs: number; callsPerEquiv: number | null };
  targets?: { calls: number; talk: number; booked: number; showed: number; sales: number; source?: string; asOf?: string };
  paceLine?: string;
}

export async function getFunnel(): Promise<FunnelData> {
  return fetchApi('/staff-funnel');
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
  const token = localStorage.getItem('staff_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${API_BASE}/staff-funnel-refresh`, {
      method: 'POST',
      headers,
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
  const token = localStorage.getItem('staff_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${API_BASE}/staff-followup-brief`, {
      method: 'POST',
      headers,
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
  discovery: PipelineCard[];
  'first-session': PipelineCard[];
  'multipack-1': PipelineCard[];
  'multipack-2': PipelineCard[];
  referred: PipelineCard[];
}

export async function getPipeline(): Promise<PipelineColumns> {
  const r = await fetchApi<{ columns: PipelineColumns }>('/staff-pipeline');
  return r.columns;
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
export async function listFieldStudyParticipants(): Promise<import('../types/staff').FieldStudyQueueItem[]> {
  const r = await fetchApi<{ records: import('../types/staff').FieldStudyQueueItem[] }>('/staff-field-study');
  return r.records;
}

export async function getFieldStudyParticipant(
  recordId: string,
): Promise<import('../types/staff').FieldStudyParticipant | null> {
  const r = await fetchApi<{ record: import('../types/staff').FieldStudyParticipant | null }>(
    `/staff-field-study?recordId=${encodeURIComponent(recordId)}`,
  );
  return r.record;
}

export async function enrollFieldStudyParticipant(input: {
  fieldStudyKey: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  canUseFirstName: boolean;
  afterSessionOnePain: number | null;
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

export { ApiError };
