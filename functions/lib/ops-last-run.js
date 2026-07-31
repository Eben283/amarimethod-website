// Write ops lastRun / readiness-style summaries to PORTAL_KV.
// Used by Workers so the /ops board can judge dependency health.
// Never throws.

/**
 * @param {object} env
 * @param {string} key  e.g. ops:reminder-engine:lastRun
 * @param {object} payload
 * @param {number} [ttlSeconds]
 */
export async function writeOpsLastRun(env, key, payload, ttlSeconds = 14 * 86400) {
  try {
    const kv = env?.PORTAL_KV;
    if (!kv || !key) return { written: false, reason: "no-kv" };
    const body = {
      ...payload,
      finishedAt: payload.finishedAt || new Date().toISOString(),
    };
    if (ttlSeconds) {
      await kv.put(key, JSON.stringify(body), { expirationTtl: ttlSeconds });
    } else {
      await kv.put(key, JSON.stringify(body));
    }
    return { written: true };
  } catch (err) {
    console.error(`[ops-last-run] put ${key} failed: ${err && err.message}`);
    return { written: false, reason: "threw" };
  }
}

export const OPS_LAST_RUN_KEYS = Object.freeze({
  reminder: "ops:reminder-engine:lastRun",
  nurture: "ops:nurture-engine:lastRun",
  crmMirror: "ops:crm-mirror:lastRun",
  morningSms: "ops:morning-sms:lastRun",
  cosAuth: "ops:cos-auth:lastRun",
  cosChat: "ops:cos-chat:lastRun",
  staffAuth: "ops:staff-auth:lastRun",
  portalAuth: "ops:portal-auth:lastRun",
  portalVerify: "ops:portal-verify:lastRun",
  publicSlots: "ops:public-slots:lastRun",
  stripeWebhook: "ops:stripe-pos-webhook:lastRun",
});

/** On-demand readiness probes (call-coach style). */
export const OPS_READY_KEYS = Object.freeze({
  cos: "cos:status:ready",
  stripe: "stripe:status:ready",
});
