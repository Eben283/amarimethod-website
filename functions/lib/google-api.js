// Google API utility — OAuth2 auto-refresh via Cloudflare KV
// Same pattern as ghl.js but for Google Calendar + Gmail

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "google_access_token";
const KV_REFRESH_TOKEN = "google_refresh_token";
const KV_TOKEN_EXPIRY = "google_token_expiry";

/**
 * Get a valid Google access token. Auto-refreshes from KV if expired.
 */
export async function getGoogleToken(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) throw new Error("KV not available");

  const [accessToken, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);

  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  const now = Date.now();

  if (accessToken && expiry > now + REFRESH_BUFFER_MS) {
    return accessToken;
  }

  const refreshToken = await kv.get(KV_REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error("No Google refresh token in KV — run setup first");
  }

  return refreshGoogleToken(context, refreshToken);
}

async function refreshGoogleToken(context, refreshToken) {
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

  await Promise.all([
    kv.put(KV_ACCESS_TOKEN, newAccessToken),
    kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
  ]);

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
export async function createCalendarReminder(context, title, minutesFromNow, reminderMinutes = 10, description = "") {
  try {
    const token = await getGoogleToken(context);

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
 * Fetch today's calendar events.
 * Returns a formatted string for the system prompt.
 */
export async function getTodayCalendar(context) {
  try {
    const token = await getGoogleToken(context);

    const now = new Date();
    const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const startOfDay = new Date(pacific);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(pacific);
    endOfDay.setHours(23, 59, 59, 999);

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
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
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

    const dayName = pacific.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
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
export async function getRecentEmails(context) {
  try {
    const token = await getGoogleToken(context);

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
