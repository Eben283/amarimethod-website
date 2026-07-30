// Amari Ops law checkers — Phase 1: L_paid_assessment_has_appt.
// Paid Assessment ⇒ create_appointment ok within N minutes (or open incident).
// Flip alert only when opening a new incident (via openOpsIncident).

import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";
import { listOpsEvents, openOpsIncident, resolveOpsIncident } from "./ops-events.js";

/** Appointment lag window before the law opens an incident. */
export const ASSESSMENT_APPT_LAG_MS = 15 * 60 * 1000;

/**
 * Sweep: for Assessment purchase_webhook events older than the lag window,
 * require a create_appointment ok for the same correlation (or contact).
 * Opens money incidents on flip; resolves when a later ok appears.
 *
 * @param {object} env
 * @param {number} [nowMs]
 * @param {{ context?: object }} [opts]
 */
export async function sweepPaidAssessmentHasAppt(env, nowMs = Date.now(), opts = {}) {
  const db = env && env.AUTOMATION_DB;
  if (!db) return { checked: 0, opened: 0, resolved: 0, reason: "no-db" };

  const cutoff = nowMs - ASSESSMENT_APPT_LAG_MS;
  let checked = 0;
  let opened = 0;
  let resolved = 0;

  try {
    // Distinct payment/webhook markers still due for the law.
    const res = await db
      .prepare(
        `SELECT id, at_ms, correlation_id, contact_id, person_label, money_json, summary
         FROM ops_events
         WHERE path_id = ?
           AND hop_id = 'purchase_webhook'
           AND outcome = 'ok'
           AND at_ms <= ?
         ORDER BY at_ms ASC
         LIMIT 100`,
      )
      .bind(PATH_ASSESSMENT_PAID_BOOK, cutoff)
      .all();

    const rows = res.results || [];
    for (const row of rows) {
      checked += 1;
      const hasAppt = await hasCreateAppointmentOk(db, row);
      if (hasAppt) {
        const r = await resolveOpsIncident(env, {
          pathId: PATH_ASSESSMENT_PAID_BOOK,
          correlationId: row.correlation_id || undefined,
          contactId: row.contact_id || undefined,
        });
        resolved += r.resolved || 0;
        continue;
      }

      // Fail event already present with incident from the hot path — still ensure open.
      const money = safeMoney(row.money_json);
      const person = row.person_label || null;
      const title = "Paid Assessment, no appointment";
      const open = await openOpsIncident(
        env,
        {
          pathId: PATH_ASSESSMENT_PAID_BOOK,
          severity: "money",
          title,
          contactId: row.contact_id || null,
          personLabel: person,
          correlationId: row.correlation_id || null,
          failedHopId: "create_appointment",
          eventIds: [row.id],
          lawId: "L_paid_assessment_has_appt",
        },
        { context: opts.context || { env }, alert: true },
      );
      if (open.opened) opened += 1;
      void money;
    }
  } catch (err) {
    console.error(`[ops-laws] L_paid_assessment_has_appt failed: ${err && err.message}`);
    return { checked, opened, resolved, reason: "threw" };
  }

  return { checked, opened, resolved };
}

async function hasCreateAppointmentOk(db, row) {
  if (row.correlation_id) {
    const hit = await db
      .prepare(
        `SELECT id FROM ops_events
         WHERE path_id = ? AND hop_id = 'create_appointment' AND outcome = 'ok'
           AND correlation_id = ?
         LIMIT 1`,
      )
      .bind(PATH_ASSESSMENT_PAID_BOOK, row.correlation_id)
      .first();
    if (hit) return true;
  }
  if (row.contact_id) {
    // Same contact, appointment ok after this payment event (retry / later book).
    const hit = await db
      .prepare(
        `SELECT id FROM ops_events
         WHERE path_id = ? AND hop_id = 'create_appointment' AND outcome = 'ok'
           AND contact_id = ? AND at_ms >= ?
         LIMIT 1`,
      )
      .bind(PATH_ASSESSMENT_PAID_BOOK, row.contact_id, row.at_ms)
      .first();
    if (hit) return true;
  }
  return false;
}

function safeMoney(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** Run all Phase-1 law sweeps. */
export async function sweepOpsLaws(env, nowMs = Date.now(), opts = {}) {
  const assessment = await sweepPaidAssessmentHasAppt(env, nowMs, opts);
  return { assessment };
}

export const __test = { hasCreateAppointmentOk, ASSESSMENT_APPT_LAG_MS, listOpsEvents };
