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
const SF_ADDRESS_DATASET = "3mea-di5p";
const SF_STREET_SEGMENTS_DATASET = "3psu-pn9h";
const STREET_TYPE_ALIASES = [
  [/\baly\b/g, "alley"],
  [/\bave\b/g, "avenue"],
  [/\bav\b/g, "avenue"],
  [/\bst\b/g, "street"],
  [/\bblvd\b/g, "boulevard"],
  [/\bcir\b/g, "circle"],
  [/\brd\b/g, "road"],
  [/\bdr\b/g, "drive"],
  [/\bexpy\b/g, "expressway"],
  [/\bln\b/g, "lane"],
  [/\bct\b/g, "court"],
  [/\bpl\b/g, "place"],
  [/\bplz\b/g, "plaza"],
  [/\bsq\b/g, "square"],
  [/\bter\b/g, "terrace"],
  [/\bpkwy\b/g, "parkway"],
  [/\bhwy\b/g, "highway"],
];
const CITY_STREET_TYPES = {
  alley: "ALY",
  avenue: "AVE",
  boulevard: "BLVD",
  circle: "CIR",
  court: "CT",
  drive: "DR",
  expressway: "EXPY",
  highway: "HWY",
  lane: "LN",
  park: "PARK",
  parkway: "PKWY",
  place: "PL",
  plaza: "PLZ",
  road: "RD",
  square: "SQ",
  street: "ST",
  terrace: "TER",
  walk: "WALK",
  way: "WAY",
};

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

export function compactSfSweepRow(row) {
  return {
    c: row.cnn || "",
    s: row.corridor || "",
    l: row.limits || "",
    r: row.cnnrightleft || "",
    b: row.blockside || "",
    d: row.fullname || row.weekday || "",
    fh: row.fromhour !== undefined ? Number(row.fromhour) : null,
    th: row.tohour !== undefined ? Number(row.tohour) : null,
    w: [1, 2, 3, 4, 5].filter(week => Number(row[`week${week}`]) === 1),
    h: Number(row.holidays) === 1 ? 1 : 0,
  };
}

// Normalize a location label into a stable lookup key.
// "9th Ave between Cabrillo and Lincoln" → "9th ave between cabrillo and lincoln"
// Strips punctuation + collapses whitespace; lowercases. Side is kept separate.
export function normalizeLocation(label) {
  let normalized = String(label || "")
    .toLowerCase()
    .replace(/[.,;:!?'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [alias, fullName] of STREET_TYPE_ALIASES) {
    normalized = normalized.replace(alias, fullName);
  }
  return normalized.replace(/\b0+(\d+(?:st|nd|rd|th))\b/g, "$1");
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

function parseSfStreetAddress(query) {
  // Parking messages normally contain a sentence ("I parked at 763 ..."),
  // not just a bare address.  Keep the house number as the identifier; it is
  // what lets the City address and segment tables identify the curb side.
  const match = String(query || "").match(/\b(\d+)\s+(.+)$/);
  if (!match) return null;
  let streetLabel = match[2]
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,;:!?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [alias, fullName] of STREET_TYPE_ALIASES) {
    streetLabel = streetLabel.replace(alias, fullName);
  }
  const words = streetLabel.split(" ");
  const typeIndex = words.findIndex((word, index) => index > 0 && CITY_STREET_TYPES[word]);
  const type = CITY_STREET_TYPES[words[typeIndex]];
  if (!type) return null;
  return { number: Number(match[1]), street: `${words.slice(0, typeIndex).join(" ").toUpperCase()} ${type}` };
}

async function fetchCityRows(dataset, params) {
  const url = new URL(`https://data.sfgov.org/resource/${dataset}.json`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

function escapeSocrataLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function numberIsInRange(number, from, to) {
  const low = Number(from);
  const high = Number(to);
  return Number.isFinite(low)
    && Number.isFinite(high)
    && number >= Math.min(low, high)
    && number <= Math.max(low, high)
    && number % 2 === low % 2;
}

async function resolveSfAddress(query) {
  const address = parseSfStreetAddress(query);
  if (!address) return null;
  const addressRows = await fetchCityRows(SF_ADDRESS_DATASET, {
    "$select": "cnn",
    "$where": `address_number=${address.number} AND street_full_street_name='${escapeSocrataLiteral(address.street)}'`,
    "$limit": "2",
  });
  if (addressRows === null) return { unavailable: true, reason: "city_address_unavailable" };
  const [match] = addressRows;
  if (!match?.cnn) return null;

  const segmentRows = await fetchCityRows(SF_STREET_SEGMENTS_DATASET, {
    "$select": "lf_fadd,lf_toadd,rt_fadd,rt_toadd",
    "$where": `cnn=${Number(match.cnn)}`,
    "$limit": "1",
  });
  if (segmentRows === null) return { unavailable: true, reason: "city_segment_unavailable" };
  const [segment] = segmentRows;
  if (!segment) return { cnn: String(match.cnn), side: null };

  const left = numberIsInRange(address.number, segment.lf_fadd, segment.lf_toadd);
  const right = numberIsInRange(address.number, segment.rt_fadd, segment.rt_toadd);
  return { cnn: String(match.cnn), side: left === right ? null : left ? "L" : "R" };
}

async function fetchCurrentSfSweepRows(cnn) {
  const rows = await fetchCityRows("yhqp-riqs", {
    "$where": `cnn='${cnn}'`,
    "$limit": "10",
  });
  if (rows === null) return null;
  return rows.map(compactSfSweepRow);
}

// Search the seeded SF Public Works street-sweeping index for blocks
// matching a free-text location query. Returns up to `limit` matches
// scored by how many query tokens hit the corridor + cross-street label.
export async function lookupSfSweep(env, query, limit = 6) {
  const kv = env.PORTAL_KV;
  if (!kv) return { available: false, matches: [] };
  const raw = await kv.get(SF_SWEEP_KEY);
  let rows = [];
  let cacheReason = "missing_index";
  if (raw) {
    try {
      const index = JSON.parse(raw);
      rows = Array.isArray(index) ? index : index.rows || [];
      cacheReason = rows.length > 0 ? null : "empty_index";
    } catch {
      cacheReason = "invalid_index";
    }
  }
  const q = normalizeLocation(query);
  if (!q) return { available: rows.length > 0, resolution: "none", match_count: 0, matches: [] };

  const tokens = q.split(" ").filter(t => t.length >= 2);
  if (tokens.length === 0) return { available: rows.length > 0, resolution: "none", match_count: 0, matches: [] };

  // Score every row by how many tokens hit its haystack.
  // First pass: filter rows where the strongest token (typically the
  // street name) hits — keeps the inner loop cheap on 30k rows.
  const scored = [];
  for (const r of rows) {
    const haystack = normalizeLocation(`${r.s} ${r.l}`);
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score++;
    }
    if (score >= 2 || (score === 1 && tokens.length === 1)) {
      scored.push({ score, ...r });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const hasHouseNumber = Boolean(parseSfStreetAddress(query));
  const address = await resolveSfAddress(query);
  if (address?.unavailable) {
    return { available: false, reason: address.reason, matches: [] };
  }
  // A numbered address must resolve through the City's current records.  A
  // cached match can be stale or from the opposite curb side, so never let it
  // override the live schedule for an exact parking location.
  if (hasHouseNumber && !address) {
    return { available: false, reason: "address_unresolved", matches: [] };
  }
  let exact = [];
  if (address) {
    const currentRows = await fetchCurrentSfSweepRows(address.cnn);
    if (currentRows === null) {
      return { available: false, reason: "city_schedule_unavailable", matches: [] };
    }
    exact = currentRows
      .filter(row => !address.side || row.r === address.side)
      .map(row => ({ ...row, score: 100 }));
  }
  if (!address && rows.length === 0 && exact.length === 0) {
    return { available: false, reason: cacheReason, matches: [] };
  }
  const selected = address ? exact : scored;
  const top = selected.slice(0, limit).map(r => ({
    corridor: r.s,
    limits: r.l,
    side: r.b,
    schedule: humanizeSweep(r),
    weeks: Array.isArray(r.w) ? r.w : [],
    sweeps_on_holidays: r.h === 1 || r.h === "1",
    score: r.score,
  }));
  return {
    available: true,
    total_rows: rows.length,
    resolution: address
      ? exact.length > 0 && address.side ? "exact" : exact.length > 0 ? "ambiguous" : "none"
      : scored.length > 0 ? "ambiguous" : "none",
    match_count: selected.length,
    matches: top,
  };
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
  if (!result || !result.available) {
    return "SF Public Works sweep schedule is currently unavailable; this does not mean the block has no restrictions.";
  }
  if (!result.matches || result.matches.length === 0) {
    return "No SF Public Works sweep schedule matched that location.";
  }
  const schedules = result.matches
    .map(m => `- ${m.corridor} (${m.limits}), ${m.side} side: ${m.schedule}`)
    .join("\n");
  return result.resolution === "exact"
    ? schedules
    : `City sweep candidates could not be resolved to one exact block side. Do not calculate a deadline until the location is clarified.\n${schedules}`;
}
