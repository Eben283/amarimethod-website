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

  // A control node is part of the same authored workflow, but is not a client message.
  // In shadow it is evidence only; active mode may only exit a separately owned flow.
  if (step.type === "exit_flow") {
    if (flow.mode !== "active") {
      await deps.logEvent({ ...base, channel: null, action: "would_exit", outcome: "would_execute", detail: { target: step.target, template: step.template } });
      await deps.markStep(enrollment, step.stepIndex, "would_execute");
      return { outcome: "would_execute" };
    }
    try {
      const external = String(step.target || "").startsWith("ghl:");
      const result = external
        ? await deps.exitExternalFlow?.(step.target, enrollment.contactId)
        : await deps.exitFlow?.(step.target, enrollment.contactId);
      if (!result) throw new Error("owned exit target is unavailable");
      await deps.logEvent({ ...base, channel: null, action: "exit", outcome: "executed", detail: { target: step.target, ...result } });
      await deps.markStep(enrollment, step.stepIndex, "executed");
      return { outcome: "executed" };
    } catch (err) {
      await deps.logEvent({ ...base, channel: null, action: "exit", outcome: "failed", detail: { target: step.target, error: String(err?.message || err) } });
      await deps.markStep(enrollment, step.stepIndex, "failed");
      return { outcome: "failed" };
    }
  }

  // A cutover adapter has its own explicit eligibility gate. It runs before the
  // generic active sender so a canonical workflow can use its literal node
  // renderer rather than falling through to an unrelated transport. The gate
  // must be satisfied even when the workflow is active; it never turns a
  // shadow workflow into a sender by itself.
  if (deps.controlledDelivery) {
    try {
      const delivered = await deps.controlledDelivery(flow, step, enrollment);
      if (delivered?.handled) {
        const ok = delivered.result?.success === true;
        const isTest = delivered.kind === "test";
        await deps.logEvent({
          ...base,
          action: isTest ? "test_send" : "send",
          outcome: ok ? "sent" : "failed",
          message_ref: delivered.result?.messageId || null,
          detail: {
            recipient: delivered.recipient,
            ...(isTest ? { testOnly: true } : { cutover: true }),
            ...(ok ? {} : { error: delivered.result?.error || "delivery failed" }),
          },
        });
        await deps.markStep(enrollment, step.stepIndex, ok ? "sent" : "failed");
        return { outcome: ok ? "sent" : "failed" };
      }
    } catch (err) {
      await deps.logEvent({ ...base, action: "send", outcome: "failed", detail: { cutover: true, error: String(err?.message || err) } });
      await deps.markStep(enrollment, step.stepIndex, "failed");
      return { outcome: "failed" };
    }
  }

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
