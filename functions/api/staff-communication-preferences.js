// Staff-owned Team Communication Preferences.
// GET/PUT are identity-scoped to the authenticated Staff JWT user. Saving a
// record does not change any live sender, recipient, cron, workflow, or alert.

import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import {
  communicationPreferencesView,
  defaultTeamCommunicationPreferences,
  normalizeStaffPreferenceUser,
  normalizeTeamCommunicationPreferences,
  preferenceKey,
} from "../lib/team-communication-preferences.js";

function responseHeaders(origin) {
  return {
    ...corsHeaders(origin, "GET, PUT, OPTIONS"),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function authenticate(context, headers) {
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return { error };
  const user = normalizeStaffPreferenceUser(payload?.user);
  if (!user) return { error: json({ error: "Communication preferences are only available to Eben and Garrett" }, 403, headers) };
  return { user };
}

async function readRecord(kv, user) {
  if (!kv) return null;
  const raw = await kv.get(preferenceKey(user), "json");
  if (!raw || typeof raw !== "object") return null;
  try {
    return {
      preferences: normalizeTeamCommunicationPreferences(raw.preferences || raw, user),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, PUT, OPTIONS") });
}

export async function onRequestGet(context) {
  const headers = responseHeaders(context.request.headers.get("Origin"));
  const auth = await authenticate(context, headers);
  if (auth.error) return auth.error;

  try {
    const record = await readRecord(context.env.PORTAL_KV, auth.user);
    const preferences = record?.preferences || defaultTeamCommunicationPreferences(auth.user);
    return json(communicationPreferencesView({
      user: auth.user,
      preferences,
      saved: Boolean(record),
      storageAvailable: Boolean(context.env.PORTAL_KV),
      updatedAt: record?.updatedAt || null,
    }), 200, headers);
  } catch (error) {
    return json({ error: `Could not read communication preferences: ${String(error?.message || error)}` }, 500, headers);
  }
}

export async function onRequestPut(context) {
  const headers = responseHeaders(context.request.headers.get("Origin"));
  const auth = await authenticate(context, headers);
  if (auth.error) return auth.error;
  if (!context.env.PORTAL_KV) return json({ error: "Communication preference storage is not configured" }, 422, headers);

  const { body, error: bodyError } = await parseJsonBody(context.request, headers);
  if (bodyError) return bodyError;

  let preferences;
  try {
    preferences = normalizeTeamCommunicationPreferences(body.preferences || body, auth.user);
  } catch (error) {
    return json({ error: String(error?.message || error) }, 400, headers);
  }

  const updatedAt = new Date().toISOString();
  const stored = {
    version: preferences.version,
    user: auth.user,
    preferences,
    updatedAt,
    updatedBy: auth.user,
    appliedToDelivery: false,
  };

  try {
    await context.env.PORTAL_KV.put(preferenceKey(auth.user), JSON.stringify(stored));
    return json(communicationPreferencesView({
      user: auth.user,
      preferences,
      saved: true,
      storageAvailable: true,
      updatedAt,
    }), 200, headers);
  } catch (error) {
    return json({ error: `Could not save communication preferences: ${String(error?.message || error)}` }, 500, headers);
  }
}
