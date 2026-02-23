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
  const token = localStorage.getItem('portal_token');

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

export async function requestMagicLink(email: string): Promise<{ success: boolean; message: string }> {
  return fetchApi('/portal-auth', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyToken(token: string): Promise<{ sessionToken: string; contactId: string; email: string }> {
  return fetchApi(`/portal-verify?token=${encodeURIComponent(token)}`);
}

export async function getPortalData(): Promise<import('../types/portal').PortalDataResponse> {
  return fetchApi('/portal-data');
}

export async function cancelAppointment(appointmentId: string, title: string): Promise<{ success: boolean }> {
  return fetchApi('/portal-cancel', {
    method: 'POST',
    body: JSON.stringify({ appointmentId, title }),
  });
}

export interface SlotResult {
  date: string;
  time: string;
  hour: number;
  minute: number;
  datetime: string;
}

export async function getAvailableSlots(
  calendarId: string,
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<{ slots: SlotResult[] }> {
  const params = new URLSearchParams({ calendarId, startDate, endDate, timezone });
  return fetchApi(`/portal-slots?${params.toString()}`, { method: 'GET' });
}

export interface BookAppointmentPayload {
  calendarId: string;
  startTime: string;
  timezone: string;
  sessionType: 'in-person' | 'virtual';
}

export async function bookAppointment(payload: BookAppointmentPayload): Promise<{
  success: boolean;
  appointment: { id: string; title: string; startTime: string; sessionType: string };
}> {
  return fetchApi('/portal-book', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export { ApiError };
