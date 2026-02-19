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

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(errorData.error || 'Request failed', response.status);
  }

  return response.json();
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

export { ApiError };
