// Nurture engine — event taxonomy. The engine consumes four event sources; this module
// normalizes them to one shape and provides the single matcher that entry and exit specs
// run through. Pure, never mutates input.
//
// Normalized event shapes:
//   { kind: "appointment", type, calendarId, contactId, appointmentId, modifiedBy }
//       — wrapped from the substrate's normalizeAppointmentEvent output (dispatch seam)
//   { kind: "quiz.submitted", contactId }                — emitter: functions/api/send-to-ghl.js
//   { kind: "purchase", contactId, productId }           — emitter: ghl-purchase-webhook.js path
//   { kind: "tag.added", contactId, tag }                — emitters: the GHL→code transition
//       bridge, and the engine's own onEnter tags (Flow 3 enrolling exits Flows 1+2)
//
// Spec shapes (used in a sequence's entry.on and exits[]):
//   { kind: "quiz.submitted" }
//   { kind: "appointment", statuses: [...], calendarIds: [...], modifiedBy?: [...] }
//   { kind: "purchase", productIds: [...] }
//   { kind: "tag.added", tags: [...] }

const KINDED = {
  "quiz.submitted": (raw) => ({ kind: "quiz.submitted", contactId: raw.contactId }),
  purchase: (raw) => ({ kind: "purchase", contactId: raw.contactId, productId: raw.productId }),
  "tag.added": (raw) => ({ kind: "tag.added", contactId: raw.contactId, tag: raw.tag }),
};

/**
 * Normalize a raw inbound event to the nurture-event shape, or null if it isn't one.
 * Accepts substrate appointment events (recognized === true) and already-kinded events.
 */
export function toNurtureEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (raw.kind) {
    const build = KINDED[raw.kind];
    if (!build || !raw.contactId) return null;
    return build(raw);
  }

  // Substrate appointment event (normalizeAppointmentEvent output).
  if (raw.recognized === true && raw.contactId) {
    return {
      kind: "appointment",
      type: raw.type,
      calendarId: raw.calendarId,
      contactId: raw.contactId,
      appointmentId: raw.appointmentId,
      modifiedBy: raw.modifiedBy ?? null,
    };
  }
  return null;
}

/**
 * Does this normalized event satisfy this entry/exit spec?
 */
export function eventMatches(spec, event) {
  if (!spec || !event || spec.kind !== event.kind) return false;
  switch (spec.kind) {
    case "quiz.submitted":
      return true;
    case "appointment":
      if (!spec.statuses.includes(event.type)) return false;
      if (!spec.calendarIds.includes(event.calendarId)) return false;
      if (spec.modifiedBy && !spec.modifiedBy.includes(event.modifiedBy)) return false;
      return true;
    case "purchase":
      return spec.productIds.includes(event.productId);
    case "tag.added":
      return spec.tags.includes(event.tag);
    default:
      return false;
  }
}
