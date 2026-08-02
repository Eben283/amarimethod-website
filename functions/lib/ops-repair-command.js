// Durable, human-authorized repair commands for the local Codex runner.
// A command is not an incident resolution: it only authorizes the bounded
// code-only work described by the policy below.

import { registryPath } from "./ops-registry.js";

const PREFIX = "ops:repair:command:";
const TTL_S = 14 * 86400;
const COMMAND = "FIX";

// Deliberately small initial allowlist. Other surfaces may be monitored, but
// require a separate policy before a text/command can authorize code changes.
export const REPAIR_POLICIES = Object.freeze({
  chief_of_staff: Object.freeze({
    mode: "repair_deploy",
    touch: "functions/api/cos-* + functions/lib/cos-* + cos/ and dist/cos/ only.",
    verify: "Protected /api/cos-health SSE probe must pass, then wait for the independent monitor.",
  }),
  outreach_snapshot: Object.freeze({
    mode: "repair_deploy",
    touch: "ghl-mcp/outreach-snapshot.js, upload-outreach-snapshot.sh, run-daily.sh, and staff outreach read/upload APIs only.",
    verify: "A fresh outreach heartbeat must be green, then wait for the independent monitor.",
  }),
  field_id_check: Object.freeze({
    mode: "repair_deploy",
    touch: "scripts/check-field-ids.mjs and its local launch path only.",
    verify: "Field-ID check must run fresh and green, then wait for the independent monitor.",
  }),
  crm_mirror: Object.freeze({
    mode: "diagnose_only",
    touch: "crm-mirror-worker and its read-only mirror/reconciliation code only.",
    verify: "CRM mirror readiness must turn green independently. Never write GHL or Stripe.",
  }),
});

export function repairCommandKey(id) {
  return `${PREFIX}${id}`;
}

export function policyFor(pathId) {
  return REPAIR_POLICIES[pathId] || null;
}

function id() {
  const raw = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()
    : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `OPS-${raw}`;
}

export async function createRepairCommand(env, { command, pathId, requestedBy = "ops" } = {}) {
  if (String(command || "").toUpperCase() !== COMMAND) return { ok: false, error: "unsupported-command" };
  if (!registryPath(pathId)) return { ok: false, error: "unknown-path" };
  const policy = policyFor(pathId);
  if (!policy) return { ok: false, error: "path-not-authorized" };
  const kv = env?.PORTAL_KV;
  if (!kv) return { ok: false, error: "no-kv" };

  const commandId = id();
  const now = new Date().toISOString();
  const entry = {
    id: commandId,
    command: COMMAND,
    pathId,
    requestedBy,
    requestedAt: now,
    status: "pending",
    policy: { mode: policy.mode, touch: policy.touch, verify: policy.verify },
  };
  await kv.put(repairCommandKey(commandId), JSON.stringify(entry), { expirationTtl: TTL_S });
  return { ok: true, command: entry };
}

export async function claimNextRepairCommand(env, { runnerId } = {}) {
  const kv = env?.PORTAL_KV;
  if (!kv) return { ok: false, error: "no-kv" };
  const page = await kv.list({ prefix: PREFIX, limit: 100 });
  for (const key of page.keys || []) {
    const entry = await kv.get(key.name, "json");
    if (!entry || entry.status !== "pending") continue;
    const claimed = { ...entry, status: "running", claimedAt: new Date().toISOString(), runnerId: runnerId || "local-codex" };
    await kv.put(key.name, JSON.stringify(claimed), { expirationTtl: TTL_S });
    return { ok: true, command: claimed };
  }
  return { ok: true, command: null };
}

export async function finishRepairCommand(env, id, { status, result } = {}) {
  if (!id || !["completed", "blocked", "failed"].includes(status)) return { ok: false, error: "bad-finish" };
  const kv = env?.PORTAL_KV;
  const current = await kv?.get(repairCommandKey(id), "json");
  if (!current) return { ok: false, error: "not-found" };
  const finished = { ...current, status, finishedAt: new Date().toISOString(), result: String(result || "").slice(0, 2000) };
  await kv.put(repairCommandKey(id), JSON.stringify(finished), { expirationTtl: TTL_S });
  return { ok: true, command: finished };
}

export const __test = { PREFIX, COMMAND, id };
