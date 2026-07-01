// GHL API helpers for Cloudflare Worker environment.
// Tokens are managed in PORTAL_KV by the ghl-token-refresh worker. Token
// plumbing itself lives in the shared functions/lib/ghl-worker-token.js
// (2026-07-01 — extracted from 7 identical per-Worker copies during the
// cron-job architecture audit).

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";

export { getAccessToken };

const GHL_BASE = "https://services.leadconnectorhq.com";

export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

export const FIELD_IDS = {
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  sessions_completed: "TE0udwVH1Km5RsKaN5H0",
  series_type: "3i93lTkmuAV49s9nh0q8",
  portal_access: "O0xmwyRqeNK2EA1GGGye",
};

// ── GHL API fetch ──

export async function ghlFetch(env, path) {
  const token = await getAccessToken(env);
  const url = new URL(`${GHL_BASE}${path}`);
  if (!url.searchParams.has("locationId") && !url.searchParams.has("altId")) {
    url.searchParams.set("locationId", LOCATION_ID);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL API ${res.status}: ${errText}`);
  }
  return res.json();
}

// ── Field extraction ──

export function extractFields(customFields) {
  const byId = {};
  for (const cf of customFields) {
    byId[cf.id] = cf.value;
  }
  return {
    sessions_remaining: byId[FIELD_IDS.sessions_remaining] ?? null,
    sessions_completed: byId[FIELD_IDS.sessions_completed] ?? null,
    series_type: byId[FIELD_IDS.series_type] ?? null,
    portal_access: byId[FIELD_IDS.portal_access] ?? null,
  };
}

// ── Pacific Time helpers ──

const PT = "America/Los_Angeles";

export function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
}

export function dateToRange(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 20, 0, 0));
  const ptHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: PT,
      hour: "2-digit",
      hour12: false,
    }).format(probe)
  );
  const utcHourForMidnight = 20 - ptHour;
  const startMs = Date.UTC(year, month - 1, day, utcHourForMidnight, 0, 0);
  return { startTime: startMs, endTime: startMs + 86_400_000 - 1 };
}

// ── Calendar & appointment fetching ──

export async function fetchAppointmentsForDate(env, dateStr) {
  const { startTime, endTime } = dateToRange(dateStr);
  const calData = await ghlFetch(env, `/calendars/`);
  const calendars = calData.calendars || [];

  const appointmentMap = new Map();
  for (const cal of calendars) {
    try {
      const params = new URLSearchParams({
        locationId: LOCATION_ID,
        calendarId: cal.id,
        startTime: String(startTime),
        endTime: String(endTime),
      });
      const data = await ghlFetch(env, `/calendars/events?${params}`);
      for (const e of data.events || []) {
        if (!appointmentMap.has(e.id)) {
          appointmentMap.set(e.id, { ...e, calendarName: cal.name });
        }
      }
    } catch {
      // Individual calendar fetch failed — continue with others
    }
  }
  return Array.from(appointmentMap.values());
}

// ── Conversation fetching ──
// Note: GHL double-nests messages: msgData.messages?.messages

export async function fetchConversationHistory(env, contactId) {
  try {
    const data = await ghlFetch(
      env,
      `/conversations/search?contactId=${contactId}&limit=10`
    );
    const conversations = data.conversations || [];
    if (conversations.length === 0) return [];

    const threads = await Promise.all(
      conversations.slice(0, 3).map(async (conv) => {
        try {
          // Pull 50, keep 50. The audit's pre-session-reminder and post-session
          // checks scan a multi-hour window, so they need enough history that a
          // burst of other messages (toolkit sends, video links, day-of
          // coordination) doesn't bury the actual reminder. At limit=20/slice=10
          // a chatty contact (Jenn Kadri, 2026-06-03) pushed her real day-before
          // + 1-hour reminders out of view → false "no_pre_session_reminder".
          // 50 covers several days at this practice's volume; raise further or
          // switch to a windowed fetch if message volume ever grows past that.
          const msgData = await ghlFetch(
            env,
            `/conversations/${conv.id}/messages?limit=50`
          );
          const messages = (msgData.messages?.messages || [])
            .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
            .slice(0, 50)
            .map((m) => ({
              direction:
                m.direction === 0 || m.direction === "outbound"
                  ? "outbound"
                  : "inbound",
              type: m.messageType || m.type,
              date: m.dateAdded,
              body: m.body || m.message || "",
            }));
          return { conversationId: conv.id, messages };
        } catch {
          return null;
        }
      })
    );

    return threads.filter(Boolean);
  } catch (err) {
    if (
      err.message.includes("401") ||
      err.message.includes("not authorized")
    ) {
      return "scope_missing";
    }
    return null;
  }
}

// ── Lazy contact/conversation cache ──

export class ContactCache {
  constructor(env) {
    this.env = env;
    this.contacts = new Map();
    this.conversations = new Map();
  }

  async getContact(contactId) {
    if (this.contacts.has(contactId)) return this.contacts.get(contactId);
    try {
      const data = await ghlFetch(this.env, `/contacts/${contactId}`);
      const c = data.contact;
      const result = {
        contact: c,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        fields: extractFields(c.customFields || []),
        tags: c.tags || [],
      };
      this.contacts.set(contactId, result);
      return result;
    } catch {
      this.contacts.set(contactId, null);
      return null;
    }
  }

  async getConversations(contactId) {
    if (this.conversations.has(contactId))
      return this.conversations.get(contactId);
    const conv = await fetchConversationHistory(this.env, contactId);
    this.conversations.set(contactId, conv);
    return conv;
  }
}
