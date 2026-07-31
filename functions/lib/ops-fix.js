// Amari Ops Fix layer — bounded Cursor cloud agents for board attention.
// Auto sweep (worker) + manual request queue. Never throws to callers.

import { boardMetaFor } from "./ops-board-meta.js";
import { isAttentionState } from "./ops-board-meta.js";
import { registryPath } from "./ops-registry.js";

const HOUR = 3600 * 1000;
const JOB_TTL_S = 14 * 86400;
const REQUEST_TTL_S = 2 * 86400;
/** Don't relaunch another agent for the same path inside this window. */
export const OPS_FIX_COOLDOWN_MS = 6 * HOUR;

export const OPS_FIX_MODES = Object.freeze({
  OFF: "off",
  SHADOW: "shadow", // log would_launch only
  AUTO: "auto", // launch Cursor agents
});

function modeOf(env) {
  const m = String(env?.OPS_FIX_MODE || OPS_FIX_MODES.SHADOW).toLowerCase();
  if (m === OPS_FIX_MODES.AUTO || m === OPS_FIX_MODES.OFF || m === OPS_FIX_MODES.SHADOW) return m;
  return OPS_FIX_MODES.SHADOW;
}

export function fixJobKey(pathId) {
  return `ops:fix:job:${pathId}`;
}

export function fixRequestKey(pathId) {
  return `ops:fix:request:${pathId}`;
}

/** Paths the fixer is allowed to touch in code (change-surface bounded). */
export function isAutoFixable(pathId) {
  const meta = boardMetaFor(pathId);
  return meta?.autoFix === true;
}

function basicAuthHeader(apiKey) {
  // Cloudflare Workers: btoa is available.
  return `Basic ${btoa(`${apiKey}:`)}`;
}

/**
 * Build the agent prompt from board row + change surface.
 */
export function buildFixPrompt({
  pathId,
  label,
  state,
  note,
  why,
  changeSurface,
  events = [],
  requested = false,
} = {}) {
  const cs = changeSurface || boardMetaFor(pathId).changeSurface || {};
  const blast = Array.isArray(cs.blastRadius) ? cs.blastRadius : [];
  const trail = events.slice(0, 8).map((e) => ({
    at: e.at,
    hopId: e.hopId,
    outcome: e.outcome,
    summary: e.summary,
    reasonCode: e.reasonCode || null,
  }));

  return [
    "You are the Amari Ops Fixer. A watched production system needs a bounded fix.",
    "",
    `Path: ${pathId}${label ? ` (${label})` : ""}`,
    `State: ${state || "unknown"}`,
    `Note: ${note || "—"}`,
    `Why: ${why || "—"}`,
    requested ? "Trigger: manual request from /ops" : "Trigger: auto attention sweep",
    "",
    "Change surface — STAY INSIDE THIS:",
    `- Touch: ${cs.touch || "unknown"}`,
    `- Blast radius (do not casually edit): ${blast.length ? blast.join(", ") : "none listed"}`,
    `- Talk hint: ${cs.talkHint || "—"}`,
    "",
    "Rules:",
    "1. Investigate only the files/surfaces named in the change surface.",
    "2. Smallest fix that restores the hop. No board redesign, no unrelated refactors.",
    "3. Open a draft PR; title/body must mention the path id.",
    "4. If the failure is secrets/config/GHL console-only (not code), do NOT invent a code change — summarize what a human must do and stop.",
    "5. Primary repo: amarimethod-website. Touch amari-method-docs only to log the incident if needed.",
    "6. After the fix, say how /ops should turn green.",
    "",
    "Recent trail (newest first, truncated):",
    "```json",
    JSON.stringify(trail, null, 2).slice(0, 3500),
    "```",
  ].join("\n");
}

export async function readFixJob(env, pathId) {
  try {
    const kv = env?.PORTAL_KV;
    if (!kv || !pathId) return null;
    return (await kv.get(fixJobKey(pathId), "json")) || null;
  } catch {
    return null;
  }
}

export async function listActiveFixJobs(env, pathIds = []) {
  const out = {};
  await Promise.all(
    pathIds.map(async (id) => {
      const job = await readFixJob(env, id);
      if (job) out[id] = job;
    }),
  );
  return out;
}

export async function queueFixRequest(env, pathId, { reason = "manual" } = {}) {
  const kv = env?.PORTAL_KV;
  if (!kv) return { queued: false, reason: "no-kv" };
  if (!registryPath(pathId)) return { queued: false, reason: "unknown-path" };
  if (!isAutoFixable(pathId)) return { queued: false, reason: "not-fixable" };

  const existing = await readFixJob(env, pathId);
  if (existing && isJobActive(existing)) {
    return { queued: false, reason: "already-running", job: existing };
  }

  const req = {
    pathId,
    reason,
    requestedAt: new Date().toISOString(),
  };
  await kv.put(fixRequestKey(pathId), JSON.stringify(req), { expirationTtl: REQUEST_TTL_S });
  return { queued: true, request: req };
}

function isJobActive(job) {
  if (!job) return false;
  if (job.status === "launching" || job.status === "running" || job.status === "shadow") {
    const at = Date.parse(job.launchedAt || job.updatedAt || "") || 0;
    return Date.now() - at < OPS_FIX_COOLDOWN_MS;
  }
  if (job.status === "launched") {
    const at = Date.parse(job.launchedAt || "") || 0;
    return Date.now() - at < OPS_FIX_COOLDOWN_MS;
  }
  return false;
}

/**
 * Launch (or shadow) a Cursor cloud agent for one path.
 */
export async function launchFixForPath(env, row, { requested = false, force = false } = {}) {
  const pathId = row?.id || row?.pathId;
  if (!pathId) return { ok: false, error: "missing-path" };
  if (!isAutoFixable(pathId) && !force) return { ok: false, error: "not-fixable" };

  const mode = modeOf(env);
  if (mode === OPS_FIX_MODES.OFF) return { ok: false, error: "fix-mode-off" };

  const existing = await readFixJob(env, pathId);
  if (!force && isJobActive(existing)) {
    return { ok: false, error: "cooldown", job: existing };
  }

  const meta = boardMetaFor(pathId);
  const prompt = buildFixPrompt({
    pathId,
    label: row.label,
    state: row.state,
    note: row.note,
    why: row.why,
    changeSurface: row.changeSurface || meta.changeSurface,
    events: row.events || [],
    requested,
  });

  const launchedAt = new Date().toISOString();
  const baseJob = {
    pathId,
    label: row.label || pathId,
    state: row.state,
    note: row.note || null,
    mode,
    requested,
    promptPreview: prompt.slice(0, 400),
    launchedAt,
    updatedAt: launchedAt,
  };

  const kv = env?.PORTAL_KV;
  if (mode === OPS_FIX_MODES.SHADOW) {
    const job = { ...baseJob, status: "shadow", agentId: null, agentUrl: null };
    if (kv) await kv.put(fixJobKey(pathId), JSON.stringify(job), { expirationTtl: JOB_TTL_S });
    console.log(`[ops-fix] shadow would_launch ${pathId}`);
    return { ok: true, shadowed: true, job };
  }

  const apiKey = env.CURSOR_API_KEY;
  if (!apiKey) {
    const job = {
      ...baseJob,
      status: "error",
      error: "CURSOR_API_KEY not configured",
    };
    if (kv) await kv.put(fixJobKey(pathId), JSON.stringify(job), { expirationTtl: JOB_TTL_S });
    return { ok: false, error: "no-api-key", job };
  }

  if (kv) {
    await kv.put(
      fixJobKey(pathId),
      JSON.stringify({ ...baseJob, status: "launching" }),
      { expirationTtl: JOB_TTL_S },
    );
  }

  const repo = env.OPS_FIX_REPO || "https://github.com/Eben283/amarimethod-website";
  try {
    const res = await fetch("https://api.cursor.com/v1/agents", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: { text: prompt },
        name: `Ops fix · ${pathId}`.slice(0, 100),
        repos: [{ url: repo, startingRef: "main" }],
        autoCreatePR: true,
        skipReviewerRequest: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const job = {
        ...baseJob,
        status: "error",
        error: body?.message || body?.error || `Cursor API ${res.status}`,
        httpStatus: res.status,
      };
      if (kv) await kv.put(fixJobKey(pathId), JSON.stringify(job), { expirationTtl: JOB_TTL_S });
      return { ok: false, error: job.error, job };
    }

    const agent = body.agent || body;
    const job = {
      ...baseJob,
      status: "launched",
      agentId: agent.id || null,
      agentUrl: agent.url || (agent.id ? `https://cursor.com/agents/${agent.id}` : null),
      runId: body.run?.id || null,
    };
    if (kv) {
      await kv.put(fixJobKey(pathId), JSON.stringify(job), { expirationTtl: JOB_TTL_S });
      await kv.delete(fixRequestKey(pathId));
    }
    console.log(`[ops-fix] launched ${pathId} → ${job.agentId}`);
    return { ok: true, job };
  } catch (err) {
    const job = {
      ...baseJob,
      status: "error",
      error: err?.message || String(err),
    };
    if (kv) await kv.put(fixJobKey(pathId), JSON.stringify(job), { expirationTtl: JOB_TTL_S });
    return { ok: false, error: job.error, job };
  }
}

/**
 * Cron entry: launch fixers for attention rows + manual requests.
 */
export async function runOpsFixSweep(env, { buildSystemsBoard } = {}) {
  const mode = modeOf(env);
  const summary = {
    mode,
    scannedAt: new Date().toISOString(),
    considered: [],
    launched: [],
    skipped: [],
    errors: [],
  };

  if (mode === OPS_FIX_MODES.OFF) {
    summary.skipped.push("mode-off");
    return summary;
  }

  if (!buildSystemsBoard) {
    summary.errors.push("buildSystemsBoard missing");
    return summary;
  }

  let board;
  try {
    board = await buildSystemsBoard(env);
  } catch (err) {
    summary.errors.push(`board: ${err?.message || err}`);
    return summary;
  }

  const attention = (board.systems || []).filter(
    (s) => isAttentionState(s.state) && isAutoFixable(s.id),
  );

  const kv = env.PORTAL_KV;
  const requestedIds = new Set();
  if (kv) {
    try {
      let cursor;
      do {
        const page = await kv.list({ prefix: "ops:fix:request:", cursor });
        for (const k of page.keys || []) {
          const id = k.name.replace(/^ops:fix:request:/, "");
          if (id) requestedIds.add(id);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch (err) {
      summary.errors.push(`list-requests: ${err?.message || err}`);
    }
  }

  const byId = Object.fromEntries((board.systems || []).map((s) => [s.id, s]));
  const candidates = new Map();
  for (const row of attention) candidates.set(row.id, { row, requested: false });
  for (const id of requestedIds) {
    if (!candidates.has(id) && byId[id]) {
      candidates.set(id, { row: byId[id], requested: true });
    } else if (candidates.has(id)) {
      candidates.get(id).requested = true;
    }
  }

  for (const { row, requested } of candidates.values()) {
    summary.considered.push(row.id);
    const result = await launchFixForPath(env, row, { requested });
    if (result.ok) {
      summary.launched.push({
        pathId: row.id,
        shadowed: !!result.shadowed,
        agentId: result.job?.agentId || null,
        agentUrl: result.job?.agentUrl || null,
      });
    } else {
      summary.skipped.push({ pathId: row.id, reason: result.error });
    }
  }

  return summary;
}

export const __test = {
  modeOf,
  isJobActive,
  basicAuthHeader,
  OPS_FIX_COOLDOWN_MS,
};
