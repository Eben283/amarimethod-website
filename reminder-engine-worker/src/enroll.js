// Reminder engine — enrollment logic. Pure: a typed appointment event + a FLOW config →
// an enrollment record with each step's absolute due-time resolved. No I/O, no Date.now()
// (now is passed in), never mutates its inputs. This is the heart of the engine's correctness.

const OFFSET_RE = /^start([+-])(\d+)m$/;

/**
 * Resolve a step's `at` offset to an absolute epoch-ms due time.
 * @param {string} at - "enroll" | "start-<n>m" | "start+<n>m"
 * @param {number} startMs - appointment start (epoch ms)
 * @param {number} nowMs - enrollment time (epoch ms)
 * @returns {number} epoch ms
 */
export function resolveDueAt(at, startMs, nowMs) {
  if (at === "enroll") return nowMs;
  const m = OFFSET_RE.exec(at);
  if (!m) throw new Error(`unrecognized step offset: ${at}`);
  const minutes = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return startMs + minutes * 60000;
}

/**
 * Does this event enroll into this flow? Mirrors the GHL appointment_status trigger filters.
 * @returns {boolean}
 */
export function isEligible(event, flow) {
  if (!event || event.recognized !== true) return false;
  if (!flow.calendarIds.includes(event.calendarId)) return false;
  if (!flow.enrollOn.statuses.includes(event.type)) return false;
  const mb = flow.enrollOn.modifiedBy;
  if (mb && !mb.includes(event.modifiedBy)) return false;
  return true;
}

/**
 * Build an enrollment record for an eligible event, or null if not eligible / unschedulable.
 * Steps whose `skipIfPast` time has already passed at enrollment are marked "skipped" (never
 * back-fired); everything else is "pending". Returns fresh objects; inputs are untouched.
 */
export function enroll(event, flow, nowMs) {
  if (!isEligible(event, flow)) return null;
  const startMs = Date.parse(event.startAt);
  if (!Number.isFinite(startMs)) return null; // no start → can't schedule

  const steps = flow.steps.map((s, stepIndex) => {
    const dueAt = resolveDueAt(s.at, startMs, nowMs);
    const skipped = s.skipIfPast === true && dueAt < nowMs;
    return {
      stepIndex,
      at: s.at,
      type: s.type,
      template: s.template,
      dueAt,
      status: skipped ? "skipped" : "pending",
    };
  });

  return {
    flowKey: flow.flowKey,
    definitionVersion: flow.definitionVersion,
    appointmentId: event.appointmentId,
    contactId: event.contactId,
    calendarId: event.calendarId,
    startAt: event.startAt,
    startMs,
    enrolledAt: nowMs,
    status: "active",
    steps,
  };
}
