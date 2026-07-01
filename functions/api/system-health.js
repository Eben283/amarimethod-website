// Cloudflare Pages Function: GET /api/system-health
//
// Server-side computation of /day's "System Health" checks, reading KV via the
// native binding — so the local /day skill needs a shared ops-read key (same
// gate as /api/daily-audit), not a Cloudflare API token. That token requirement
// was the whole source of the 2026-07-01 health-check.js false-"unknown" bug:
// a machine-specific keychain credential that could silently go stale/missing.
// This endpoint removes that dependency — see ~/.claude/ghl-mcp/health-check.js.
//
// Judgment logic (judgeWorker/checkToken/checkDailyAudit) is a deliberate
// duplicate of the same functions in health-check.js, not a shared import —
// this repo and claude-config are separate deploy targets, and the logic is
// small enough that keeping two copies in sync by hand beats cross-repo tooling.
import { requireOpsReadKey } from "../lib/ops-auth.js";

const HOUR = 3600 * 1000;

function ageHours(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / HOUR;
}

function fmtAge(h) {
  if (h == null) return "unknown time";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// A worker check: green if recent + ok, red if stale/errored, unknown if no record.
function judgeWorker(label, rec, { maxAgeH, okPredicate, detail }) {
  if (!rec) return { label, state: "unknown", note: "couldn't read KV record" };
  const age = ageHours(rec.finishedAt || rec.startedAt || rec.ranAt);
  const stale = age == null || age > maxAgeH;
  const ok = okPredicate(rec);
  if (!ok) return { label, state: "red", note: `status not ok: ${detail(rec)}` };
  if (stale) return { label, state: "red", note: `stale — last ran ${fmtAge(age)} (expected < ${maxAgeH}h)` };
  return { label, state: "green", note: `ran ${fmtAge(age)}${detail(rec) ? ` · ${detail(rec)}` : ""}` };
}

async function checkToken(kv) {
  const expiryRaw = await kv.get("ghl_token_expiry");
  if (expiryRaw == null) return { label: "GHL token", state: "unknown", note: "couldn't read token expiry from KV" };
  const expiry = Number(expiryRaw);
  if (!expiry) return { label: "GHL token", state: "red", note: "no/invalid expiry in KV" };
  const hoursLeft = (expiry - Date.now()) / HOUR;
  if (hoursLeft <= 0) return { label: "GHL token", state: "red", note: "expired in KV — re-auth or token-refresh worker is down" };
  return { label: "GHL token", state: "green", note: `fresh (${hoursLeft.toFixed(0)}h left)` };
}

async function checkDailyAudit(kv) {
  // Timing gotcha: the audit cron runs 11:00 UTC. Before then today's key is
  // legitimately absent — fall back to yesterday rather than false-alarming.
  const now = new Date();
  const beforeCron = now.getUTCHours() < 11;
  const day = new Date(now.getTime() - (beforeCron ? 24 * HOUR : 0));
  const ds = day.toISOString().slice(0, 10);
  const rec = await kv.get(`ops:daily-audit:${ds}`, "json");
  if (!rec) {
    return { label: "Daily audit", state: beforeCron ? "unknown" : "red", note: `no audit record for ${ds}${beforeCron ? " (pre-11:00 UTC, expected)" : " — cron may be dead"}` };
  }
  const n = Array.isArray(rec.issues) ? rec.issues.length : "?";
  return { label: "Daily audit", state: "green", note: `present for ${ds} (${n} issues)` };
}

export async function onRequestGet(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers });
  }

  const [token, reconcile, partner, audit] = await Promise.all([
    checkToken(kv),
    kv.get("ops:series-reconcile:lastRun", "json").then((r) =>
      judgeWorker("Reconcile sync", r, {
        maxAgeH: 3, // hourly cron
        okPredicate: (x) => x.status === "ok" && !x.orderPassError,
        detail: (x) => (x.applied ? `${x.applied} corrections applied` : "0 drift"),
      })
    ),
    kv.get("ops:activity-refresh:lastRun", "json").then((r) =>
      judgeWorker("Partner refresh", r, {
        maxAgeH: 26, // daily window
        okPredicate: (x) => x.status === "ok" && !x.failed,
        detail: (x) => (x.written != null ? `${x.written} written` : ""),
      })
    ),
    checkDailyAudit(kv),
  ]);

  const checks = [token, reconcile, partner, audit];
  const reds = checks.filter((c) => c.state === "red");
  const unknowns = checks.filter((c) => c.state === "unknown");
  const overall = reds.length ? "red" : unknowns.length ? "unknown" : "green";

  return new Response(
    JSON.stringify({ overall, checks, generatedAt: new Date().toISOString() }),
    { status: 200, headers }
  );
}
