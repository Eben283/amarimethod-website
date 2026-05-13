// Parking history + street-sweeping rules database for COS.
// Two KV stores:
//   cos:parking-history:{user} — JSON array of past parks (FIFO, capped)
//   cos:parking-rules           — shared JSON map of location → posted rules
//
// History is per-user. Rules are shared because the rules at "9th Ave near
// Cabrillo" don't change based on who parked there.

const HISTORY_CAP = 100;
const RULES_CAP = 300;
const HISTORY_KEY = (user) => `cos:parking-history:${user}`;
const RULES_KEY = "cos:parking-rules";
const SF_SWEEP_KEY = "cos:sf-sweep-index";

// 24-hour numeric hour → "5am" / "12pm" / "1pm"
function formatHour(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return String(h);
  if (n === 0) return "12am";
  if (n < 12) return `${n}am`;
  if (n === 12) return "12pm";
  return `${n - 12}pm`;
}

function humanizeSweep(entry) {
  const fh = formatHour(entry.fh);
  const th = formatHour(entry.th);
  return `${entry.d} ${fh}–${th}`;
}

// Normalize a location label into a stable lookup key.
// "9th Ave between Cabrillo and Lincoln" → "9th ave between cabrillo and lincoln"
// Strips punctuation + collapses whitespace; lowercases. Side is kept separate.
export function normalizeLocation(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[.,;:!?'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uuid() {
  // Worker runtime has crypto.randomUUID
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readJSON(kv, key, fallback) {
  if (!kv) return fallback;
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function getParkingHistory(env, user, limit = 20) {
  const kv = env.PORTAL_KV;
  const history = await readJSON(kv, HISTORY_KEY(user), []);
  return history.slice(-Math.max(1, Math.min(limit, HISTORY_CAP))).reverse();
}

export async function getCurrentPark(env, user) {
  const history = await getParkingHistory(env, user, 1);
  return history[0] || null;
}

export async function getAllRules(env) {
  const kv = env.PORTAL_KV;
  return readJSON(kv, RULES_KEY, {});
}

// Substring search across rule keys + labels. Returns matches sorted by
// length of overlap (longer = more specific).
export async function lookupParkingRules(env, query) {
  const rules = await getAllRules(env);
  const q = normalizeLocation(query);
  if (!q) return [];

  const tokens = q.split(" ").filter(Boolean);
  const matches = [];
  for (const [key, value] of Object.entries(rules)) {
    const haystack = `${key} ${normalizeLocation(value.label || "")}`;
    const hits = tokens.filter(t => haystack.includes(t)).length;
    if (hits > 0) {
      matches.push({ key, score: hits, ...value });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 5);
}

// Search the seeded SF Public Works street-sweeping index for blocks
// matching a free-text location query. Returns up to `limit` matches
// scored by how many query tokens hit the corridor + cross-street label.
export async function lookupSfSweep(env, query, limit = 6) {
  const kv = env.PORTAL_KV;
  if (!kv) return { available: false, matches: [] };
  const raw = await kv.get(SF_SWEEP_KEY);
  if (!raw) return { available: false, matches: [] };

  let index;
  try {
    index = JSON.parse(raw);
  } catch {
    return { available: false, matches: [] };
  }
  const rows = Array.isArray(index) ? index : index.rows || [];
  const q = normalizeLocation(query);
  if (!q || rows.length === 0) return { available: true, matches: [] };

  const tokens = q.split(" ").filter(t => t.length >= 2);
  if (tokens.length === 0) return { available: true, matches: [] };

  // Score every row by how many tokens hit its haystack.
  // First pass: filter rows where the strongest token (typically the
  // street name) hits — keeps the inner loop cheap on 30k rows.
  const scored = [];
  for (const r of rows) {
    const haystack = `${r.s} ${r.l}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score++;
    }
    if (score >= 2 || (score === 1 && tokens.length === 1)) {
      scored.push({ score, ...r });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map(r => ({
    corridor: r.s,
    limits: r.l,
    side: r.b,
    schedule: humanizeSweep(r),
    score: r.score,
  }));
  return { available: true, total_rows: rows.length, matches: top };
}

export async function writeSfSweepIndex(env, rows) {
  const kv = env.PORTAL_KV;
  if (!kv) throw new Error("KV not available");
  await kv.put(SF_SWEEP_KEY, JSON.stringify({
    rows,
    count: rows.length,
    updated_at: new Date().toISOString(),
  }));
  return { count: rows.length };
}

export async function getSfSweepIndexMeta(env) {
  const kv = env.PORTAL_KV;
  if (!kv) return null;
  const raw = await kv.get(SF_SWEEP_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      count: data.count ?? (Array.isArray(data) ? data.length : 0),
      updated_at: data.updated_at || null,
    };
  } catch {
    return null;
  }
}

// Append a parking event to history. If `rule` is provided, also merges
// it into the shared rules database under the normalized location key.
export async function recordPark(env, user, entry) {
  const kv = env.PORTAL_KV;
  if (!kv) throw new Error("KV not available");

  const now = new Date().toISOString();
  const location = String(entry.location || "").trim();
  if (!location) throw new Error("location is required");

  const block_key = normalizeLocation(location);
  const side = entry.side ? String(entry.side).toLowerCase() : null;

  const event = {
    id: uuid(),
    location,
    block_key,
    side,
    rule_type: entry.rule_type || "unknown",
    rule_detail: entry.rule_detail || null,
    parked_at: entry.parked_at || now,
    deadline_iso: entry.deadline_iso || null,
    reminder_event_id: entry.reminder_event_id || null,
    notes: entry.notes || null,
    recorded_at: now,
  };

  const history = await readJSON(kv, HISTORY_KEY(user), []);
  history.push(event);
  while (history.length > HISTORY_CAP) history.shift();
  await kv.put(HISTORY_KEY(user), JSON.stringify(history));

  // Mirror rule into the shared rules DB so we can recall it next time.
  if (entry.rule_type && entry.rule_type !== "unknown" && entry.rule_type !== "none") {
    await upsertRule(env, {
      location_label: location,
      side,
      rule_type: entry.rule_type,
      rule_detail: entry.rule_detail || null,
      learned_from: user,
    });
  }

  return event;
}

// Add or merge a rule into the shared parking-rules DB.
// Rules are stored per-block and per-side (each side of a street has its
// own posted schedule).
export async function upsertRule(env, { location_label, side, rule_type, rule_detail, learned_from }) {
  const kv = env.PORTAL_KV;
  if (!kv) throw new Error("KV not available");
  if (!location_label) throw new Error("location_label is required");

  const rules = await readJSON(kv, RULES_KEY, {});
  const key = normalizeLocation(location_label);
  const now = new Date().toISOString();

  const existing = rules[key] || {
    label: location_label,
    sides: {},
    updated_at: now,
    learned_from: [],
  };

  const sideKey = side || "unspecified";
  const sideEntry = existing.sides[sideKey] || { rules: [] };

  const ruleRecord = {
    rule_type,
    rule_detail: rule_detail || null,
    updated_at: now,
  };

  // Replace any prior rule of the same type on the same side; otherwise append.
  const idx = sideEntry.rules.findIndex(r => r.rule_type === rule_type);
  if (idx >= 0) sideEntry.rules[idx] = ruleRecord;
  else sideEntry.rules.push(ruleRecord);

  existing.sides[sideKey] = sideEntry;
  existing.updated_at = now;
  if (learned_from && !existing.learned_from.includes(learned_from)) {
    existing.learned_from.push(learned_from);
  }

  rules[key] = existing;

  // Cap rules map size — drop oldest by updated_at if over the cap.
  const keys = Object.keys(rules);
  if (keys.length > RULES_CAP) {
    const sorted = keys
      .map(k => [k, rules[k].updated_at || ""])
      .sort((a, b) => a[1].localeCompare(b[1]));
    const toDrop = sorted.slice(0, keys.length - RULES_CAP).map(([k]) => k);
    for (const k of toDrop) delete rules[k];
  }

  await kv.put(RULES_KEY, JSON.stringify(rules));
  return existing;
}

// Format helpers for tool_result strings — keep them compact for the model.
export function formatHistoryForModel(events) {
  if (!events || events.length === 0) return "No parking history recorded.";
  return events
    .map(e => {
      const when = e.parked_at ? new Date(e.parked_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "(unknown time)";
      const sideStr = e.side ? ` (${e.side} side)` : "";
      const ruleStr = e.rule_detail ? ` — ${e.rule_type}: ${e.rule_detail}` : e.rule_type ? ` — ${e.rule_type}` : "";
      const dl = e.deadline_iso ? ` [deadline: ${new Date(e.deadline_iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" })}]` : "";
      return `- ${when}: ${e.location}${sideStr}${ruleStr}${dl}`;
    })
    .join("\n");
}

export function formatRulesForModel(matches) {
  if (!matches || matches.length === 0) return "No stored rules match that location.";
  return matches
    .map(m => {
      const sides = Object.entries(m.sides || {})
        .map(([sideKey, sideVal]) => {
          const rs = (sideVal.rules || [])
            .map(r => `${r.rule_type}${r.rule_detail ? ": " + r.rule_detail : ""}`)
            .join("; ");
          return `  ${sideKey}: ${rs || "(no rules recorded)"}`;
        })
        .join("\n");
      return `${m.label}\n${sides}`;
    })
    .join("\n\n");
}

export function formatSfSweepForModel(result) {
  if (!result || !result.available) return null;
  if (!result.matches || result.matches.length === 0) {
    return "No SF Public Works sweep schedule matched that location.";
  }
  return result.matches
    .map(m => `- ${m.corridor} (${m.limits}), ${m.side} side: ${m.schedule}`)
    .join("\n");
}
