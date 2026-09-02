// Reminder engine — enrollment logic. Pure: a typed appointment event + a FLOW config →
// an enrollment record with each step's absolute due-time resolved. No I/O, no Date.now()
// (now is passed in), never mutates its inputs. This is the heart of the engine's correctness.

const START_OFFSET_RE = /^start([+-])(\d+)m$/;
const ENROLL_OFFSET_RE = /^enroll\+(\d+)m$/;

/**
 * Resolve a step's `at` offset to an absolute epoch-ms due time.
 * @param {string} at - "enroll" | "enroll+<n>m" | "start-<n>m" | "start+<n>m"
 * @param {number} startMs - appointment start (epoch ms)
 * @param {number} nowMs - enrollment time (epoch ms)
 * @returns {number} epoch ms
 */
export function resolveDueAt(at, startMs, nowMs) {
  if (at === "enroll") return nowMs;
  const enrollOffset = ENROLL_OFFSET_RE.exec(at);
  if (enrollOffset) return nowMs + Number(enrollOffset[1]) * 60000;
  const m = START_OFFSET_RE.exec(at);
  if (!m) throw new Error(`unrecognized step offset: ${at}`);
  const minutes = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return startMs + minutes * 60000;
}

/**
 * Does this event enroll into this flow? Mirrors the GHL appointment_status trigger filters.
 * @returns {boolean}
 */
export function eventMatchesFlow(event, flow) {
  return Boolean(flow?.calendarIds?.includes(event?.calendarId) ||
    flow?.serviceIds?.includes(event?.context?.serviceId) ||
    flow?.workflowDocument?.exits?.some((exit) => exit.effect === "exit_contact_pending"
      && exit.event === event?.type
      && exit.serviceIds?.includes(event?.context?.serviceId)));
}

export function isEligible(event, flow) {
  if (!event || event.recognized !== true) return false;
  if (!eventMatchesFlow(event, flow)) return false;
  if (!flow.enrollOn.statuses.includes(event.type)) return false;
  // GHL's “Event Type = Normal” is independent of status. If an owned
  // workflow declares it, absence is a fail-closed mismatch rather than an
  // invitation to enroll recurring/custom events by accident.
  if (flow.enrollOn.eventTypes && !flow.enrollOn.eventTypes.includes(event.appointmentEventType)) return false;
  const overrides = flow.enrollOn.modifiedByByCalendar;
  const mb = overrides && Object.hasOwn(overrides, event.calendarId)
    ? overrides[event.calendarId]
    : flow.enrollOn.modifiedBy;
  if (mb && !mb.includes(event.modifiedBy)) return false;
  return true;
}

function conditionMatches(condition, context) {
  if (!condition) return true;
  const value = String(context?.[condition.field] ?? "");
  return Array.isArray(condition.oneOf) ? condition.oneOf.includes(value) : value === condition.equals;
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

  const steps = flow.steps.filter((s) => conditionMatches(s.when, event.context)).map((s, stepIndex) => {
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

/**
 * Reconstruct a reminder enrollment for a confirmed appointment that was already waiting in
 * GHL when a cutover became live. Booking-time steps are always skipped: they belong to the
 * former sender and must never be replayed. Timed steps retain the ordinary past-time guard.
 */
export function backfillEnrollment(event, flow, nowMs) {
  const enrollment = enroll(event, flow, nowMs);
  if (!enrollment) return null;
  return {
    ...enrollment,
    steps: enrollment.steps.map((step) => (
      step.at === "enroll" ? { ...step, status: "skipped" } : step
    )),
  };
}
