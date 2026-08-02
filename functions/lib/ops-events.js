// Amari Ops event spine — append OpsEvents and open/resolve OpsIncidents.
// Prefer AUTOMATION_DB (amari-automation D1). Never throws: callers are live
// money paths; a broken observability write must not break checkout/webhook.
//
// Schema: db/ops-visibility-schema.sql
// Brief: amari-method-docs ops visibility system brief (binding).

import { registryPath } from "./ops-registry.js";
import { notifyOpsFlip } from "./ops-notify.js";
import {
  appendTrailEvent,
  countTrailIncidentsByPath,
  listTrailEvents,
  listTrailIncidents,
  resolveTrailIncidents,
  trailEventFromInput,
  upsertTrailIncident,
} from "./ops-trail-kv.js";

const OUTCOMES = new Set(["ok", "skip", "fail"]);

function newId(prefix) {
  const u =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${u}`;
}

function automationDb(env) {
  return (env && env.AUTOMATION_DB) || null;
}

function changesOf(res) {
  return (res && res.meta && res.meta.changes) || 0;
}

/**
 * Append one hop event. Fire-and-forget safe; resolves { recorded, id?, reason? }.
 * Prefers AUTOMATION_DB; always mirrors to PORTAL_KV when available so /ops
 * can read the trail without a Pages D1 binding.
 * @param {object} env
 * @param {object} evt
 */
export async function recordOpsEvent(env, evt) {
  try {
    if (!evt || typeof evt !== "object") return { recorded: false, reason: "bad-evt" };
    if (!evt.pathId || !evt.hopId || !evt.summary) return { recorded: false, reason: "missing-fields" };
    if (!OUTCOMES.has(evt.outcome)) return { recorded: false, reason: "bad-outcome" };

    const at = evt.at || new Date().toISOString();
    const atMs = evt.atMs != null ? evt.atMs : Date.parse(at) || Date.now();
    const id = evt.id || newId("evt");
    const shaped = trailEventFromInput(evt, id, at, atMs);

    const db = automationDb(env);
    if (db) {
      await db
        .prepare(
          `INSERT INTO ops_events
           (id, at, at_ms, path_id, hop_id, outcome, reason_code, summary,
            correlation_id, contact_id, person_label, trigger_type, trigger_id,
            condition_expected, condition_observed, message_json, money_json, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          at,
          atMs,
          evt.pathId,
          evt.hopId,
          evt.outcome,
          evt.reasonCode ?? null,
          evt.summary,
          evt.correlationId ?? null,
          evt.contactId ?? null,
          evt.personLabel ?? null,
          evt.trigger?.type ?? evt.triggerType ?? null,
          evt.trigger?.id ?? evt.triggerId ?? null,
          evt.condition?.expected ?? null,
          evt.condition?.observed ?? null,
          evt.message != null ? JSON.stringify(evt.message) : null,
          evt.money != null ? JSON.stringify(evt.money) : null,
          evt.source ?? null,
        )
        .run();
    }

    const kvRes = await appendTrailEvent(env, shaped);
    if (!db && !kvRes.recorded) {
      console.error(
        `[ops-events] no AUTOMATION_DB/KV — dropping event: ${evt.pathId}/${evt.hopId} ${evt.outcome}`,
      );
      return { recorded: false, reason: "no-store" };
    }

    return { recorded: true, id, at, atMs, via: db ? "d1" : "kv" };
  } catch (err) {
    console.error(`[ops-events] record failed: ${err && err.message}`);
    return { recorded: false, reason: "threw" };
  }
}

/**
 * Open (or attach to) an incident for a path/correlation. Alerts only on flip
 * to open (new row or reopen). While already open, only appends event ids.
 */
export async function openOpsIncident(env, inc, { context = null, alert = true } = {}) {
  try {
    if (!inc?.pathId || !inc?.title) return { opened: false, reason: "missing-fields" };

    const db = automationDb(env);
    const path = registryPath(inc.pathId);
    const severity = inc.severity || path?.severity || "infra";
    const openedAt = inc.openedAt || new Date().toISOString();
    const openedAtMs = inc.openedAtMs != null ? inc.openedAtMs : Date.parse(openedAt) || Date.now();
    const eventIds = Array.isArray(inc.eventIds) ? inc.eventIds.filter(Boolean) : [];

    if (!db) {
      // Pages without D1: open on the KV trail so /ops still shows the flip.
      const existingKv = (await listTrailIncidents(env, { status: "open", pathId: inc.pathId, limit: 50 })).find(
        (row) =>
          (inc.correlationId && row.correlationId === inc.correlationId) ||
          (inc.contactId && row.contactId === inc.contactId),
      );
      if (existingKv) {
        const merged = [...eventIds, ...(existingKv.eventIds || [])]
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 20);
        const attached = {
          ...existingKv,
          eventIds: merged,
          failedHopId: inc.failedHopId || existingKv.failedHopId || null,
        };
        await upsertTrailIncident(env, attached);
        let alertResult = existingKv.lastAlertedAt ? { sent: true, deduped: true } : null;
        if (alert && !existingKv.lastAlertedAt) {
          alertResult = await notifyOpsFlip(context || { env }, {
            id: existingKv.id,
            pathId: inc.pathId,
            severity,
            title: inc.title,
            contactId: inc.contactId,
            personLabel: inc.personLabel,
            correlationId: inc.correlationId,
            failedHopId: inc.failedHopId,
            lawId: inc.lawId,
          });
          if (alertResult?.sent || alertResult?.shadowed) {
            attached.lastAlertedAt = new Date().toISOString();
            await upsertTrailIncident(env, attached);
          }
        }
        return { opened: false, attached: true, id: existingKv.id, flipped: false, alert: alertResult, via: "kv" };
      }

      const id = inc.id || newId("inc");
      const shaped = {
        id,
        pathId: inc.pathId,
        status: "open",
        severity,
        openedAt,
        openedAtMs,
        resolvedAt: null,
        lastAlertedAt: null,
        title: inc.title,
        contactId: inc.contactId ?? null,
        personLabel: inc.personLabel ?? null,
        correlationId: inc.correlationId ?? null,
        failedHopId: inc.failedHopId ?? null,
        eventIds: eventIds.slice(0, 20),
        lawId: inc.lawId ?? null,
      };
      await upsertTrailIncident(env, shaped);

      let alertResult = null;
      if (alert) {
        alertResult = await notifyOpsFlip(context || { env }, {
          id,
          pathId: inc.pathId,
          severity,
          title: inc.title,
          contactId: inc.contactId,
          personLabel: inc.personLabel,
          correlationId: inc.correlationId,
          failedHopId: inc.failedHopId,
          lawId: inc.lawId,
        });
        if (alertResult?.sent || alertResult?.shadowed) {
          await upsertTrailIncident(env, {
            ...shaped,
            lastAlertedAt: new Date().toISOString(),
          });
        }
      }
      return { opened: true, id, flipped: true, alert: alertResult, via: "kv" };
    }

    // Prefer matching an already-open incident on the same correlation (or contact).
    let existing = null;
    if (inc.correlationId) {
      existing = await db
        .prepare(
          `SELECT id, event_ids_json, last_alerted_at FROM ops_incidents
           WHERE path_id = ? AND status = 'open' AND correlation_id = ?
           ORDER BY opened_at_ms DESC LIMIT 1`,
        )
        .bind(inc.pathId, inc.correlationId)
        .first();
    }
    if (!existing && inc.contactId) {
      existing = await db
        .prepare(
          `SELECT id, event_ids_json, last_alerted_at FROM ops_incidents
           WHERE path_id = ? AND status = 'open' AND contact_id = ?
           ORDER BY opened_at_ms DESC LIMIT 1`,
        )
        .bind(inc.pathId, inc.contactId)
        .first();
    }

    if (existing) {
      const prev = safeJsonArray(existing.event_ids_json);
      const merged = [...eventIds, ...prev].filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
      await db
        .prepare(`UPDATE ops_incidents SET event_ids_json = ?, failed_hop_id = COALESCE(?, failed_hop_id) WHERE id = ?`)
        .bind(JSON.stringify(merged), inc.failedHopId ?? null, existing.id)
        .run();
      let alertResult = existing.last_alerted_at ? { sent: true, deduped: true } : null;
      if (alert && !existing.last_alerted_at) {
        alertResult = await notifyOpsFlip(context || { env }, {
          id: existing.id,
          pathId: inc.pathId,
          severity,
          title: inc.title,
          contactId: inc.contactId,
          personLabel: inc.personLabel,
          correlationId: inc.correlationId,
          failedHopId: inc.failedHopId,
          lawId: inc.lawId,
        });
        if (alertResult?.sent || alertResult?.shadowed) {
          await db
            .prepare(`UPDATE ops_incidents SET last_alerted_at = ? WHERE id = ?`)
            .bind(new Date().toISOString(), existing.id)
            .run();
        }
      }
      return { opened: false, attached: true, id: existing.id, flipped: false, alert: alertResult };
    }

    const id = inc.id || newId("inc");
    await db
      .prepare(
        `INSERT INTO ops_incidents
           (id, path_id, status, severity, opened_at, opened_at_ms, resolved_at,
            last_alerted_at, title, contact_id, person_label, correlation_id,
            failed_hop_id, event_ids_json, law_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        inc.pathId,
        "open",
        severity,
        openedAt,
        openedAtMs,
        null,
        null,
        inc.title,
        inc.contactId ?? null,
        inc.personLabel ?? null,
        inc.correlationId ?? null,
        inc.failedHopId ?? null,
        JSON.stringify(eventIds.slice(0, 20)),
        inc.lawId ?? null,
      )
      .run();

    const shaped = {
      id,
      pathId: inc.pathId,
      status: "open",
      severity,
      openedAt,
      openedAtMs,
      resolvedAt: null,
      lastAlertedAt: null,
      title: inc.title,
      contactId: inc.contactId ?? null,
      personLabel: inc.personLabel ?? null,
      correlationId: inc.correlationId ?? null,
      failedHopId: inc.failedHopId ?? null,
      eventIds: eventIds.slice(0, 20),
      lawId: inc.lawId ?? null,
    };
    await upsertTrailIncident(env, shaped);

    let alertResult = null;
    if (alert) {
      alertResult = await notifyOpsFlip(context || { env }, {
        id,
        pathId: inc.pathId,
        severity,
        title: inc.title,
        contactId: inc.contactId,
        personLabel: inc.personLabel,
        correlationId: inc.correlationId,
        failedHopId: inc.failedHopId,
        lawId: inc.lawId,
      });
      if (alertResult?.sent || alertResult?.shadowed) {
        const lastAlertedAt = new Date().toISOString();
        await db
          .prepare(`UPDATE ops_incidents SET last_alerted_at = ? WHERE id = ?`)
          .bind(lastAlertedAt, id)
          .run();
        await upsertTrailIncident(env, { ...shaped, lastAlertedAt });
      }
    }

    return { opened: true, id, flipped: true, alert: alertResult };
  } catch (err) {
    console.error(`[ops-events] openIncident failed: ${err && err.message}`);
    return { opened: false, reason: "threw" };
  }
}

/** Resolve open incidents for a path+correlation (and/or contact). */
export async function resolveOpsIncident(env, { pathId, correlationId, contactId } = {}) {
  try {
    if (!pathId) return { resolved: 0, reason: "missing-path" };
    const db = automationDb(env);
    let total = 0;
    if (db) {
      const resolvedAt = new Date().toISOString();
      if (correlationId) {
        const res = await db
          .prepare(
            `UPDATE ops_incidents SET status = 'resolved', resolved_at = ?
           WHERE path_id = ? AND status = 'open' AND correlation_id = ?`,
          )
          .bind(resolvedAt, pathId, correlationId)
          .run();
        total += changesOf(res);
      }
      if (contactId) {
        const res = await db
          .prepare(
            `UPDATE ops_incidents SET status = 'resolved', resolved_at = ?
           WHERE path_id = ? AND status = 'open' AND contact_id = ?`,
          )
          .bind(resolvedAt, pathId, contactId)
          .run();
        total += changesOf(res);
      }
    }
    const kvRes = await resolveTrailIncidents(env, { pathId, correlationId, contactId });
    total = Math.max(total, kvRes.resolved || 0);
    if (!db && !(kvRes.resolved > 0) && kvRes.reason === "threw") {
      return { resolved: 0, reason: "threw" };
    }
    return { resolved: total };
  } catch (err) {
    console.error(`[ops-events] resolveIncident failed: ${err && err.message}`);
    return { resolved: 0, reason: "threw" };
  }
}

/** List incidents (newest first). Prefers D1; falls back to KV trail. */
export async function listOpsIncidents(env, { status = "open", pathId, limit = 50 } = {}) {
  const db = automationDb(env);
  if (!db) return listTrailIncidents(env, { status, pathId, limit });
  try {
    let res;
    if (pathId && status) {
      res = await db
        .prepare(
          `SELECT * FROM ops_incidents WHERE path_id = ? AND status = ?
           ORDER BY opened_at_ms DESC LIMIT ?`,
        )
        .bind(pathId, status, limit)
        .all();
    } else if (status) {
      res = await db
        .prepare(
          `SELECT * FROM ops_incidents WHERE status = ?
           ORDER BY opened_at_ms DESC LIMIT ?`,
        )
        .bind(status, limit)
        .all();
    } else if (pathId) {
      res = await db
        .prepare(
          `SELECT * FROM ops_incidents WHERE path_id = ?
           ORDER BY opened_at_ms DESC LIMIT ?`,
        )
        .bind(pathId, limit)
        .all();
    } else {
      res = await db
        .prepare(`SELECT * FROM ops_incidents ORDER BY opened_at_ms DESC LIMIT ?`)
        .bind(limit)
        .all();
    }
    return (res.results || []).map(shapeIncident);
  } catch (err) {
    console.error(`[ops-events] listIncidents failed: ${err && err.message}`);
    return listTrailIncidents(env, { status, pathId, limit });
  }
}

/** Count open incidents grouped by path_id. */
export async function countOpenIncidentsByPath(env) {
  const db = automationDb(env);
  if (!db) return countTrailIncidentsByPath(env);
  try {
    const res = await db
      .prepare(
        `SELECT path_id, COUNT(*) AS n FROM ops_incidents
         WHERE status = 'open' GROUP BY path_id`,
      )
      .all();
    const out = {};
    for (const row of res.results || []) {
      out[row.path_id] = Number(row.n) || 0;
    }
    return out;
  } catch (err) {
    console.error(`[ops-events] countOpenIncidents failed: ${err && err.message}`);
    return countTrailIncidentsByPath(env);
  }
}

function shapeIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    pathId: row.path_id,
    status: row.status,
    severity: row.severity,
    openedAt: row.opened_at,
    openedAtMs: row.opened_at_ms,
    resolvedAt: row.resolved_at || null,
    lastAlertedAt: row.last_alerted_at || null,
    title: row.title,
    contactId: row.contact_id || null,
    personLabel: row.person_label || null,
    correlationId: row.correlation_id || null,
    failedHopId: row.failed_hop_id || null,
    eventIds: safeJsonArray(row.event_ids_json),
    lawId: row.law_id || null,
  };
}

function shapeEvent(row) {
  if (!row) return null;
  let money = null;
  let message = null;
  try {
    money = row.money_json ? JSON.parse(row.money_json) : null;
  } catch {
    money = null;
  }
  try {
    message = row.message_json ? JSON.parse(row.message_json) : null;
  } catch {
    message = null;
  }
  return {
    id: row.id,
    at: row.at,
    atMs: row.at_ms,
    pathId: row.path_id,
    hopId: row.hop_id,
    outcome: row.outcome,
    reasonCode: row.reason_code || null,
    summary: row.summary,
    correlationId: row.correlation_id || null,
    contactId: row.contact_id || null,
    personLabel: row.person_label || null,
    trigger: row.trigger_type
      ? { type: row.trigger_type, id: row.trigger_id || undefined }
      : null,
    condition:
      row.condition_expected || row.condition_observed
        ? { expected: row.condition_expected || null, observed: row.condition_observed || null }
        : null,
    message,
    money,
    source: row.source || null,
  };
}

/** Recent events for a path (newest first). Prefers D1; falls back to KV trail. */
export async function listOpsEvents(env, { pathId, contactId, correlationId, limit = 50 } = {}) {
  const db = automationDb(env);
  if (!db) return listTrailEvents(env, { pathId, contactId, correlationId, limit });
  try {
    let res;
    if (correlationId) {
      res = await db
        .prepare(
          `SELECT * FROM ops_events WHERE correlation_id = ? ORDER BY at_ms DESC LIMIT ?`,
        )
        .bind(correlationId, limit)
        .all();
    } else if (contactId && pathId) {
      res = await db
        .prepare(
          `SELECT * FROM ops_events WHERE path_id = ? AND contact_id = ? ORDER BY at_ms DESC LIMIT ?`,
        )
        .bind(pathId, contactId, limit)
        .all();
    } else if (pathId) {
      res = await db
        .prepare(`SELECT * FROM ops_events WHERE path_id = ? ORDER BY at_ms DESC LIMIT ?`)
        .bind(pathId, limit)
        .all();
    } else {
      return [];
    }
    return (res.results || []).map(shapeEvent);
  } catch (err) {
    console.error(`[ops-events] list failed: ${err && err.message}`);
    return listTrailEvents(env, { pathId, contactId, correlationId, limit });
  }
}

function safeJsonArray(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const __test = { newId, automationDb, safeJsonArray, OUTCOMES };
