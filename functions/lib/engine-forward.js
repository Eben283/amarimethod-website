// Engine event forwarding — the Pages→worker leg of the event plumbing (GHL exit substrate).
//
// The engines live in standalone Workers (reminder-engine, nurture-engine) and receive typed
// events on their auth-gated POST /event routes; Pages code never imports engine code
// (cross-bundle). This module is the one place that knows how to hand an event across.
//
// Pre-deploy state is first-class: until the worker URLs (REMINDER_ENGINE_URL /
// NURTURE_ENGINE_URL) and WORKER_AUTH_SECRET exist in the Pages env, every forward is a clean
// skip — so the emitters can ship now and light up at deploy with zero code changes.
// Never throws: event forwarding must never break the money/booking path that emits it.

/**
 * POST a typed event to a worker's /event route. Returns { ok, actions?, skipped?, error? }.
 * @param {object} env - Pages/Worker env (context.env)
 * @param {{urlVar: string, event: object, fetcher?: Function}} opts - urlVar names the env var
 *   holding the worker URL. Pass `fetcher` (e.g. a service binding's fetch) for worker→worker
 *   calls: Cloudflare blocks same-account *.workers.dev subrequests, so a plain fetch only
 *   works from Pages Functions.
 */
export async function forwardEventToEngine(env, { urlVar, event, fetcher }) {
  const base = env && env[urlVar];
  const secret = env && env.WORKER_AUTH_SECRET;
  if (!base || !secret) return { ok: true, skipped: "unconfigured" };
  const doFetch = fetcher || fetch;

  try {
    const res = await doFetch(`${String(base).replace(/\/$/, "")}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(event),
    });
    if (!res.ok) return { ok: false, error: `engine responded ${res.status}` };
    const body = await res.json().catch(() => ({}));
    return { ok: true, actions: body.actions || [] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * Fire-and-forget a kinded event ({kind: "quiz.submitted"|"purchase"|"tag.added", ...}) to the
 * nurture engine. Rides context.waitUntil so the emitting request's response is never delayed;
 * swallows everything (forwardEventToEngine already never throws).
 */
export function emitNurtureEvent(context, event) {
  try {
    const p = forwardEventToEngine(context && context.env, { urlVar: "NURTURE_ENGINE_URL", event });
    if (context && typeof context.waitUntil === "function") context.waitUntil(p);
  } catch {
    // never let telemetry-grade plumbing break the caller
  }
}
