// Exact provider-position transfer for a coordinated nurture cutover. This endpoint imports
// cursor evidence only; it does not read GHL, send a message, activate a sequence, or retire a
// provider workflow. Each item is independently fail-closed so one bad cursor cannot hide a
// good item in the same reviewed batch.

import { SEQUENCES } from "./config.js";
import { importEnrollment } from "./enroll.js";
import { appendEvent, saveEnrollment } from "./store.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 100;
const SEQUENCE_BY_ID = Object.freeze(Object.fromEntries(SEQUENCES.map((s) => [s.sequenceId, s])));

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function readBoundedJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { response: json(413, { error: "request body too large" }) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { response: json(413, { error: "request body too large" }) };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { response: json(400, { error: "invalid JSON" }) };
  }
}

export async function handleEnrollmentImport(request, env, nowMs) {
  const parsed = await readBoundedJson(request);
  if (parsed.response) return parsed.response;
  const items = parsed.value?.enrollments;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH_SIZE) {
    return json(400, { error: `enrollments must contain 1-${MAX_BATCH_SIZE} items` });
  }
  if (!env.NURTURE_DB) return json(503, { error: "NURTURE_DB binding unavailable" });

  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      const sequence = SEQUENCE_BY_ID[item?.sequenceId];
      if (!sequence) throw new Error("unknown sequenceId");
      // importEnrollment accepts only the evidence contract it understands. Extra request keys
      // never influence scheduling or persistence.
      const enrollment = importEnrollment(sequence, item, nowMs);
      const saved = await saveEnrollment(env.NURTURE_DB, enrollment);
      if (!saved.created) {
        results.push({ index, sequenceId: sequence.sequenceId, contactId: enrollment.contactId, status: "skipped" });
        continue;
      }
      await appendEvent(env.NURTURE_DB, {
        ts: nowMs,
        flowKey: sequence.sequenceId,
        definitionVersion: sequence.definitionVersion,
        contactId: enrollment.contactId,
        action: "imported",
        outcome: "imported",
        detail: {
          cursorSource: enrollment.importEvidence.cursorSource,
          capturedAt: enrollment.importEvidence.capturedAt,
          enteredAt: enrollment.enteredAt,
          nextStepIndex: enrollment.importEvidence.nextStepIndex,
          nextDueAt: enrollment.importEvidence.nextDueAt,
          importedSteps: enrollment.importEvidence.nextStepIndex,
          mode: sequence.mode,
        },
      });
      results.push({
        index,
        sequenceId: sequence.sequenceId,
        contactId: enrollment.contactId,
        status: "imported",
        nextStepIndex: enrollment.importEvidence.nextStepIndex,
        nextDueAt: enrollment.importEvidence.nextDueAt,
      });
    } catch (error) {
      results.push({
        index,
        sequenceId: typeof item?.sequenceId === "string" ? item.sequenceId : null,
        contactId: typeof item?.contactId === "string" ? item.contactId : null,
        status: "error",
        error: String(error?.message || error),
      });
    }
  }

  return json(200, {
    success: results.every((r) => r.status !== "error"),
    counts: {
      imported: results.filter((r) => r.status === "imported").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
    },
    results,
  });
}
