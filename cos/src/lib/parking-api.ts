import type { ParkingSnapshot } from '../types/cos';
import { ApiError } from './api';
import { clearParkingSession, getParkingToken } from '../contexts/ParkingAuthContext';

const API_BASE = '/api';

function authHeaders() {
  const token = getParkingToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function handleUnauthorized(status: number) {
  if (status === 401) clearParkingSession();
}

export async function parkingLogin(pin: string): Promise<{ token: string }> {
  const response = await fetch(`${API_BASE}/cos-auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(data.error || 'Request failed', response.status);
  }
  return response.json();
}

export async function getCurrentParking(): Promise<ParkingSnapshot | null> {
  const response = await fetch(`${API_BASE}/cos-parking-current`, { headers: authHeaders() });
  if (!response.ok) {
    handleUnauthorized(response.status);
    const data = await response.json().catch(() => ({ error: 'Could not load saved parking.' }));
    throw new ApiError(response.status === 401 ? 'Session expired. Please log in again.' : data.error || 'Could not load saved parking.', response.status);
  }
  return (await response.json()).parking || null;
}

export async function sendParkingMessage(
  message: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
) {
  if (!getParkingToken()) return onError('Session expired. Please log in again.');
  try {
    const response = await fetch(`${API_BASE}/cos-chat`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message }) });
    if (!response.ok) {
      handleUnauthorized(response.status);
      const data = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(data.error || 'Parking request failed', response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError('No response stream', 500);
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'chunk') onChunk(data.text);
        if (data.type === 'done') { finished = true; onDone(); }
        if (data.type === 'error') { finished = true; onError(data.message); }
      } catch { /* ignore malformed stream fragments */ }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(processLine);
    }
    if (buffer.trim()) processLine(buffer.trim());
    if (!finished) onError('The connection dropped before the parking record was saved. Please try again.');
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Parking request failed');
  }
}
