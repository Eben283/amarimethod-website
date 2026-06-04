// Streaming client for the Chief-of-Staff chat, using the STAFF session token
// (the COS chat backend accepts both cos- and staff-role tokens). Mirrors the
// standalone COS app's sendMessage, but reads `staff_token` from localStorage.

const API_BASE = '/api';

function staffToken(): string | null {
  const token = localStorage.getItem('staff_token');
  if (!token) return null;
  const expiry = localStorage.getItem('staff_token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10)) {
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_token_expiry');
    return null;
  }
  return token;
}

export async function sendCosMessage(
  message: string,
  image: string | undefined,
  onChunk: (text: string) => void,
  onDone: (actions: unknown[]) => void,
  onError: (error: string) => void,
): Promise<void> {
  const token = staffToken();
  if (!token) {
    onError('Session expired. Please log in again.');
    return;
  }

  try {
    const body: Record<string, unknown> = { message };
    if (image) body.image = image;

    const response = await fetch(`${API_BASE}/cos-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Request failed' }));
      onError(data.error || 'Chat request failed');
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError('No response stream');
      return;
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
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'chunk') onChunk(parsed.text);
          else if (parsed.type === 'done') onDone(parsed.actions || []);
          else if (parsed.type === 'error') onError(parsed.message);
        } catch {
          // non-JSON line, ignore
        }
      }
    }
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Something went wrong');
  }
}
