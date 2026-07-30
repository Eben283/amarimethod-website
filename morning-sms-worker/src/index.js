// Morning SMS Worker — Twilio smoke test for GHL messaging exit.
// Cron: every 5m in the morning UTC window. Sends to MORNING_SMS_TO:
//   prepare @ 08:00 PT (or 2h before first appt if earlier)
//   meeting @ prepare + 90m ("Staff meeting")

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import { runMorningSms } from "./run.js";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runMorningSms(env).then((summary) => {
        console.log(`[morning-sms] cron ${JSON.stringify(summary)}`);
      }).catch((err) => {
        console.error(`[morning-sms] cron failed: ${err?.message || err}`);
      }),
    );
  },

  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    if (url.pathname === "/run" || url.pathname === "/__scheduled") {
      // NOTE: query key must NOT be named `force` — Cloudflare returns
      // error 1042 for `?force=…` on this workers.dev hostname (WAF).
      const kindsParam = url.searchParams.get("kinds"); // prepare|meeting|both
      const dryRun = url.searchParams.get("dry") === "1";
      let forceKinds;
      if (kindsParam === "prepare") forceKinds = ["prepare"];
      else if (kindsParam === "meeting") forceKinds = ["meeting"];
      else if (kindsParam === "both") forceKinds = ["prepare", "meeting"];
      const summary = await runMorningSms(env, { forceKinds, dryRun });
      return json(summary);
    }

    if (url.pathname === "/status") {
      return json({
        ok: true,
        mode: env.MORNING_SMS_MODE || "shadow",
        from: env.TWILIO_FROM_NUMBER || null,
        toCount: String(env.MORNING_SMS_TO || "")
          .split(/[,\s]+/)
          .filter(Boolean).length,
        timezone: env.TIMEZONE || "America/Los_Angeles",
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
