// Hourly Amari Ops law sweep — rides series-reconcile's cron.
// Phase 1: L_paid_assessment_has_appt (paid Assessment without appointment).
// After the sweep, mirror D1 trail → PORTAL_KV so Pages /ops can read it
// without an AUTOMATION_DB binding.

import { sweepOpsLaws } from "../../functions/lib/ops-laws.js";
import { listOpsEvents, listOpsIncidents } from "../../functions/lib/ops-events.js";
import { registryPathIds } from "../../functions/lib/ops-registry.js";
import { mirrorOpsTrailFromDb } from "../../functions/lib/ops-trail-kv.js";

/**
 * @param {object} env
 * @param {number} [nowMs]
 */
export async function sweepOpsLawsHourly(env, nowMs = Date.now()) {
  if (!env?.AUTOMATION_DB) {
    return { skipped: true, reason: "no-db" };
  }
  try {
    const result = await sweepOpsLaws(env, nowMs, { context: { env } });
    const mirror = await mirrorOpsTrailFromDb(env, {
      listIncidents: listOpsIncidents,
      listEvents: listOpsEvents,
      pathIds: registryPathIds(),
    });
    console.log(JSON.stringify({ event: "ops_laws_sweep", ...result, mirror }));
    return { ...result, mirror };
  } catch (err) {
    console.error(`[ops-laws-sweep] failed: ${err && err.message}`);
    return { skipped: true, reason: "threw" };
  }
}
