// Nurture engine — enrollment logic. Pure: a normalized nurture event + a sequence config +
// the contact's tags → an enrollment record with each step's absolute due-time resolved.
// Unlike the reminder engine (offsets from appointment start), nurture offsets are CUMULATIVE
// from ENROLLMENT time, mirroring GHL wait nodes. No I/O, no Date.now(), never mutates inputs.

const AFTER_RE = /^(?:0|\+(\d+))([dh])$/;
const UNIT_MS = { d: 86400000, h: 3600000 };
export const IMPORT_CURSOR_TOLERANCE_MS = 5 * 60 * 1000;
export const IMPORT_EVIDENCE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Parse a step's `after` offset ("0d", "+3d", "+12h") to ms. Throws on anything else —
 * a typo'd config must fail loudly, not schedule garbage.
 */
export function parseAfter(after) {
  const m = AFTER_RE.exec(after);
  if (!m) throw new Error(`unrecognized step offset: ${after}`);
  return Number(m[1] || 0) * UNIT_MS[m[2]];
}

/**
 * Evaluate the entry guard. `tags` is the contact's tag list, or null when unknown (no tag
 * reader wired). Unknown tags: shadow enrolls optimistically (observation costs nothing,
 * flagged guardUnchecked so the shadow compare can discount it); active FAILS CLOSED (never
 * email someone the guard might exclude).
 * @returns {{ allowed: boolean, unchecked: boolean }}
 */
export function guardAllows(sequence, tags) {
  const guard = sequence.entry.guard;
  if (!guard) return { allowed: true, unchecked: false };
  if (tags == null) {
    return sequence.mode === "active"
      ? { allowed: false, unchecked: true }
      : { allowed: true, unchecked: true };
  }
  const lower = tags.map((t) => String(t).toLowerCase());
  const blocked = guard.notTags.some((t) => lower.includes(t.toLowerCase()));
  return { allowed: !blocked, unchecked: false };
}

function buildSteps(sequence, fromMs) {
  let cursorMs = fromMs;
  return sequence.steps.map((s, stepIndex) => {
    cursorMs += parseAfter(s.after);
    return {
      stepIndex,
      after: s.after,
      kind: s.kind,
      // branch templates are resolved against a FRESH contact read at send time, not here
      template: s.kind === "email" ? s.template : null,
      dueAt: cursorMs,
      status: "pending",
    };
  });
}

/**
 * Build an enrollment record, or null if the guard blocks (or fails closed on unknown tags in
 * active mode). Eligibility against entry.on is the engine's job — this assumes a matched event.
 * Returns fresh objects; inputs are untouched.
 */
export function enroll(event, sequence, contact, nowMs) {
  const { allowed, unchecked } = guardAllows(sequence, contact ? contact.tags : null);
  if (!allowed) return null;
  return {
    sequenceId: sequence.sequenceId,
    definitionVersion: sequence.definitionVersion,
    contactId: event.contactId,
    enteredAt: nowMs,
    status: "active",
    guardUnchecked: unchecked,
    steps: buildSteps(sequence, nowMs),
  };
}

/**
 * Plan an exact mid-sequence provider enrollment transfer. Time alone is not proof that a
 * provider actually completed a step: delayed/manual workflow actions can make a due-time
 * cursor lie. The caller must therefore supply a fresh, observed next-step cursor and its
 * scheduled time. Earlier steps become immutable imported history; the observed next step and
 * everything after it remain pending. A stale, mismatched, or already-overdue cursor fails
 * closed so activation can neither replay history nor silently skip an ambiguous action.
 */
export function importEnrollment(sequence, evidence, nowMs) {
  if (!sequence || !Array.isArray(sequence.steps)) throw new Error("sequence is required");
  if (!evidence || typeof evidence !== "object") throw new Error("import evidence is required");
  const { contactId, enteredAt, nextStepIndex, nextDueAt, capturedAt, cursorSource } = evidence;
  if (typeof contactId !== "string" || !contactId.trim()) throw new Error("contactId is required");
  for (const [name, value] of Object.entries({ enteredAt, nextDueAt, capturedAt, nowMs })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a millisecond timestamp`);
  }
  if (cursorSource !== "provider_enrollment_history") {
    throw new Error("cursorSource must be provider_enrollment_history");
  }
  if (enteredAt > capturedAt) throw new Error("enteredAt cannot be after capturedAt");
  if (capturedAt > nowMs + IMPORT_CURSOR_TOLERANCE_MS) throw new Error("capturedAt cannot be in the future");
  if (nowMs - capturedAt > IMPORT_EVIDENCE_MAX_AGE_MS) throw new Error("import evidence is stale");
  if (!Number.isInteger(nextStepIndex) || nextStepIndex < 0 || nextStepIndex >= sequence.steps.length) {
    throw new Error("nextStepIndex must identify a pending sequence step");
  }

  const scheduled = buildSteps(sequence, enteredAt);
  const expectedNextDueAt = scheduled[nextStepIndex].dueAt;
  if (Math.abs(expectedNextDueAt - nextDueAt) > IMPORT_CURSOR_TOLERANCE_MS) {
    throw new Error("observed next action does not match the sequence schedule");
  }
  if (nextDueAt <= nowMs) {
    throw new Error("observed next action is already due; resolve provider state before import");
  }

  const steps = scheduled.map((step) => (
    step.stepIndex < nextStepIndex ? { ...step, status: "imported" } : step
  ));
  return {
    sequenceId: sequence.sequenceId,
    definitionVersion: sequence.definitionVersion,
    contactId: contactId.trim(),
    enteredAt,
    status: "active",
    guardUnchecked: false,
    steps,
    importEvidence: Object.freeze({
      cursorSource,
      capturedAt,
      nextStepIndex,
      nextDueAt,
    }),
  };
}
