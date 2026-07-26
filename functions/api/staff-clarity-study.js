// Cloudflare Pages Function: GET /api/staff-clarity-study?days=1|2|3
//
// Staff-only summary of Microsoft Clarity's last 1–3 days for /book/study.
// The Clarity token is a production Pages secret and is only ever used in the
// server-to-server Authorization header below. Never add it to client code.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";

const CLARITY_ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";
const STUDY_PATH = "/book/study";

const SIGNAL_METRICS = new Set([
  "Dead Click Count",
  "Rage Click Count",
  "Quickback Click",
  "Excessive Scroll",
  "Error Click Count",
  "Script Error Count",
]);

function isStudyUrl(value) {
  try {
    return new URL(value).pathname.replace(/\/$/, "") === STUDY_PATH;
  } catch {
    return value === STUDY_PATH || value === `${STUDY_PATH}/`;
  }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricName(metric) {
  return String(metric?.metricName || "").trim();
}

function rowsForStudy(metric) {
  return (Array.isArray(metric?.information) ? metric.information : []).filter((row) => {
    const url = row.URL || row.Url || row.url || "";
    return isStudyUrl(url);
  });
}

function firstText(row, keys) {
  for (const key of keys) {
    if (typeof row[key] === "string" && row[key]) return row[key];
  }
  return "(not reported)";
}

export function summarizeClarity(payload, days) {
  const traffic = new Map();
  const signals = new Map();
  const referrers = new Map();

  for (const metric of Array.isArray(payload) ? payload : []) {
    const name = metricName(metric);
    const rows = rowsForStudy(metric);
    if (name === "Traffic") {
      for (const row of rows) {
        const source = firstText(row, ["Source", "source"]);
        const device = firstText(row, ["Device", "device"]);
        const key = `${source}\u0000${device}`;
        const current = traffic.get(key) || {
          source,
          device,
          sessions: 0,
          users: 0,
          botSessions: 0,
        };
        current.sessions += number(row.totalSessionCount);
        // Microsoft has returned both spellings in exported examples; accept either.
        current.users += number(row.distinctUserCount ?? row.distantUserCount);
        current.botSessions += number(row.totalBotSessionCount);
        traffic.set(key, current);
      }
    }
    if (SIGNAL_METRICS.has(name)) {
      for (const row of rows) {
        const signal = signals.get(name) || { name, count: 0 };
        signal.count += number(
          row.count ?? row.value ?? row.totalCount ?? row.totalSessionCount ?? row[name]
        );
        signals.set(name, signal);
      }
    }
    if (name === "Referrer URL") {
      for (const row of rows) {
        const referrer = firstText(row, ["Referrer URL", "referrerUrl", "Referrer", "referrer"]);
        if (referrer === "(not reported)") continue;
        const current = referrers.get(referrer) || { referrer, sessions: 0 };
        current.sessions += number(row.totalSessionCount ?? row.count ?? row.value);
        referrers.set(referrer, current);
      }
    }
  }

  const sources = Array.from(traffic.values()).sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source));
  const deviceTypes = Array.from(traffic.values())
    .reduce((acc, row) => {
      const current = acc.get(row.device) || { device: row.device, sessions: 0, users: 0, botSessions: 0 };
      current.sessions += row.sessions;
      current.users += row.users;
      current.botSessions += row.botSessions;
      acc.set(row.device, current);
      return acc;
    }, new Map());

  return {
    path: STUDY_PATH,
    window: { days, timezone: "UTC", note: "Clarity Data Export covers only the previous 1–3 days; use the Clarity dashboard for older history." },
    visits: sources.reduce((sum, row) => sum + row.sessions, 0),
    uniqueVisitors: sources.reduce((sum, row) => sum + row.users, 0),
    botSessions: sources.reduce((sum, row) => sum + row.botSessions, 0),
    referrerSource: sources,
    referrerUrl: Array.from(referrers.values()).sort((a, b) => b.sessions - a.sessions || a.referrer.localeCompare(b.referrer)),
    deviceType: Array.from(deviceTypes.values()).sort((a, b) => b.sessions - a.sessions || a.device.localeCompare(b.device)),
    interactionSignals: Array.from(signals.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const days = Number(new URL(context.request.url).searchParams.get("days") || "3");
  if (!Number.isInteger(days) || days < 1 || days > 3) {
    return new Response(JSON.stringify({ error: "days must be 1, 2, or 3" }), { status: 400, headers });
  }
  if (!context.env.CLARITY_API_TOKEN) {
    return new Response(JSON.stringify({ error: "Clarity export is not configured" }), { status: 503, headers });
  }

  const params = new URLSearchParams({ numOfDays: String(days), dimension1: "URL", dimension2: "Source", dimension3: "Device" });
  let response;
  try {
    response = await fetch(`${CLARITY_ENDPOINT}?${params}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${context.env.CLARITY_API_TOKEN}`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Clarity export service could not be reached" }), { status: 502, headers });
  }

  if (!response.ok) {
    // Do not relay the provider body: it may change and should never be treated as safe to expose.
    const diagnosis = response.status === 403
      ? "Clarity rejected this token for Data Export. Confirm it was generated by an admin of the Clarity project that tracks amarimethod.com, then replace the Pages production secret."
      : response.status === 401
        ? "Clarity rejected the export token as missing, invalid, or expired. Regenerate it in that Clarity project's Data Export settings and update the Pages production secret."
        : response.status === 429
          ? "Clarity's daily export-request quota has been reached. Try again tomorrow."
          : "Clarity export request failed.";
    return new Response(JSON.stringify({ error: diagnosis, clarityStatus: response.status }), { status: 502, headers });
  }

  try {
    return new Response(JSON.stringify(summarizeClarity(await response.json(), days)), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Clarity returned an unexpected response" }), { status: 502, headers });
  }
}
