// Durable owned-quiz → shadow-nurture handoff. Same-account service binding only; there is no
// workers.dev fallback. Capture owns the outbox row atomically, this bounded dispatcher verifies
// its digest and requires the nurture engine to acknowledge the exact Flow 1 enrollment action.

const DEFAULT_LIMIT = 10;
const LEASE_MS = 120_000;
const MANUAL_REVIEW_AFTER = 24;

function changes(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function claim(db, row, nowMs) {
  const now = new Date(nowMs).toISOString();
  const result = await db.prepare(
    `UPDATE quiz_nurture_dispatches
        SET state = 'executing', attempts = attempts + 1, lease_until = ?, last_error = NULL, updated_at = ?
      WHERE id = ? AND (state IN ('pending', 'retryable') OR (state = 'executing' AND lease_until <= ?))`,
  ).bind(nowMs + LEASE_MS, now, row.id, nowMs).run();
  if (changes(result) !== 1) return null;
  return db.prepare("SELECT * FROM quiz_nurture_dispatches WHERE id = ?").bind(row.id).first();
}

async function fail(db, row, error, nowMs, forceReview = false) {
  const state = forceReview || Number(row.attempts) >= MANUAL_REVIEW_AFTER ? "manual_review" : "retryable";
  const now = new Date(nowMs).toISOString();
  await db.prepare(
    `UPDATE quiz_nurture_dispatches
        SET state = ?, lease_until = 0, last_error = ?, updated_at = ?
      WHERE id = ? AND state = 'executing'`,
  ).bind(state, String(error || "quiz nurture dispatch failed").slice(0, 1000), now, row.id).run();
  return state;
}

function acknowledged(actions) {
  return (actions || []).some((action) => action?.engine === "nurture"
    && ["enroll", "enroll-noop"].includes(action?.action)
    && action?.detail?.sequenceId === "flow-1-quiz");
}

export async function dispatchOwnedQuizNurture(env, nowMs = Date.now(), limit = DEFAULT_LIMIT) {
  if (!env?.CRM_DB) throw new Error("CRM_DB is required for quiz nurture dispatch");
  const bounded = Math.max(1, Math.min(50, Number(limit) || DEFAULT_LIMIT));
  const pending = await env.CRM_DB.prepare(
    `SELECT * FROM quiz_nurture_dispatches
      WHERE state IN ('pending', 'retryable') OR (state = 'executing' AND lease_until <= ?)
      ORDER BY datetime(updated_at), id LIMIT ?`,
  ).bind(nowMs, bounded).all();
  const summary = { status: "succeeded", considered: (pending.results || []).length, dispatched: 0, retryable: 0, manualReview: 0 };
  for (const candidate of pending.results || []) {
    const row = await claim(env.CRM_DB, candidate, nowMs);
    if (!row) continue;
    try {
      if (await sha256(row.event_json) !== row.payload_sha256) {
        await fail(env.CRM_DB, row, "quiz nurture payload digest mismatch", nowMs, true);
        summary.manualReview += 1;
        continue;
      }
      if (!env.NURTURE?.fetch || !env.WORKER_AUTH_SECRET) {
        throw new Error("nurture service binding or authentication is unavailable");
      }
      const response = await env.NURTURE.fetch("https://nurture-engine/event", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WORKER_AUTH_SECRET}`, "Content-Type": "application/json" },
        body: row.event_json,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`nurture engine responded ${response.status}`);
      if (!acknowledged(body.actions)) {
        await fail(env.CRM_DB, row, "nurture engine did not acknowledge exact owned quiz enrollment", nowMs, true);
        summary.manualReview += 1;
        continue;
      }
      const now = new Date(nowMs).toISOString();
      const result = await env.CRM_DB.prepare(
        `UPDATE quiz_nurture_dispatches
            SET state = 'dispatched', lease_until = 0, engine_result_json = ?, last_error = NULL,
                dispatched_at = ?, updated_at = ?
          WHERE id = ? AND state = 'executing'`,
      ).bind(JSON.stringify({ actions: body.actions || [] }), now, now, row.id).run();
      if (changes(result) !== 1) throw new Error("quiz nurture dispatch checkpoint changed");
      summary.dispatched += 1;
    } catch (error) {
      const state = await fail(env.CRM_DB, row, error?.message || error, nowMs);
      summary[state === "manual_review" ? "manualReview" : "retryable"] += 1;
    }
  }
  if (summary.retryable || summary.manualReview) summary.status = "attention";
  return summary;
}

export async function ownedQuizNurtureDispatchReadiness(db) {
  if (!db) return { configured: false, state: "unavailable", reason: "CRM_DB is unavailable" };
  try {
    const rows = (await db.prepare(
      "SELECT state, COUNT(*) AS count FROM quiz_nurture_dispatches GROUP BY state",
    ).all()).results || [];
    const counts = Object.fromEntries(["pending", "executing", "retryable", "dispatched", "manual_review"].map((state) => [state, 0]));
    for (const row of rows) counts[row.state] = Number(row.count || 0);
    const blocking = counts.pending + counts.executing + counts.retryable + counts.manual_review;
    return {
      configured: true,
      state: counts.manual_review ? "attention" : blocking ? "pending" : "ready",
      blocking,
      counts,
      shadowOnly: true,
      deliveryEnabled: false,
    };
  } catch (error) {
    return { configured: false, state: "unavailable", reason: error?.message || String(error) };
  }
}
