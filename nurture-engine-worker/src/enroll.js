// Nurture engine — enrollment logic. Pure: a normalized nurture event + a sequence config +
// the contact's tags → an enrollment record with each step's absolute due-time resolved.
// Unlike the reminder engine (offsets from appointment start), nurture offsets are CUMULATIVE
// from ENROLLMENT time, mirroring GHL wait nodes. No I/O, no Date.now(), never mutates inputs.

const AFTER_RE = /^(?:0|\+(\d+))([dh])$/;
const UNIT_MS = { d: 86400000, h: 3600000 };

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
    contactId: event.contactId,
    enteredAt: nowMs,
    status: "active",
    guardUnchecked: unchecked,
    steps: buildSteps(sequence, nowMs),
  };
}

/**
 * Import a mid-sequence GHL enrollment at cutover (the 15 in-flight Flow 1 + 1 Flow 3
 * contacts). Due-times are computed from the ORIGINAL entry time; any step already due at
 * import is marked "imported" — GHL owned that send, the engine must never back-fire it.
 */
export function importEnrollment(sequence, { contactId, enteredAt }, nowMs) {
  const steps = buildSteps(sequence, enteredAt).map((s) =>
    s.dueAt <= nowMs ? { ...s, status: "imported" } : s,
  );
  return {
    sequenceId: sequence.sequenceId,
    contactId,
    enteredAt,
    status: "active",
    guardUnchecked: false,
    steps,
  };
}
