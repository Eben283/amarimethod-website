// Live cache for Garrett's SF Personal Trainers outreach sheet.
//
// The checked-in JSON is a deploy-safe seed. On the first authenticated staff
// request after 20 hours, we refresh the four working tabs through Eben's Google
// OAuth connection and persist the normalized result to PORTAL_KV. That keeps a
// spreadsheet from quietly becoming the 62-day-old source of truth again while
// still letting the Follow-Up page work if Google is temporarily unavailable.

import seedCache from "./partner-sheet-cache.json";
import { getGoogleToken } from "./google-api.js";

const SPREADSHEET_ID = "1uYsTyyMu9NUefscLKORUglNXrhq_ylcUMZr4Ml-nMiw";
const CACHE_KEY = "partner-sheet:cache:v1";
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;
const RANGES = ["Sheet3!A:Q", "Yelp!A:G", "Insta!A:F", "Goog Maps!A:N"];

function clean(value) {
  const result = String(value || "").trim();
  return result || null;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 && /^[2-9]/.test(digits) ? digits : null;
}

function normalizeEmail(value) {
  const result = clean(value);
  return result && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)
    ? result.toLowerCase()
    : null;
}

function rowFromTab(tab, row) {
  if (tab === "Sheet3") {
    return { name: clean(row[0]), instagram: clean(row[1]), status: clean(row[2]), notes: clean(row[4]), category: clean(row[5]), raw_phone: clean(row[6]), phone: normalizePhone(row[6]), email: normalizeEmail(row[7]), website: clean(row[8]) };
  }
  if (tab === "Yelp") {
    return { name: clean(row[0]), category: clean(row[1]), website: clean(row[2]), email: normalizeEmail(row[3]), raw_phone: clean(row[4]), phone: normalizePhone(row[4]), instagram: clean(row[5]), status: clean(row[6]), notes: null };
  }
  if (tab === "Insta") {
    return { name: clean(row[1]) || clean(row[0]), instagram: clean(row[0]), status: clean(row[2]), notes: clean(row[4]), category: clean(row[5]), raw_phone: null, phone: null, email: null, website: null };
  }
  return { name: clean(row[0]), raw_phone: clean(row[1]), phone: normalizePhone(row[1]), email: normalizeEmail(row[2]), website: clean(row[3]), instagram: clean(row[4]), status: null, notes: null, category: clean(row[11]) };
}

function rowKey(row) {
  if (row.email) return `email:${row.email}`;
  if (row.phone) return `phone:${row.phone}`;
  return `name:${row.name.toLowerCase().replace(/\s+/g, " ")}`;
}

function mergeRow(existing, incoming) {
  // Earlier tabs are the working sheets and contain the user-entered status;
  // only fill a blank from later, supplementary source tabs.
  return {
    name: existing.name || incoming.name,
    phone: existing.phone || incoming.phone,
    email: existing.email || incoming.email,
    status: existing.status || incoming.status,
    notes: existing.notes || incoming.notes,
    instagram: existing.instagram || incoming.instagram,
    category: existing.category || incoming.category,
    website: existing.website || incoming.website,
    raw_phone: existing.raw_phone || incoming.raw_phone,
  };
}

export function makePartnerSheetCache(valueRanges) {
  const tabs = ["Sheet3", "Yelp", "Insta", "Goog Maps"];
  const deduped = new Map();
  for (let index = 0; index < tabs.length; index += 1) {
    const values = valueRanges[index]?.values || [];
    for (const sourceRow of values.slice(1)) {
      const row = rowFromTab(tabs[index], sourceRow);
      if (!row.name) continue;
      const key = rowKey(row);
      deduped.set(key, deduped.has(key) ? mergeRow(deduped.get(key), row) : row);
    }
  }
  const rows = [...deduped.values()];
  return {
    generatedAt: new Date().toISOString(),
    source: `SF Personal Trainers - Outreach (Google Sheet ID ${SPREADSHEET_ID})`,
    rowCount: rows.length,
    withStatus: rows.filter((row) => row.status).length,
    withNotes: rows.filter((row) => row.notes).length,
    rows,
    byPhone: Object.fromEntries(rows.filter((row) => row.phone).map((row) => [row.phone, row])),
    byEmail: Object.fromEntries(rows.filter((row) => row.email).map((row) => [row.email, row])),
  };
}

function usable(cache) {
  return cache && Array.isArray(cache.rows) && cache.byPhone && cache.byEmail && cache.generatedAt;
}

function stale(cache) {
  return !usable(cache) || Date.now() - new Date(cache.generatedAt).getTime() >= REFRESH_AFTER_MS;
}

async function fetchLiveSheet(context) {
  const token = await getGoogleToken(context, "Eben");
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet`);
  for (const range of RANGES) url.searchParams.append("ranges", range);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Sheet refresh failed (${response.status})`);
  const body = await response.json();
  return makePartnerSheetCache(body.valueRanges || []);
}

export async function getPartnerSheetCache(context) {
  let cached = seedCache;
  try {
    const kvCache = await context.env.PORTAL_KV?.get(CACHE_KEY, "json");
    if (usable(kvCache)) cached = kvCache;
  } catch (error) {
    console.error("[partner-sheet] KV read failed:", error);
  }
  if (!stale(cached)) return { cache: cached, refreshError: null };

  try {
    const fresh = await fetchLiveSheet(context);
    await context.env.PORTAL_KV?.put(CACHE_KEY, JSON.stringify(fresh));
    return { cache: fresh, refreshError: null };
  } catch (error) {
    const refreshError = error instanceof Error ? error.message : String(error);
    console.error("[partner-sheet] refresh failed; serving last good cache:", refreshError);
    return { cache: cached, refreshError };
  }
}
