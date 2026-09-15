// Public quiz -> owned CRM handoff. The browser never receives Worker auth and
// never chooses the destination or source mode. Pages keeps origin, Turnstile,
// rate-limit, and idempotency ownership; this module carries only the already
// normalized payload across the private same-account service binding.

export const OWNED_QUIZ_BRIDGE_SOURCE_MODE = "active";
const INTAKE_URL = "https://crm-mirror.internal/contacts/quiz-intake";

const PAYLOAD_FIELDS = Object.freeze([
  "firstName", "lastName", "email", "phone", "patternSignature",
  "recoveryPotentialScore", "primaryPainLocation", "painSeverity", "painDuration",
  "treatmentsTried", "painTrigger", "additionalPainAreas", "painIntensity",
  "painTiming", "painType", "aggravatingActivities", "dailyImpact",
  "treatmentResults", "healthConditions", "scores", "insights", "referralSource",
]);

export function ownedQuizIntakePayload(submission, { idempotencyKey, audience, resultsSummary }) {
  const payload = Object.fromEntries(PAYLOAD_FIELDS.map((key) => [key, submission[key]]));
  return {
    idempotencyKey,
    ...payload,
    audience,
    resultsSummary,
  };
}

// `sourceMode` remains injectable only for fail-closed unit coverage. The
// production call site does not override it. Active source still cannot write
// unless the independent release flag, private binding, and Worker auth all
// exist in the Pages runtime.
export async function forwardOwnedQuizIntake(env, payload, {
  sourceMode = OWNED_QUIZ_BRIDGE_SOURCE_MODE,
} = {}) {
  if (sourceMode === "shadow") return { ok: true, skipped: "source_shadow" };
  if (sourceMode !== "active") return { ok: false, error: "invalid_source_mode" };
  if (env?.OWNED_QUIZ_BRIDGE_RELEASE !== "approved") {
    return { ok: false, error: "release_not_approved" };
  }
  if (!env?.CRM_MIRROR?.fetch || !env?.WORKER_AUTH_SECRET) {
    return { ok: false, error: "owned_intake_unconfigured" };
  }

  let response;
  try {
    response = await env.CRM_MIRROR.fetch(new Request(INTAKE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WORKER_AUTH_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }));
  } catch {
    return { ok: false, error: "owned_intake_unavailable" };
  }
  if (!response.ok) {
    return { ok: false, error: "owned_intake_rejected", status: response.status };
  }
  const result = await response.json().catch(() => null);
  if (!result?.success || typeof result.contactId !== "string"
    || !/^[a-f0-9]{64}$/.test(String(result.payloadSha256 || ""))) {
    return { ok: false, error: "owned_intake_invalid_acknowledgement" };
  }
  return { ok: true, deduped: result.deduped === true };
}
