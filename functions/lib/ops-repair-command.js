// Durable, human-authorized repair commands for the local Codex runner.
// A command is not an incident resolution: it only authorizes the bounded
// code-only work described by the policy below.

import { OPS_REGISTRY, registryPath } from "./ops-registry.js";
import { boardMetaFor } from "./ops-board-meta.js";

const PREFIX = "ops:repair:command:";
const TTL_S = 14 * 86400;
const COMMAND = "FIX";

export const REPAIR_MODE = Object.freeze({
  REPAIR_DEPLOY: "repair_deploy",
  DIAGNOSE_ONLY: "diagnose_only",
  APPROVAL_REQUIRED: "approval_required",
  CONFIRM_REQUIRED: "confirm_required",
});

// A FIX command is accepted for every registered Amari surface. The policy,
// not the sender or model, decides whether it may change code and deploy. This
// means an unmapped surface can never silently fall through to broad authority.
const AUTO_REPAIR_PATHS = new Set([
  "chief_of_staff", "daily_audit", "partner_refresh", "conversation_cache",
  "coach_cadence", "coach_reconcile", "funnel_refresh", "call_coach",
  "field_id_check", "outreach_snapshot", "ecosystem_scan", "ops_monitor",
]);
const APPROVAL_PATHS = new Set(["staff_auth", "portal_auth", "public_slots"]);
const CONFIRM_PATHS = new Set([
  "assessment_paid_book", "intro_paid_book", "portal_followup_paid_book",
  "order_package_credit", "invoice_package_credit", "pos_card_fulfill",
  "discovery_free_book", "portal_package_book", "appointment_webhook", "staff_book",
  "partner_welcome_message", "reminder_engine", "nurture_engine", "morning_sms",
]);

function modeFor(pathId) {
  if (AUTO_REPAIR_PATHS.has(pathId)) return REPAIR_MODE.REPAIR_DEPLOY;
  if (CONFIRM_PATHS.has(pathId)) return REPAIR_MODE.CONFIRM_REQUIRED;
  if (APPROVAL_PATHS.has(pathId)) return REPAIR_MODE.APPROVAL_REQUIRED;
  return REPAIR_MODE.DIAGNOSE_ONLY;
}

function verificationFor(pathId, mode) {
  if (pathId === "chief_of_staff") return "Protected /api/cos-health SSE probe must pass, then the independent monitor must recover.";
  if (pathId === "outreach_snapshot") return "A fresh outreach heartbeat must be green, then the independent monitor must recover.";
  if (pathId === "field_id_check") return "Field-ID check must run fresh and green, then the independent monitor must recover.";
  if (mode === REPAIR_MODE.REPAIR_DEPLOY) return "Run the path-specific test/probe; only the independent monitor may resolve its incident.";
  return "Return evidence and the exact next approval/confirmation required; do not resolve the incident.";
}

export const REPAIR_POLICIES = Object.freeze(Object.fromEntries(OPS_REGISTRY.map((path) => {
  const meta = boardMetaFor(path.id);
  const mode = modeFor(path.id);
  return [path.id, Object.freeze({
    mode,
    touch: meta.changeSurface.touch,
    verify: verificationFor(path.id, mode),
  })];
})));

export function repairCommandKey(id) {
  return `${PREFIX}${id}`;
}

export function policyFor(pathId) {
  return REPAIR_POLICIES[pathId] || null;
}

function id() {
  const raw = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
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

export async function getRepairCommand(env, id) {
  if (!id) return { ok: false, error: "missing-id" };
  const kv = env?.PORTAL_KV;
  if (!kv) return { ok: false, error: "no-kv" };
  const command = await kv.get(repairCommandKey(id), "json");
  return command ? { ok: true, command } : { ok: false, error: "not-found" };
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
