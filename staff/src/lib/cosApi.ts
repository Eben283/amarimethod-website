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
    let sawTerminal = false;

    const handleLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'chunk') onChunk(parsed.text);
        else if (parsed.type === 'done') { sawTerminal = true; onDone(parsed.actions || []); }
        else if (parsed.type === 'error') { sawTerminal = true; onError(parsed.message); }
      } catch {
        // non-JSON line, ignore
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }
    // Flush any trailing event left in the buffer (a stream that ends without a
    // final newline would otherwise drop its last event — often the "done").
    if (buffer.trim()) handleLine(buffer.trim());
    // If the stream ended without a terminal `done`/`error` event (CF cut the
    // connection, network drop), neither callback fired and the chat would stay
    // stuck in the streaming state forever. Surface it so the caller resets.
    if (!sawTerminal) onError('The connection dropped before the reply finished. Please try again.');
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Something went wrong');
  }
}

// ── Voice Writer ─────────────────────────────────────────────────────────────
// Hits /api/voice-write, which runs the shared voice engine (generate -> audit ->
// revise until on-brand). Non-streaming: one request, one finished draft back.

export interface VoiceWriteResult {
  copy: string;
  channel: string;
  fixes: string[];
  rounds: number;
  passedClean: boolean;
  remainingTells: string[];
}

export async function sendVoiceWrite(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<VoiceWriteResult> {
  const token = staffToken();
  if (!token) throw new Error('Session expired. Please log in again.');

  const response = await fetch(`${API_BASE}/voice-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || 'The writer hit a problem.');
  }
  return response.json();
}

// Wipe today's server-side conversation bucket so "New chat" actually starts
// fresh (the backend keys history per user per day; clearing the UI alone
// leaves the old thread in KV for the next message to reload).
export async function resetCosConversation(): Promise<void> {
  const token = staffToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/cos-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reset: true }),
    });
  } catch {
    // Best-effort — a failed reset just means the next message keeps context.
  }
}
