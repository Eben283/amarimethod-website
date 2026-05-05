// Google API utility — OAuth2 auto-refresh via Cloudflare KV
// Same pattern as ghl.js but for Google Calendar + Gmail

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function getPacificOffset() {
  const now = new Date();
  const utcStr = now.toLocaleString("en-US", { timeZone: "UTC" });
  const pacStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const utcDate = new Date(utcStr);
  const pacDate = new Date(pacStr);
  const diffHours = Math.round((pacDate - utcDate) / (60 * 60 * 1000));
  const sign = diffHours >= 0 ? "+" : "-";
  return `${sign}${String(Math.abs(diffHours)).padStart(2, "0")}:00`;
}

// Legacy un-namespaced keys (Eben's original setup, pre-multi-user).
// Read as a fallback for the "Eben" user only; writes always go to the
// new namespaced keys below. After Eben's first refresh post-deploy the
// new keys are populated and these become dead.
const LEGACY_KV_ACCESS_TOKEN = "google_access_token";
const LEGACY_KV_REFRESH_TOKEN = "google_refresh_token";
const LEGACY_KV_TOKEN_EXPIRY = "google_token_expiry";

const LEGACY_USER = "Eben";

function kvKeys(user) {
  const u = String(user || "").toLowerCase().trim() || "eben";
  return {
    access: `google:${u}:access_token`,
    refresh: `google:${u}:refresh_token`,
    expiry: `google:${u}:token_expiry`,
  };
}

/**
 * Get a valid Google access token for a specific user. Auto-refreshes
 * from KV if expired. Each user (Eben, Garrett, …) needs to have their
 * refresh_token written to KV via the setup flow before this works.
 */
export async function getGoogleToken(context, user) {
  const kv = context.env.PORTAL_KV;
  if (!kv) throw new Error("KV not available");

  const keys = kvKeys(user);
  const isLegacyUser = String(user || "").trim() === LEGACY_USER;

  const [accessToken, expiryStr] = await Promise.all([
    kv.get(keys.access),
    kv.get(keys.expiry),
  ]);

  let activeAccess = accessToken;
  let activeExpiry = expiryStr ? parseInt(expiryStr, 10) : 0;

  // Legacy fallback: if no namespaced access token but the user is Eben,
  // try the original un-namespaced keys so existing setups keep working.
  if (!activeAccess && isLegacyUser) {
    const [legacyAccess, legacyExpiryStr] = await Promise.all([
      kv.get(LEGACY_KV_ACCESS_TOKEN),
      kv.get(LEGACY_KV_TOKEN_EXPIRY),
    ]);
    if (legacyAccess) {
      activeAccess = legacyAccess;
      activeExpiry = legacyExpiryStr ? parseInt(legacyExpiryStr, 10) : 0;
    }
  }

  const now = Date.now();
  if (activeAccess && activeExpiry > now + REFRESH_BUFFER_MS) {
    return activeAccess;
  }

  let refreshToken = await kv.get(keys.refresh);
  if (!refreshToken && isLegacyUser) {
    refreshToken = await kv.get(LEGACY_KV_REFRESH_TOKEN);
  }
  if (!refreshToken) {
    throw new Error(`No Google refresh token in KV for user "${user}" — run setup first`);
  }

  return refreshGoogleToken(context, user, refreshToken);
}

async function refreshGoogleToken(context, user, refreshToken) {
  const clientId = context.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = context.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[google] Token refresh failed: ${response.status} ${errText}`);
    throw new Error("Google token refresh failed");
  }

  const data = await response.json();
  const newAccessToken = data.access_token;
  const expiresIn = data.expires_in || 3600;

  if (!newAccessToken) {
    throw new Error("No access_token in Google refresh response");
  }

  const kv = context.env.PORTAL_KV;
  const newExpiry = Date.now() + expiresIn * 1000;
  const keys = kvKeys(user);

  // Always write to the namespaced keys. If the response included a fresh
  // refresh_token (Google sometimes rotates them), persist that too — and
  // backfill from the legacy slot if the namespaced refresh wasn't there yet.
  const writes = [
    kv.put(keys.access, newAccessToken),
    kv.put(keys.expiry, String(newExpiry)),
    kv.put(keys.refresh, data.refresh_token || refreshToken),
  ];
  await Promise.all(writes);

  return newAccessToken;
}

/**
 * Create a Google Calendar event with a reminder.
 * @param {object} context - Cloudflare Pages context
 * @param {string} title - Event title
 * @param {number} minutesFromNow - When the event should be (minutes from now)
 * @param {number} reminderMinutes - Reminder before event (default 10)
 * @param {string} description - Optional event description
 * @returns {object} Created event data or null
 */
export async function createCalendarReminder(context, user, title, minutesFromNow, reminderMinutes = 30, description = "") {
  try {
    const token = await getGoogleToken(context, user);

    const start = new Date(Date.now() + minutesFromNow * 60 * 1000);
    const end = new Date(start.getTime() + 15 * 60 * 1000); // 15 min duration

    const event = {
      summary: title,
      description,
      start: {
        dateTime: start.toISOString(),
        timeZone: "America/Los_Angeles",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "America/Los_Angeles",
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: reminderMinutes },
        ],
      },
    };

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      console.error("[google] Calendar event create failed:", response.status);
      return null;
    }

    const data = await response.json();
    return {
      id: data.id,
      title: data.summary,
      start: data.start?.dateTime,
      link: data.htmlLink,
    };
  } catch (err) {
    console.error("[google] Calendar reminder error:", err.message);
    return null;
  }
}

/**
 * Delete a Google Calendar event by ID. Used to cancel stale reminders
 * (e.g. an old parking reminder when the user moves to a new spot).
 * Returns true on success, false on failure. 404/410 are treated as success
 * since the event is already gone.
 */
export async function deleteCalendarEvent(context, user, eventId) {
  try {
    const token = await getGoogleToken(context, user);
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (response.ok || response.status === 404 || response.status === 410) {
      return true;
    }
    console.error("[google] Calendar event delete failed:", response.status);
    return false;
  } catch (err) {
    console.error("[google] Calendar delete error:", err.message);
    return false;
  }
}

/**
 * Fetch today's calendar events.
 * Returns a formatted string for the system prompt.
 */
export async function getTodayCalendar(context, user) {
  try {
    const token = await getGoogleToken(context, user);

    const now = new Date();
    const pacificStr = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD

    // Use RFC 3339 with explicit Pacific offset — Google Calendar API handles this correctly
    const offset = getPacificOffset();
    const timeMin = `${pacificStr}T00:00:00${offset}`;
    const timeMax = `${pacificStr}T23:59:59${offset}`;

    // First, get all calendars the user has access to
    const calListResp = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    let calendarIds = ["primary"];
    if (calListResp.ok) {
      const calListData = await calListResp.json();
      calendarIds = (calListData.items || [])
        .filter(cal => !cal.deleted && cal.selected !== false)
        .map(cal => cal.id);
    }

    // Fetch events from all calendars in parallel
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
    });

    const allEvents = await Promise.all(
      calendarIds.map(async (calId) => {
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!response.ok) return [];
        const data = await response.json();
        return data.items || [];
      })
    );

    // Flatten, dedupe by event ID, and sort by start time
    const seen = new Set();
    const events = allEvents
      .flat()
      .filter(event => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      })
      .sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || "";
        const bTime = b.start?.dateTime || b.start?.date || "";
        return aTime.localeCompare(bTime);
      });

    if (events.length === 0) {
      return "No events scheduled today.";
    }

    const dayName = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
    const lines = events.map(event => {
      const start = event.start?.dateTime
        ? new Date(event.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })
        : "All day";
      const end = event.end?.dateTime
        ? new Date(event.end.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })
        : "";
      const location = event.location ? ` (${event.location})` : "";
      return end ? `- ${start} – ${end}: ${event.summary}${location}` : `- ${start}: ${event.summary}${location}`;
    });

    return `Today is ${dayName}:\n${lines.join("\n")}`;
  } catch (err) {
    console.error("[google] Calendar error:", err.message);
    return null;
  }
}

/**
 * Fetch recent emails (last 24h, max 10).
 * Returns a formatted string for context.
 */
export async function getRecentEmails(context, user) {
  try {
    const token = await getGoogleToken(context, user);

    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const params = new URLSearchParams({
      q: `after:${oneDayAgo} -category:promotions -category:social`,
      maxResults: "10",
    });

    const response = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      console.error("[google] Gmail list failed:", response.status);
      return null;
    }

    const data = await response.json();
    const messageIds = (data.messages || []).slice(0, 10);

    if (messageIds.length === 0) {
      return "No new emails in the last 24 hours.";
    }

    // Fetch message headers in parallel
    const messages = await Promise.all(
      messageIds.map(async ({ id }) => {
        const msgResp = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgResp.ok) return null;
        const msg = await msgResp.json();
        const headers = msg.payload?.headers || [];
        const subject = headers.find(h => h.name === "Subject")?.value || "(no subject)";
        const from = headers.find(h => h.name === "From")?.value || "Unknown";
        const fromName = from.includes("<") ? from.split("<")[0].trim().replace(/"/g, "") : from;
        return `- ${fromName}: ${subject}`;
      })
    );

    return `Recent emails (last 24h):\n${messages.filter(Boolean).join("\n")}`;
  } catch (err) {
    console.error("[google] Gmail error:", err.message);
    return null;
  }
}
