const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  const token = localStorage.getItem('cos_token');
  if (!token) return null;

  const expiry = localStorage.getItem('cos_token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10)) {
    localStorage.removeItem('cos_token');
    localStorage.removeItem('cos_token_expiry');
    return null;
  }

  return token;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function cosLogin(pin: string): Promise<{ token: string }> {
  const response = await fetch(`${API_BASE}/cos-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(data.error || 'Request failed', response.status);
  }

  return response.json();
}

export async function sendMessage(
  message: string,
  onChunk: (text: string) => void,
  onDone: (actions: unknown[]) => void,
  onError: (error: string) => void,
): Promise<void> {
  const token = getToken();
  if (!token) {
    onError('Session expired. Please log in again.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/cos-chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(data.error || 'Chat request failed', response.status);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ApiError('No response stream', 500);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'chunk') {
              onChunk(parsed.text);
            } else if (parsed.type === 'done') {
              onDone(parsed.actions || []);
            } else if (parsed.type === 'error') {
              onError(parsed.message);
            }
          } catch {
            // Non-JSON line, ignore
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof ApiError) {
      onError(err.message);
    } else if (err instanceof Error) {
      onError(err.message);
    } else {
      onError('Something went wrong');
    }
  }
}

export async function getActions(status = 'pending'): Promise<unknown[]> {
  const response = await fetch(`${API_BASE}/cos-actions?status=${status}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new ApiError('Failed to fetch actions', response.status);
  }

  const data = await response.json();
  return data.actions || [];
}
