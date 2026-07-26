// Nurture engine — due-step processing, with the shadow/active gate.
//
// Same beside-GHL safety boundary as the reminder engine: any sequence whose mode isn't
// explicitly "active" NEVER sends — a due step is recorded as `would_send` and marked, so the
// engine runs alongside GHL without a duplicate email reaching a lead. Shadow also never reads
// GHL: a due branch step logs its candidate templates unresolved (zero creds, zero API calls).
//
// Active mode resolves branch steps against a FRESH contact read at send time (per the brief:
// branch state at enrollment time is stale by the time the step fires).
//
// Dependencies are injected (testable now, wired in engine.js):
//   deps.logEvent(record)                      append to automation_events
//   deps.markStep(enrollment, idx, status)     persist the step's new status
//   deps.getContactFields(contactId)           fresh contact custom-field read (active branches)
//   deps.renderMessage(seq, step, enr, tpl)    resolve the copy template → ghl-send params
//   deps.send(message)                         -> { success, messageId?, error? }

/**
 * Resolve which template a step sends, given the step's config definition and the contact's
 * custom fields. Pure. `fields` may be null (unknown) — branches then resolve to null and the
 * caller decides what that means (shadow logs variants; active treats a failed read as failure).
 */
export function resolveTemplate(stepDef, fields) {
  if (stepDef.kind === "email") return stepDef.template;
  if (fields == null) return null;
  const value = fields[stepDef.field];
  if (stepDef.kind === "branch") {
    // "filled_not_other": filled AND not "Other" → personalized; else the chronic fallback
    const filled = value != null && String(value).trim() !== "" && String(value).trim().toLowerCase() !== "other";
    return filled ? stepDef.yes : stepDef.no;
  }
  if (stepDef.kind === "branch_map") {
    return (value != null && stepDef.map[value]) || stepDef.default;
  }
  throw new Error(`unrecognized step kind: ${stepDef.kind}`);
}

function branchDetail(stepDef) {
  if (stepDef.kind === "branch") return { branch: stepDef.field, variants: [stepDef.yes, stepDef.no] };
  if (stepDef.kind === "branch_map") {
    return { branch: stepDef.field, variants: [...new Set([...Object.values(stepDef.map), stepDef.default])] };
  }
  return {};
}

/**
 * Process one due step. Never throws on a send/read failure (records it and moves on).
 * `sequence` is the config object; the step's semantics come from sequence.steps[stepIndex].
 * Returns { outcome: "would_send" | "sent" | "failed" | "skip", reason? }.
 */
export async function processStep({ enrollment, step, sequence }, deps, nowMs) {
  if (step.status !== "pending") return { outcome: "skip", reason: step.status };

  const stepDef = sequence.steps[step.stepIndex];
  const base = {
    ts: nowMs,
    engine: "nurture",
    flowKey: sequence.sequenceId,
    contactId: enrollment.contactId,
    stepIndex: step.stepIndex,
    channel: "email", // every nurture step is an email
  };

  // Shadow is the default: anything not explicitly "active" observes without sending.
  if (sequence.mode !== "active") {
    await deps.logEvent({
      ...base,
      action: "would_send",
      outcome: "would_send",
      detail: { template: stepDef.kind === "email" ? stepDef.template : null, ...branchDetail(stepDef) },
    });
    await deps.markStep(enrollment, step.stepIndex, "would_send");
    return { outcome: "would_send" };
  }

  let template;
  try {
    const fields = stepDef.kind === "email" ? null : await deps.getContactFields(enrollment.contactId);
    template = resolveTemplate(stepDef, fields);
    if (template == null) throw new Error("branch unresolved (no contact fields)");
  } catch (err) {
    await deps.logEvent({ ...base, action: "send", outcome: "failed", detail: { error: String((err && err.message) || err) } });
    await deps.markStep(enrollment, step.stepIndex, "failed");
    return { outcome: "failed" };
  }

  // A throwing render/send fails THIS step only — one bad template must never kill the
  // whole sweep (spec-05 finding; reachable only in active mode).
  let res;
  try {
    const message = await deps.renderMessage(sequence, step, enrollment, template);
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
    detail: ok ? { template } : { template, error: res && res.error },
  });
  await deps.markStep(enrollment, step.stepIndex, ok ? "sent" : "failed");
  return { outcome: ok ? "sent" : "failed" };
}
