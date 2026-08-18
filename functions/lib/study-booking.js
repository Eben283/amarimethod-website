import { STUDIES } from "./studies.js";
import { STUDY_PUBLISH_OPT_IN_TAG, wantsPublishOptIn } from "./study-consent.js";

export const STUDY_NAME_FIELD_ID = "1xhxStKyEN47shwjOKC0";
export const STUDY_BOOKING_KIND = "study_booking";

const VISIT_QUALIFICATION = Object.freeze({
  id: "three-visits",
  text: "I can come to our San Francisco office at 662 8th Ave for three visits.",
});

function study(slug, definition) {
  const registry = STUDIES[slug];
  if (!registry) throw new Error("study registry entry missing: " + slug);
  return Object.freeze({
    slug,
    ...definition,
    studyName: registry.shortName,
    participantTag: registry.tag,
    bodyPrompt: registry.bodyQuestion?.label || "",
    qualifications: Object.freeze(definition.qualifications.map((item) => Object.freeze(item))),
  });
}

export const LIVE_STUDY_BOOKINGS = Object.freeze({
  "tennis-elbow": study("tennis-elbow", {
    source: "Tennis Elbow Study",
    bodyTagPrefix: "elbow-study-arm",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      VISIT_QUALIFICATION,
    ],
  }),
  tmj: study("tmj", {
    source: "Jaw Tension Study",
    bodyTagPrefix: "tmj",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      VISIT_QUALIFICATION,
    ],
  }),
  hand: study("hand", {
    source: "Hand Pain Study",
    bodyTagPrefix: "hand",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "activity-pattern", text: "It flares mid-session or with gripping, not a fresh sprain." },
      VISIT_QUALIFICATION,
    ],
  }),
  "runners-lower-leg": study("runners-lower-leg", {
    source: "Foot Pain Study",
    bodyTagPrefix: "runners-lower-leg",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      VISIT_QUALIFICATION,
    ],
  }),
  "desk-shoulders": study("desk-shoulders", {
    source: "Desk Shoulders Study",
    bodyTagPrefix: "desk-shoulders",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "activity-pattern", text: "It flares after a day at the screen, not a fresh injury." },
      VISIT_QUALIFICATION,
    ],
  }),
});

export function getLiveStudyBooking(slug) {
  const value = typeof slug === "string" ? slug.trim() : "";
  const config = LIVE_STUDY_BOOKINGS[value] || null;
  const registry = STUDIES[value] || null;
  if (!config || registry?.status !== "live" || registry.tag !== config.participantTag) return null;
  return config;
}

export function studyOperationKind(config, bodyPart, publishOptIn) {
  return [
    STUDY_BOOKING_KIND,
    config.slug,
    bodyPart || "none",
    publishOptIn ? "publish" : "private",
  ].join(":");
}

export function studyEnrollmentTags(config, bodyPart, publishOptIn) {
  const tags = [config.participantTag];
  if (bodyPart) tags.push(config.bodyTagPrefix + "-" + bodyPart);
  if (publishOptIn) tags.push(STUDY_PUBLISH_OPT_IN_TAG);
  return tags;
}

function invalid(error) {
  return { error, data: null };
}

export function validateStudyBooking(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("Invalid booking request.");

  const config = getLiveStudyBooking(input.study);
  if (!config) return invalid("Choose one of the five current studies.");

  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const phone = typeof input.phone === "string" ? input.phone.replace(/[^\d+]/g, "").slice(0, 20) : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 254) : "";
  const startTime = typeof input.startTime === "string" ? input.startTime.trim() : "";
  const timezone = typeof input.timezone === "string" && input.timezone.trim()
    ? input.timezone.trim().slice(0, 100)
    : "America/Los_Angeles";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const bodyPart = typeof input.bodyPart === "string" ? input.bodyPart.trim().toLowerCase() : "";
  const publishOptIn = wantsPublishOptIn(input.publishOptIn);

  if (!name || name.length > 200) return invalid("Enter your name.");
  if (phone.replace(/\D/g, "").length < 10) return invalid("Enter a valid mobile number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid("Enter a valid email.");
  if (!startTime || Number.isNaN(Date.parse(startTime))) return invalid("Choose an available time.");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) return invalid("Refresh the page and choose your time again.");
  if (bodyPart && !["left", "right", "both"].includes(bodyPart)) return invalid("Choose left, right, both, or leave the side blank.");

  const qualifications = input.qualifications;
  if (!qualifications || typeof qualifications !== "object" || Array.isArray(qualifications)) {
    return invalid("Confirm every study qualification.");
  }
  if (!config.qualifications.every((item) => qualifications[item.id] === true)) {
    return invalid("Confirm every study qualification.");
  }

  const nameParts = name.split(" ");
  const firstName = nameParts.shift() || "";
  const lastName = nameParts.join(" ");

  return {
    error: null,
    data: {
      config,
      name,
      firstName: firstName.slice(0, 100),
      lastName: lastName.slice(0, 100),
      phone,
      email,
      startTime,
      timezone,
      idempotencyKey,
      bodyPart,
      publishOptIn,
      qualifications: Object.fromEntries(config.qualifications.map((item) => [item.id, true])),
    },
  };
}
