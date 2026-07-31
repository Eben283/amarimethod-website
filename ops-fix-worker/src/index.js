// Ops Fixer worker — every 15m, launch bounded Cursor agents for red/stuck paths.

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import { buildSystemsBoard } from "../../functions/lib/ops-board.js";
import { runOpsFixSweep } from "../../functions/lib/ops-fix.js";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runOpsFixSweep(env, { buildSystemsBoard })
        .then((summary) => {
          console.log(`[ops-fixer] cron ${JSON.stringify(summary)}`);
        })
        .catch((err) => {
          console.error(`[ops-fixer] cron failed: ${err?.message || err}`);
        }),
    );
  },

  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);
    if (url.pathname === "/run" || url.pathname === "/__scheduled") {
      const summary = await runOpsFixSweep(env, { buildSystemsBoard });
      return json(summary);
    }
    if (url.pathname === "/status") {
      return json({
        ok: true,
        mode: env.OPS_FIX_MODE || "shadow",
        repo: env.OPS_FIX_REPO || null,
        hasCursorKey: !!env.CURSOR_API_KEY,
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
