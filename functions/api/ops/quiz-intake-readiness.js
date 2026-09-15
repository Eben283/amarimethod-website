// Cloudflare Pages Function: GET /api/ops/quiz-intake-readiness
//
// Protected, read-only proof that Pages can reach the owned CRM through the
// native CRM_MIRROR service binding and authenticate with the shared Worker
// secret. This endpoint does not read quiz submissions or write customer data.

import { requireOpsReadKey } from "../../lib/ops-auth.js";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const READINESS_URL = "https://amari-crm-mirror.internal/quiz-intake/readiness";

function reply(payload, status) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const checkedAt = new Date().toISOString();
  if (context.env.OWNED_QUIZ_BRIDGE_RELEASE !== "approved") {
    return reply({ ok: false, checkedAt, error: "quiz bridge release is not approved" }, 422);
  }
  if (!context.env.CRM_MIRROR?.fetch || !context.env.WORKER_AUTH_SECRET) {
    return reply({ ok: false, checkedAt, error: "quiz bridge binding or authentication is not configured" }, 422);
  }

  try {
    const response = await context.env.CRM_MIRROR.fetch(new Request(READINESS_URL, {
      headers: {
        Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}`,
        Accept: "application/json",
      },
    }));
    const payload = await response.json().catch(() => null);
    const nurtureSafe = payload?.nurtureDispatch?.configured === true
      && payload?.nurtureDispatch?.shadowOnly === true
      && payload?.nurtureDispatch?.deliveryEnabled === false;
    const ready = response.ok
      && payload?.success === true
      && payload?.worker === "amari-crm-mirror"
      && nurtureSafe;

    if (!ready) {
      console.error("[quiz-intake-readiness] owned CRM readiness proof failed", response.status);
      return reply({ ok: false, checkedAt, error: "owned CRM readiness proof failed" }, 422);
    }

    return reply({
      ok: true,
      checkedAt,
      worker: payload.worker,
      intakeState: payload.state,
      nurtureShadowOnly: true,
      deliveryEnabled: false,
    }, 200);
  } catch (error) {
    console.error("[quiz-intake-readiness] service binding request failed", error instanceof Error ? error.message : String(error));
    return reply({ ok: false, checkedAt, error: "owned CRM readiness proof failed" }, 422);
  }
}
