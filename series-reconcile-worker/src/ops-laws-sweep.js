// Hourly Amari Ops law sweep — rides series-reconcile's cron.
// Phase 1: L_paid_assessment_has_appt (paid Assessment without appointment).

import { sweepOpsLaws } from "../../functions/lib/ops-laws.js";

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
    console.log(JSON.stringify({ event: "ops_laws_sweep", ...result }));
    return result;
  } catch (err) {
    console.error(`[ops-laws-sweep] failed: ${err && err.message}`);
    return { skipped: true, reason: "threw" };
  }
}
