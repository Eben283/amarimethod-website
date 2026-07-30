// KV trail bridge for Amari Ops.
// Pages Functions often lack AUTOMATION_DB; workers that have D1 can mirror here
// so /ops can still show path + why. Prefer D1 when bound; KV is the fallback.

const EVENTS_PREFIX = "ops:trail:events:";
const INCIDENTS_KEY = "ops:trail:incidents";
const META_KEY = "ops:trail:meta";
const MAX_EVENTS = 40;
const MAX_INCIDENTS = 50;
const TTL_SECONDS = 60 * 60 * 24 * 90;

function portalKv(env) {
  return (env && (env.PORTAL_KV || env.PURCHASE_KV)) || null;
}

function eventsKey(pathId) {
  return `${EVENTS_PREFIX}${pathId}`;
}

async function readJson(kv, key, fallback) {
  try {
    const v = await kv.get(key, "json");
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Shape used by the board (same fields as ops-events shapeEvent). */
export function trailEventFromInput(evt, id, at, atMs) {
  return {
    id,
    at,
    atMs,
    pathId: evt.pathId,
    hopId: evt.hopId,
    outcome: evt.outcome,
    reasonCode: evt.reasonCode ?? null,
    summary: evt.summary,
    correlationId: evt.correlationId ?? null,
    contactId: evt.contactId ?? null,
    personLabel: evt.personLabel ?? null,
    trigger: evt.trigger || (evt.triggerType ? { type: evt.triggerType, id: evt.triggerId } : null),
    condition: evt.condition || null,
    message: evt.message ?? null,
    money: evt.money ?? null,
    source: evt.source ?? null,
  };
}

export async function appendTrailEvent(env, event) {
  const kv = portalKv(env);
  if (!kv || !event?.pathId) return { recorded: false, reason: "no-kv" };
  try {
    const key = eventsKey(event.pathId);
    const prev = await readJson(kv, key, []);
    const list = Array.isArray(prev) ? prev : [];
    const next = [event, ...list.filter((e) => e && e.id !== event.id)].slice(0, MAX_EVENTS);
    await kv.put(key, JSON.stringify(next), { expirationTtl: TTL_SECONDS });
    await touchMeta(kv, "append-event");
    return { recorded: true };
  } catch (err) {
    console.error(`[ops-trail-kv] appendEvent failed: ${err && err.message}`);
    return { recorded: false, reason: "threw" };
  }
}

export async function listTrailEvents(env, { pathId, contactId, correlationId, limit = 50 } = {}) {
  const kv = portalKv(env);
  if (!kv || !pathId) return [];
  try {
    let rows = await readJson(kv, eventsKey(pathId), []);
    if (!Array.isArray(rows)) rows = [];
    if (correlationId) rows = rows.filter((e) => e.correlationId === correlationId);
    if (contactId) rows = rows.filter((e) => e.contactId === contactId);
    rows.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
    return rows.slice(0, limit);
  } catch (err) {
    console.error(`[ops-trail-kv] listEvents failed: ${err && err.message}`);
    return [];
  }
}

export async function upsertTrailIncident(env, incident) {
  const kv = portalKv(env);
  if (!kv || !incident?.id) return { ok: false, reason: "no-kv" };
  try {
    const prev = await readJson(kv, INCIDENTS_KEY, []);
    const list = Array.isArray(prev) ? prev : [];
    const i = list.findIndex((x) => x && x.id === incident.id);
    if (i >= 0) list[i] = { ...list[i], ...incident };
    else list.unshift(incident);
    await kv.put(INCIDENTS_KEY, JSON.stringify(list.slice(0, MAX_INCIDENTS)), {
      expirationTtl: TTL_SECONDS,
    });
    await touchMeta(kv, "upsert-incident");
    return { ok: true };
  } catch (err) {
    console.error(`[ops-trail-kv] upsertIncident failed: ${err && err.message}`);
    return { ok: false, reason: "threw" };
  }
}

export async function resolveTrailIncidents(env, { pathId, correlationId, contactId } = {}) {
  const kv = portalKv(env);
  if (!kv || !pathId) return { resolved: 0 };
  try {
    const prev = await readJson(kv, INCIDENTS_KEY, []);
    const list = Array.isArray(prev) ? prev : [];
    const resolvedAt = new Date().toISOString();
    let n = 0;
    for (const inc of list) {
      if (!inc || inc.pathId !== pathId || inc.status !== "open") continue;
      const matchCorr = correlationId && inc.correlationId === correlationId;
      const matchContact = contactId && inc.contactId === contactId;
      if (matchCorr || matchContact) {
        inc.status = "resolved";
        inc.resolvedAt = resolvedAt;
        n += 1;
      }
    }
    if (n) {
      await kv.put(INCIDENTS_KEY, JSON.stringify(list), { expirationTtl: TTL_SECONDS });
      await touchMeta(kv, "resolve-incident");
    }
    return { resolved: n };
  } catch (err) {
    console.error(`[ops-trail-kv] resolve failed: ${err && err.message}`);
    return { resolved: 0, reason: "threw" };
  }
}

export async function listTrailIncidents(env, { status = "open", pathId, limit = 50 } = {}) {
  const kv = portalKv(env);
  if (!kv) return [];
  try {
    let rows = await readJson(kv, INCIDENTS_KEY, []);
    if (!Array.isArray(rows)) rows = [];
    if (status) rows = rows.filter((i) => i && i.status === status);
    if (pathId) rows = rows.filter((i) => i && i.pathId === pathId);
    rows.sort((a, b) => (b.openedAtMs || 0) - (a.openedAtMs || 0));
    return rows.slice(0, limit);
  } catch (err) {
    console.error(`[ops-trail-kv] listIncidents failed: ${err && err.message}`);
    return [];
  }
}

export async function countTrailIncidentsByPath(env) {
  const open = await listTrailIncidents(env, { status: "open", limit: MAX_INCIDENTS });
  const out = {};
  for (const inc of open) {
    if (!inc?.pathId) continue;
    out[inc.pathId] = (out[inc.pathId] || 0) + 1;
  }
  return out;
}

/**
 * Push D1 open incidents + recent events into KV so Pages /ops can read them
 * without an AUTOMATION_DB binding. Merges with any Pages-only KV events by id.
 */
export async function mirrorOpsTrailFromDb(env, { listIncidents, listEvents, pathIds }) {
  const kv = portalKv(env);
  if (!kv || !env?.AUTOMATION_DB) return { mirrored: false, reason: "no-kv-or-db" };
  try {
    const incidents = await listIncidents(env, { status: "open", limit: MAX_INCIDENTS });
    await kv.put(INCIDENTS_KEY, JSON.stringify(incidents.slice(0, MAX_INCIDENTS)), {
      expirationTtl: TTL_SECONDS,
    });

    let eventCount = 0;
    for (const pathId of pathIds || []) {
      const fromDb = await listEvents(env, { pathId, limit: MAX_EVENTS });
      const fromKv = await readJson(kv, eventsKey(pathId), []);
      const byId = new Map();
      for (const e of [...(Array.isArray(fromKv) ? fromKv : []), ...fromDb]) {
        if (e?.id) byId.set(e.id, e);
      }
      const merged = [...byId.values()]
        .sort((a, b) => (b.atMs || 0) - (a.atMs || 0))
        .slice(0, MAX_EVENTS);
      eventCount += merged.length;
      await kv.put(eventsKey(pathId), JSON.stringify(merged), { expirationTtl: TTL_SECONDS });
    }

    await touchMeta(kv, "mirror-from-d1");
    return { mirrored: true, incidents: incidents.length, events: eventCount };
  } catch (err) {
    console.error(`[ops-trail-kv] mirror failed: ${err && err.message}`);
    return { mirrored: false, reason: "threw" };
  }
}

export async function trailMeta(env) {
  const kv = portalKv(env);
  if (!kv) return null;
  return readJson(kv, META_KEY, null);
}

async function touchMeta(kv, reason) {
  try {
    await kv.put(
      META_KEY,
      JSON.stringify({ updatedAt: new Date().toISOString(), reason }),
      { expirationTtl: TTL_SECONDS },
    );
  } catch {
    /* ignore */
  }
}

export const __test = {
  EVENTS_PREFIX,
  INCIDENTS_KEY,
  META_KEY,
  portalKv,
  eventsKey,
};
