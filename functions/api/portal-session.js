/**
 * Device session management for Living Practice course.
 * Uses Cloudflare KV (PORTAL_SESSIONS namespace) to track active devices per contact.
 *
 * POST /api/portal-session
 * Body: { deviceId, deviceName }
 * Auth: Bearer token (same as other portal endpoints)
 *
 * Returns: { valid: true } or { valid: false, reason: "evicted" }
 */

import jwt from '@tsndr/cloudflare-worker-jwt';

const MAX_DEVICES = 3;
const INACTIVE_DAYS = 30;
const INACTIVE_MS = INACTIVE_DAYS * 24 * 60 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function getContactIdFromToken(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const valid = await jwt.verify(token, env.JWT_SECRET);
    if (!valid) return null;

    const { payload } = jwt.decode(token);
    return payload?.contactId ?? null;
  } catch {
    return null;
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Verify auth
  const contactId = await getContactIdFromToken(request, env);
  if (!contactId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Check KV binding exists
  if (!env.PORTAL_SESSIONS) {
    // KV not bound yet — silently allow (graceful degradation during setup)
    return jsonResponse({ valid: true });
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const { deviceId, deviceName } = body;
  if (!deviceId || typeof deviceId !== 'string') {
    return jsonResponse({ error: 'deviceId is required' }, 400);
  }

  const now = Date.now();
  const sanitizedDeviceName =
    typeof deviceName === 'string' ? deviceName.slice(0, 100) : 'Unknown device';

  // Read existing sessions
  let sessions = [];
  try {
    const raw = await env.PORTAL_SESSIONS.get(contactId);
    if (raw) {
      sessions = JSON.parse(raw);
    }
  } catch {
    sessions = [];
  }

  // Clean inactive sessions (30+ days)
  sessions = sessions.filter(
    (s) => now - s.lastActive < INACTIVE_MS,
  );

  // Check if this device already exists
  const existingIndex = sessions.findIndex((s) => s.deviceId === deviceId);

  if (existingIndex >= 0) {
    // Update existing device — refresh lastActive
    sessions = sessions.map((s, i) =>
      i === existingIndex
        ? { ...s, deviceName: sanitizedDeviceName, lastActive: now }
        : s,
    );
  } else {
    // New device — check limit
    if (sessions.length >= MAX_DEVICES) {
      // Evict oldest by lastActive
      sessions.sort((a, b) => a.lastActive - b.lastActive);
      sessions = sessions.slice(1);
    }

    sessions = [
      ...sessions,
      {
        deviceId,
        deviceName: sanitizedDeviceName,
        lastActive: now,
        createdAt: now,
      },
    ];
  }

  // Write back to KV
  await env.PORTAL_SESSIONS.put(contactId, JSON.stringify(sessions));

  // Check if this device is still in the list (it should be — but verify for eviction case)
  const isValid = sessions.some((s) => s.deviceId === deviceId);

  return jsonResponse({ valid: isValid });
}
