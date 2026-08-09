// Reminder engine — due-step processing, with the shadow/active gate.
//
// This is the beside-GHL safety boundary. In "shadow" mode (the DEFAULT for any flow whose mode
// isn't explicitly "active") a due step is NEVER sent: the engine records a `would_send` event and
// marks the step, so it runs alongside GHL for weeks without a single duplicate message reaching a
// client. Only "active" mode calls the send adapter for real.
//
// Dependencies are injected so this stays pure-of-infrastructure and testable now; the real wiring
// (D1 store, copy templates, functions/lib/ghl-send.js) plugs into `deps` later:
//   deps.logEvent(record)                 append to automation_events
//   deps.markStep(enrollment, idx, status) persist the step's new status
//   deps.renderMessage(flow, step, enroll) resolve the copy template → a ghl-send params object
//   deps.send(message)                    -> { success, messageId?, error? }  (functions/lib/ghl-send)

export function channelForType(type) {
  return type === "sms" || type === "internal_sms" ? "sms" : "email";
}

/**
 * Process one due step. Never throws on a send failure (records it and moves on). Returns
 * `{ outcome: "would_send" | "sent" | "failed" | "skip", reason? }`.
 */
export async function processStep({ enrollment, step, flow }, deps, nowMs) {
  if (step.status !== "pending") return { outcome: "skip", reason: step.status };

  const base = {
    ts: nowMs,
    engine: "reminder",
    flowKey: flow.flowKey,
    definitionVersion: enrollment.definitionVersion ?? flow.definitionVersion,
    contactId: enrollment.contactId,
    appointmentId: enrollment.appointmentId,
    stepIndex: step.stepIndex,
    channel: channelForType(step.type),
  };

  // Shadow is the default: anything not explicitly "active" observes without sending.
  if (flow.mode !== "active") {
    await deps.logEvent({ ...base, action: "would_send", outcome: "would_send", detail: { template: step.template } });
    await deps.markStep(enrollment, step.stepIndex, "would_send");
    return { outcome: "would_send" };
  }

  // A throwing render/send fails THIS step only — one bad template must never kill the
  // whole sweep (spec-05 finding; reachable only in active mode).
  let res;
  try {
    const message = await deps.renderMessage(flow, step, enrollment);
    res = await deps.send(message);
  } catch (err) {
    res = { success: false, error: String((err && err.message) || err) };
  }
  const ok = !!(res && res.success);
  await deps.logEvent({
    ...base,
    action: "send",
    outcome: ok ? "sent" : "failed",
    message_ref: (res && res.messageId) || null,
    detail: ok ? {} : { error: res && res.error },
  });
  await deps.markStep(enrollment, step.stepIndex, ok ? "sent" : "failed");
  return { outcome: ok ? "sent" : "failed" };
}
