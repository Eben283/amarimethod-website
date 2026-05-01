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
}

export async function markAttended(
  appointmentId: string,
  contactId: string,
  appointmentTitle: string,
  calendarName?: string,
): Promise<MarkAttendedResult> {
  return fetchApi('/staff-mark-attended', {
    method: 'POST',
    body: JSON.stringify({ appointmentId, contactId, appointmentTitle, calendarName: calendarName || '' }),
  });
}

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

export async function markNotAFit(contactId: string): Promise<{ success: boolean; stage: string }> {
  return fetchApi('/staff-not-a-fit', {
    method: 'POST',
    body: JSON.stringify({ contactId }),
  });
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

export { ApiError };
