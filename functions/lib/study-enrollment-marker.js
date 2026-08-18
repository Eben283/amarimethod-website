// A persistent post-confirm marker lets the published welcome workflow
// distinguish an already-booked native participant from an unbooked legacy
// signup. Participant trigger tags remain strictly after this readback.

import { applyTagDelta, ghlFetch } from "./ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

export const STUDY_BOOKING_CONFIRMED_MARKER =
  "study-booking-confirmed-before-enrollment";

function tagName(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.name || value.label || value.value || "").trim();
}

export function contactHasStudyBookingConfirmedMarker(payload) {
  const contact = payload?.contact || payload;
  const tags = Array.isArray(contact?.tags) ? contact.tags : [];
  return tags.map(tagName).includes(STUDY_BOOKING_CONFIRMED_MARKER);
}

export async function ensureStudyBookingConfirmedMarker(context, contactId) {
  await applyTagDelta(context, contactId, {
    add: [STUDY_BOOKING_CONFIRMED_MARKER],
  });

  const response = await ghlFetch(
    context,
    GHL_API_BASE + "/contacts/" + encodeURIComponent(contactId),
  );
  if (!response.ok) {
    throw new Error(
      "study booking marker readback failed (" + response.status + ")",
    );
  }
  const payload = await response.json();
  if (!contactHasStudyBookingConfirmedMarker(payload)) {
    throw new Error("study booking marker was not present in provider readback");
  }
  return { tag: STUDY_BOOKING_CONFIRMED_MARKER, verified: true };
}
