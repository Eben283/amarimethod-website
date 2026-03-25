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

export async function getTodayData(): Promise<import('../types/staff').TodayAppointment[]> {
  return fetchApi('/staff-data');
}

export async function searchContacts(query: string): Promise<import('../types/staff').ContactListItem[]> {
  return fetchApi(`/staff-contacts?query=${encodeURIComponent(query)}`);
}

export async function getContactDetail(id: string): Promise<import('../types/staff').ContactDetail> {
  return fetchApi(`/staff-contact?id=${encodeURIComponent(id)}`);
}

export async function addNote(contactId: string, body: string): Promise<{ success: boolean }> {
  return fetchApi('/staff-note', {
    method: 'POST',
    body: JSON.stringify({ contactId, body }),
  });
}

export { ApiError };
