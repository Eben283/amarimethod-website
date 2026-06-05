// Abuse protection for the unauthenticated magic-link auth endpoints
// (portal-auth.js, partner-auth.js).
//
// Threat (auth-jwt-audit-2026-06-04, HIGH-1 + MEDIUM-2): an unauthenticated
// POST {email} mutates a GHL contact + triggers a login email. Pre-fix the only
// guard was a 60s PER-EMAIL cooldown written AFTER all the GHL work, so:
//   - one request / 60s = ~1,440 real login emails/day to a known client
//     (targeted harassment + sender-domain deliverability damage), and
//   - N concurrent same-email requests all read "no cooldown" and all send
//     before any of them writes the key (the race).
//
// Fix shape: `reserveAuthSlot` checks THEN writes the cooldown + counters in one
// call that the endpoint runs BEFORE any GHL work. Three layers:
//   1. per-email cooldown  — one email per address per EMAIL_COOLDOWN_SEC
//   2. per-IP window cap    — burst cap per CF-Connecting-IP
//   3. global daily ceiling — a backstop against spraying many distinct emails
//
// KV has no compare-and-set, so the per-IP/global increments are read-then-write
// and can undercount slightly under a burst — acceptable; the per-email cooldown
// is the tight gate against bombing a single target, and true single-flight would
// need a Durable Object (out of scope). On a KV error we FAIL OPEN for
// availability (a KV blip shouldn't lock everyone out of login) but log loudly so
// a silent outage is visible — the global ceiling + any Cloudflare WAF remain.

export const RATE_LIMITS = Object.freeze({
  EMAIL_COOLDOWN_SEC: 5 * 60, // one login email per address per 5 min (was 60s)
  IP_WINDOW_SEC: 10 * 60,     // per-IP rolling window length
  IP_MAX_PER_WINDOW: 12,      // generous for a human retyping; kills bombing
  GLOBAL_MAX_PER_DAY: 300,    // ceiling across all addresses for one scope/day
});

// Reserve a send slot. Returns { ok: true } to proceed, or
// { ok: false, status, error } to short-circuit with that response.
// `scope` namespaces the keys ("portal" | "partner"). `dateKey` is a YYYY-MM-DD
// string in the caller's timezone; `nowMs`/timestamps are not needed beyond TTLs.
export async function reserveAuthSlot(kv, { ip, email, scope, dateKey }) {
  if (!kv) {
    // No KV binding → cannot rate-limit here. Allow (availability) but flag it.
    console.error(`[rate-limit] ${scope}: PORTAL_KV unavailable — proceeding without app-level limit`);
    return { ok: true, degraded: true };
  }

  const cleanIp = (ip || "unknown").slice(0, 64);
  const emailKey = `cooldown:${scope}:${email}`;
  const ipKey = `rl:ip:${scope}:${cleanIp}`;
  const globalKey = `rl:global:${scope}:${dateKey}`;

  try {
    const [emailHit, ipRaw, globalRaw] = await Promise.all([
      kv.get(emailKey),
      kv.get(ipKey),
      kv.get(globalKey),
    ]);

    if (emailHit) {
      return { ok: false, status: 429, error: "Please wait a few minutes before requesting another login link." };
    }
    const ipCount = parseInt(ipRaw || "0", 10) || 0;
    if (ipCount >= RATE_LIMITS.IP_MAX_PER_WINDOW) {
      return { ok: false, status: 429, error: "Too many login attempts from your network. Please try again shortly." };
    }
    const globalCount = parseInt(globalRaw || "0", 10) || 0;
    if (globalCount >= RATE_LIMITS.GLOBAL_MAX_PER_DAY) {
      return { ok: false, status: 429, error: "Login is temporarily rate-limited. Please try again later." };
    }

    // Reserve BEFORE the caller does any GHL work, so concurrent/rapid requests
    // for the same target are blocked even before the email is sent.
    await Promise.all([
      kv.put(emailKey, "1", { expirationTtl: RATE_LIMITS.EMAIL_COOLDOWN_SEC }),
      kv.put(ipKey, String(ipCount + 1), { expirationTtl: RATE_LIMITS.IP_WINDOW_SEC }),
      kv.put(globalKey, String(globalCount + 1), { expirationTtl: 86400 }),
    ]);
    return { ok: true };
  } catch (err) {
    console.error(`[rate-limit] ${scope}: KV error, failing open — ${err.message}`);
    return { ok: true, degraded: true };
  }
}
