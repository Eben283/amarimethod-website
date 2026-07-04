// Ops error sink — records production failures durably so a human actually
// finds out about them.
//
// Why this exists: the webhook handlers run on Cloudflare 24/7 with no way to
// reach a person, and a bare console.error only survives inside a live
// `wrangler tail`. So a payment that fails to apply (client paid, balance not
// updated) used to fail *silently*. recordOpsError() writes one durable KV
// entry per failure; a delivery step (a session-run Gmail bridge today, a
// Cloudflare email worker later) lists the prefix, emails them out, and clears
// each one.
//
// Design choices:
//   - ONE entry per failure under `ops:err:<iso>-<rand>` — no read-modify-write,
//     so concurrent webhook invocations can't clobber each other's alerts.
//   - ISO-timestamp key prefix → KV list returns them oldest-first for free.
//   - recordOpsError() NEVER throws. An alert that breaks the request it is
//     reporting on is worse than the original failure, so every path here is
//     caught and swallowed. This is the one place swallowing is correct.
//   - detail carries IDs + status codes only, never tokens or full payloads.

const OPS_ERR_PREFIX = "ops:err:";
const OPS_ERR_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — long enough to never miss one

// Prefer the general namespace so the delivery side has one place to look;
// fall back to the purchase namespace the webhooks already bind.
function opsKv(env) {
  return (env && (env.PORTAL_KV || env.PURCHASE_KV)) || null;
}

function buildKey(nowIso, rand) {
  return `${OPS_ERR_PREFIX}${nowIso}-${rand}`;
}

/**
 * Record a production failure for out-of-band delivery. Fire-and-forget:
 * callers should hand the returned promise to context.waitUntil() so it never
 * adds latency to the (already failing) request. Resolves to a result object
 * rather than throwing — see file header.
 */
export async function recordOpsError(env, source, summary, detail = {}) {
  try {
    const kv = opsKv(env);
    const nowIso = new Date().toISOString();
    if (!kv) {
      console.error(`[ops-alert] no KV binding — dropping alert: ${source}: ${summary}`);
      return { recorded: false, reason: "no-kv" };
    }
    const rand = Math.random().toString(36).slice(2, 8);
    const key = buildKey(nowIso, rand);
    const entry = { source, summary, detail, at: nowIso };
    await kv.put(key, JSON.stringify(entry), { expirationTtl: OPS_ERR_TTL_SECONDS });
    console.error(`[ops-alert] recorded ${key} — ${source}: ${summary}`);
    return { recorded: true, key };
  } catch (err) {
    console.error(`[ops-alert] failed to record alert (${source}): ${err && err.message}`);
    return { recorded: false, reason: "threw" };
  }
}

// ── Delivery side (read + clear) ────────────────────────────────────────────

/** List recorded errors oldest-first (up to `limit`). Returns [] when unbound. */
export async function listOpsErrors(env, { limit = 100 } = {}) {
  const kv = opsKv(env);
  if (!kv) return [];
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: OPS_ERR_PREFIX, cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (raw) out.push({ key: k.name, ...safeParse(raw) });
      if (out.length >= limit) return out;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Delete one recorded error after it has been delivered. */
export async function clearOpsError(env, key) {
  const kv = opsKv(env);
  if (kv) await kv.delete(key);
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { summary: "unparseable ops entry", detail: { raw } };
  }
}

// Exposed for tests only.
export const __test = { OPS_ERR_PREFIX, OPS_ERR_TTL_SECONDS, buildKey, opsKv, safeParse };
