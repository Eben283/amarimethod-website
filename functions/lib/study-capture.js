// Shared study capture normalization + KV key helpers.
// Used by /api/staff-elbow-study (legacy elbow path) and /api/staff-study (all studies).
//
// Record shape is study-agnostic aside from intake field names kept for elbow
// backward compat: `arm` (left/right/both) and `gameImpact` (free text). The
// staff UI labels those per study via the registry.

import { STUDIES } from "./studies.js";

export const SESSION_COUNT = 3;
export const BODY_PART_VALUES = new Set(["left", "right", "both"]);
export const MAX_TEXT = 1000;
export const MAX_WEEKS = 520; // ~10 years — a sane upper bound, not a real limit
// Validated-survey guards. We don't duplicate the instrument's item list here
// (that lives in the staff app's data/studies.ts); we clamp shape only. The
// longest instrument in the program is ~20 items, so 40 keys is generous.
export const MAX_INSTRUMENT_ITEMS = 40;
export const MAX_ITEM_ID = 16;
const ITEM_ID_RE = /^[a-z0-9_-]+$/i;

// GHL number field "Study Sessions Done" (contact.study_sessions_done). Shared
// across all studies — the rebooking-nudge workflow triggers on it.
export const STUDY_SESSIONS_DONE_FIELD_ID = "Q9DqX2C4ml2TGW679UlM";

/** @param {string} studySlug @param {string} contactId */
export function kvKey(studySlug, contactId) {
  // Elbow keeps its original key so existing capture data stays put.
  if (studySlug === "tennis-elbow") return `elbow_study:${contactId}`;
  return `study:${studySlug}:${contactId}`;
}

export function isKnownStudySlug(slug) {
  return Boolean(slug && STUDIES[slug]);
}

// Coerce to an integer pain score in [0,10], else null. Never trust the client.
function normPain(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 0 || i > 10) return null;
  return i;
}

function normWeeks(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 0 || i > MAX_WEEKS) return null;
  return i;
}

function normText(v) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, MAX_TEXT);
}

function normAt(v) {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function normSession(raw, nowIso) {
  const s = raw && typeof raw === "object" ? raw : {};
  const before = normPain(s.before);
  const after = normPain(s.after);
  const notes = normText(s.notes);
  // Stamp `at` when there's real data and none was provided, so we know when a
  // session was recorded without trusting a client clock for existing values.
  const hasData = before !== null || after !== null || notes !== "";
  const at = normAt(s.at) || (hasData ? nowIso : null);
  return { before, after, notes, at };
}

// Coerce a client responses map into a clean {itemId: 0-10} object. Drops any
// key that isn't a short id-shaped string or whose value isn't a valid 0-10
// score, and caps the total item count. Whitelisting exact item ids is the
// staff app's job (it only renders real instrument items); here we clamp shape.
function normResponses(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  let count = 0;
  for (const key of Object.keys(v)) {
    if (count >= MAX_INSTRUMENT_ITEMS) break;
    if (typeof key !== "string" || key.length > MAX_ITEM_ID || !ITEM_ID_RE.test(key)) continue;
    const score = normPain(v[key]);
    if (score === null) continue; // unanswered items are simply absent
    out[key] = score;
    count += 1;
  }
  return out;
}

// One survey filling (baseline or final). Stamps `at` when there's real data
// and none was provided, mirroring normSession.
function normSnapshot(raw, nowIso) {
  const s = raw && typeof raw === "object" ? raw : {};
  const responses = normResponses(s.responses);
  const hasData = Object.keys(responses).length > 0;
  const at = normAt(s.at) || (hasData ? nowIso : null);
  return { responses, at };
}

// Pure: builds a fresh, fully-validated record from arbitrary client input.
// Returns a new object every call (no mutation of the input).
// Accepts either `arm` or `bodyPart` (same enum); either `gameImpact` or
// `activityImpact` (same string). Always writes the legacy elbow field names
// so existing clients and KV records stay compatible.
export function normalizeRecord(input, nowIso) {
  const src = input && typeof input === "object" ? input : {};
  const rawPart = src.bodyPart ?? src.arm;
  const arm = BODY_PART_VALUES.has(rawPart) ? rawPart : null;
  const painWeeks = normWeeks(src.painWeeks);
  const gameImpact = normText(src.activityImpact ?? src.gameImpact);
  const baseline = normSnapshot(src.baseline, nowIso);
  const final = normSnapshot(src.final, nowIso);

  const rawSessions = Array.isArray(src.sessions) ? src.sessions : [];
  const sessions = Array.from({ length: SESSION_COUNT }, (_, i) =>
    normSession(rawSessions[i], nowIso)
  );

  return { arm, painWeeks, gameImpact, baseline, final, sessions, updatedAt: nowIso };
}

/** Count sessions with an after-score — mirrored to GHL study_sessions_done. */
export function sessionsDoneCount(record) {
  return (record?.sessions || []).filter((s) => s.after !== null).length;
}
