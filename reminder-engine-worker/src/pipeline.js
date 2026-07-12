// Pipeline helper — the "move the opportunity to stage X on booking/attendance" workflows, as
// code. A stateless consumer of appointment events (no timers, no enrollment): each event resolves
// to zero or more opportunity moves. Shadow-safe like the reminder engine — a move defaults to
// shadow (logged as would_move, no GHL write) until the rule is switched to active.
//
// Absorbs: Discovery Booked/Attended, Initial In-Person/Virtual, Follow-up pipeline updates.
// NOT here: New Lead Acquisition (form_submitted, not an appointment event — belongs to the form
// endpoint). Fold-in: finding #6 — a cancelled/no-show discovery marks the opportunity Lost, which
// the GHL workflows never did.
//
// Grounded in the twin specs' pipeline dependencies. stageId is the one gap (docs give stage NAMES;
// the GHL stage UUIDs must be captured before active mode moves anything) — resolve at the same
// time as gx02.

const LEAD_TO_CLIENT = { pipeline: "Lead to Client Pipeline", pipelineId: "jVmRNryhwJBVYcgO4h4a" };
const SINGLE_SESSION = { pipeline: "Single Session Pipeline", pipelineId: "VrqxizLOJ8UHYrc3g842" };

const DISCOVERY = "USgPsktqRcuomdUgpShL";              // Your Free Discovery Call
const INITIAL_IN_PERSON = "G7OAnnJuFbMF6nQSlZVQ";
const INITIAL_VIRTUAL = "ySmht5hx4uZGEpgZrlCw";
const FOLLOWUP_VIRTUAL_PKG = "bJFkhVP35Ecwh4tLnSmy";
const FOLLOWUP_IN_PERSON_PKG = "ZO1jlGfy01rsxVqicoSB";

export const PIPELINE_RULES = Object.freeze([
  { calendarIds: [DISCOVERY], onStatuses: ["booked"], ...LEAD_TO_CLIENT, stage: "Booked 15-min Consultation", stageId: null, mode: "shadow" },
  { calendarIds: [DISCOVERY], onStatuses: ["showed"], ...LEAD_TO_CLIENT, stage: "Consultation Attended", stageId: null, mode: "shadow" },
  { calendarIds: [DISCOVERY], onStatuses: ["cancelled", "noshow"], ...LEAD_TO_CLIENT, stage: "Lost", stageId: null, markLost: true, mode: "shadow" },
  { calendarIds: [INITIAL_IN_PERSON, INITIAL_VIRTUAL], onStatuses: ["booked", "confirmed"], ...SINGLE_SESSION, stage: "Session Scheduled", stageId: null, mode: "shadow" },
  { calendarIds: [FOLLOWUP_VIRTUAL_PKG, FOLLOWUP_IN_PERSON_PKG], onStatuses: ["booked", "confirmed"], ...SINGLE_SESSION, stage: "Session Scheduled", stageId: null, mode: "shadow" },
].map(Object.freeze));

/**
 * Resolve the opportunity move(s) an appointment event triggers. Pure; returns [] when none match.
 * @returns {Array<{pipeline, pipelineId, stage, stageId, mode, markLost}>}
 */
export function resolvePipelineMoves(event) {
  if (!event || event.recognized !== true) return [];
  return PIPELINE_RULES.filter(
    (r) => r.calendarIds.includes(event.calendarId) && r.onStatuses.includes(event.type),
  ).map((r) => ({
    pipeline: r.pipeline,
    pipelineId: r.pipelineId,
    stage: r.stage,
    stageId: r.stageId,
    mode: r.mode,
    markLost: r.markLost || false,
  }));
}
