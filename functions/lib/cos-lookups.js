// Chief of Staff contextual lookups — weather, directions, restaurants, packages, revenue
// All functions return formatted strings for the system prompt or null on failure.

import { getGoogleToken } from "./google-api.js";
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
    const currentHour = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getHours();

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
    const locationId = "7pIO7FHVAyBT1jKGhfQM";

    // Get current month date range
    const now = new Date();
    const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const monthStart = new Date(pacific.getFullYear(), pacific.getMonth(), 1);
    const startDate = monthStart.toISOString().split("T")[0];

    // Also get this week
    const dayOfWeek = pacific.getDay();
    const weekStart = new Date(pacific);
    weekStart.setDate(pacific.getDate() - dayOfWeek);
    const weekStartDate = weekStart.toISOString().split("T")[0];
    const today = pacific.toISOString().split("T")[0];

    // Try the orders/transactions endpoint
    const resp = await ghlFetch(context,
      `https://services.leadconnectorhq.com/payments/orders?altId=${locationId}&altType=location&startAt=${startDate}&endAt=${today}&limit=100`
    );

    if (!resp.ok) {
      // Fallback: try opportunities with monetary value
      const oppResp = await ghlFetch(context,
        `https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&limit=100`
      );
      if (!oppResp.ok) return null;
      const oppData = await oppResp.json();
      const opps = oppData.opportunities || [];
      const withValue = opps.filter(o => o.monetaryValue > 0);
      const totalValue = withValue.reduce((sum, o) => sum + (o.monetaryValue || 0), 0);
      return totalValue > 0
        ? `Pipeline monetary value: $${totalValue.toLocaleString()} across ${withValue.length} opportunities`
        : null;
    }

    const data = await resp.json();
    const orders = data.data || data.orders || [];

    if (!orders.length) return "No payments recorded this month in GHL.";

    let monthTotal = 0;
    let weekTotal = 0;
    let todayTotal = 0;
    const recentOrders = [];

    for (const order of orders) {
      const amount = order.amount || order.total || 0;
      const orderDate = (order.createdAt || order.created_at || "").split("T")[0];
      const amountDollars = amount; // GHL stores in dollars

      monthTotal += amountDollars;
      if (orderDate >= weekStartDate) weekTotal += amountDollars;
      if (orderDate === today) todayTotal += amountDollars;

      if (recentOrders.length < 5) {
        const name = order.contactName || order.contact_name || "Unknown";
        recentOrders.push(`- $${amountDollars}: ${name} (${orderDate})`);
      }
    }

    const lines = [
      `Revenue this month: $${monthTotal.toLocaleString()}`,
      `This week: $${weekTotal.toLocaleString()}`,
    ];
    if (todayTotal > 0) lines.push(`Today: $${todayTotal.toLocaleString()}`);
    if (recentOrders.length > 0) {
      lines.push(`\nRecent payments:\n${recentOrders.join("\n")}`);
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
