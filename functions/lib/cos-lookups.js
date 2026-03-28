// Chief of Staff contextual lookups — weather, directions, restaurants, packages, revenue
// All functions return formatted strings for the system prompt or null on failure.

import { getGoogleToken, getPacificOffset } from "./google-api.js";
import { ghlFetch } from "./ghl.js";

const SF_LAT = 37.78;
const SF_LON = -122.46;

// Weather code descriptions (WMO codes)
const WEATHER_CODES = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
  80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
  95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

/**
 * Get current weather + today's forecast for SF.
 * Uses Open-Meteo (free, no API key).
 */
export async function getWeather() {
  try {
    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${SF_LAT}&longitude=${SF_LON}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&timezone=America/Los_Angeles&forecast_days=1`
    );
    if (!resp.ok) return null;
    const d = await resp.json();
    const c = d.current || {};

    const tempF = Math.round((c.temperature_2m || 0) * 9 / 5 + 32);
    const feelsF = Math.round((c.apparent_temperature || 0) * 9 / 5 + 32);
    const condition = WEATHER_CODES[c.weather_code] || "Unknown";
    const wind = Math.round((c.wind_speed_10m || 0) * 0.621371); // km/h to mph

    // Check hourly for rain later today
    const hourly = d.hourly || {};
    const rainProbs = hourly.precipitation_probability || [];
    const hours = hourly.time || [];
    const now = new Date();
    const currentHour = parseInt(now.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit" }));

    let rainLater = false;
    let maxRainProb = 0;
    for (let i = currentHour; i < Math.min(currentHour + 8, rainProbs.length); i++) {
      if (rainProbs[i] > 30) rainLater = true;
      if (rainProbs[i] > maxRainProb) maxRainProb = rainProbs[i];
    }

    const lines = [
      `Weather in SF right now: ${tempF}°F (feels like ${feelsF}°F), ${condition}, wind ${wind}mph`,
    ];

    if (c.precipitation > 0) {
      lines.push(`Currently raining (${c.precipitation}mm)`);
    }
    if (rainLater && c.precipitation === 0) {
      lines.push(`Rain likely later today (${maxRainProb}% chance) — bring a jacket`);
    }
    if (tempF < 55) {
      lines.push("It's chilly — layer up");
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[cos] Weather error:", err.message);
    return null;
  }
}

/**
 * Get directions and travel time between two locations.
 * Uses OSRM (free, no API key).
 */
export async function getDirections(from, to) {
  try {
    // Geocode both locations
    const [fromGeo, toGeo] = await Promise.all([
      geocode(from),
      geocode(to),
    ]);

    if (!fromGeo || !toGeo) return null;

    // Get driving directions from OSRM
    const resp = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${fromGeo.lon},${fromGeo.lat};${toGeo.lon},${toGeo.lat}?overview=false&alternatives=false`
    );
    if (!resp.ok) return null;
    const d = await resp.json();
    const route = d.routes?.[0];
    if (!route) return null;

    const durationMin = Math.round(route.duration / 60);
    const distanceMi = (route.distance / 1609.344).toFixed(1);

    // Add traffic buffer for known slow routes
    const isBridge = (from + to).toLowerCase().includes("oakland") ||
                     (from + to).toLowerCase().includes("berkeley") ||
                     (from + to).toLowerCase().includes("east bay");
    const trafficNote = isBridge ? " (add 15-30 min for bridge traffic during rush hour)" : "";

    return `Driving from ${fromGeo.name} to ${toGeo.name}: ${distanceMi} mi, ~${durationMin} min${trafficNote}`;
  } catch (err) {
    console.error("[cos] Directions error:", err.message);
    return null;
  }
}

/**
 * Search for nearby restaurants/places.
 * Uses Nominatim (free, no API key).
 */
export async function searchPlaces(query) {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + " San Francisco CA")}&format=json&limit=5&addressdetails=1`,
      { headers: { "User-Agent": "ChiefOfStaff/1.0" } }
    );
    if (!resp.ok) return null;
    const results = await resp.json();
    if (!results.length) return null;

    const lines = [`Places matching "${query}" in SF:`];
    for (const r of results) {
      const name = r.display_name.split(",").slice(0, 3).join(",");
      const type = r.type || r.class || "";
      lines.push(`- ${name} (${type})`);
    }
    return lines.join("\n");
  } catch (err) {
    console.error("[cos] Places error:", err.message);
    return null;
  }
}

/**
 * Search Gmail for shipping/tracking notifications.
 * Requires Google OAuth token.
 */
export async function getPackageTracking(context) {
  try {
    const token = await getGoogleToken(context);

    // Search for recent shipping notifications
    const params = new URLSearchParams({
      q: "subject:(shipped OR tracking OR delivered OR out for delivery OR arriving) newer_than:7d -category:promotions",
      maxResults: "8",
    });

    const resp = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const messageIds = (data.messages || []).slice(0, 8);
    if (!messageIds.length) return "No recent shipping notifications found.";

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
        const date = headers.find(h => h.name === "Date")?.value || "";
        const fromName = from.includes("<") ? from.split("<")[0].trim().replace(/"/g, "") : from;
        const shortDate = date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
        return `- ${shortDate}: ${fromName} — ${subject}`;
      })
    );

    const valid = messages.filter(Boolean);
    return valid.length > 0
      ? `Recent shipping/delivery emails:\n${valid.join("\n")}`
      : "No recent shipping notifications found.";
  } catch (err) {
    console.error("[cos] Package tracking error:", err.message);
    return null;
  }
}

/**
 * Get GHL revenue summary — payments received.
 * Uses GHL payments API.
 */
export async function getRevenueSummary(context) {
  try {
    const stripeKey = context.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return "Stripe not configured — cannot pull revenue data.";

    const now = new Date();
    const offset = getPacificOffset();
    const pacificDate = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const [y, m] = pacificDate.split("-").map(Number);

    const monthStartUnix = Math.floor(new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00${offset}`).getTime() / 1000);

    const currentDayOfWeek = now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" });
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const daysBack = dayMap[currentDayOfWeek] || 0;
    const todayUnix = Math.floor(new Date(`${pacificDate}T00:00:00${offset}`).getTime() / 1000);
    const weekStartUnix = todayUnix - (daysBack * 86400);

    // Fetch successful charges from Stripe for this month
    const params = new URLSearchParams({
      "created[gte]": String(monthStartUnix),
      "limit": "100",
    });

    const resp = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { "Authorization": `Bearer ${stripeKey}` },
    });

    if (!resp.ok) {
      console.error("[cos] Stripe API error:", resp.status);
      return "Failed to fetch Stripe data.";
    }

    const data = await resp.json();
    const charges = data.data || [];

    let monthTotal = 0;
    let weekTotal = 0;
    let todayTotal = 0;
    let succeededCount = 0;
    let failedCount = 0;
    const recentCharges = [];

    for (const charge of charges) {
      if (charge.status !== "succeeded") {
        failedCount++;
        continue;
      }

      succeededCount++;
      const amountDollars = charge.amount / 100; // Stripe always stores in cents
      const chargeDate = charge.created;

      monthTotal += amountDollars;
      if (chargeDate >= weekStartUnix) weekTotal += amountDollars;
      if (chargeDate >= todayUnix) todayTotal += amountDollars;

      if (recentCharges.length < 5) {
        const name = charge.billing_details?.name || charge.customer_email || "Unknown";
        const desc = charge.description || "";
        const date = new Date(chargeDate * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
        recentCharges.push(`- $${amountDollars.toLocaleString()}: ${name}${desc ? ` — ${desc}` : ""} (${date})`);
      }
    }

    const lines = [
      `Revenue this month: $${monthTotal.toLocaleString()} (${succeededCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""})`,
      `This week: $${weekTotal.toLocaleString()}`,
    ];
    if (todayTotal > 0) lines.push(`Today: $${todayTotal.toLocaleString()}`);
    if (recentCharges.length > 0) {
      lines.push(`\nRecent payments:\n${recentCharges.join("\n")}`);
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[cos] Revenue error:", err.message);
    return null;
  }
}

// Shared geocoding helper
async function geocode(location) {
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location + ", San Francisco, CA")}&format=json&limit=1`,
    { headers: { "User-Agent": "ChiefOfStaff/1.0" } }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    name: data[0].display_name.split(",").slice(0, 2).join(",").trim(),
  };
}
