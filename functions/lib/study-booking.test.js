import { describe, expect, it } from "vitest";
import {
  LIVE_STUDY_BOOKINGS,
  getLiveStudyBooking,
  studyEnrollmentTags,
  studyOperationKind,
  validateStudyBooking,
} from "./study-booking.js";

const expected = {
  "tennis-elbow": {
    studyName: "Elbow Pain Study",
    source: "Tennis Elbow Study",
    participantTag: "elbow-study-participant",
    bodyTagPrefix: "elbow-study-arm",
    bodyPrompt: "Which arm?",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
    ],
  },
  tmj: {
    studyName: "Jaw Tension Study",
    source: "Jaw Tension Study",
    participantTag: "tmj-study-participant",
    bodyTagPrefix: "tmj",
    bodyPrompt: "Which side?",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
    ],
  },
  hand: {
    studyName: "Hand Pain Study",
    source: "Hand Pain Study",
    participantTag: "hand-study-participant",
    bodyTagPrefix: "hand",
    bodyPrompt: "Which hand?",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "activity-pattern", text: "It flares mid-session or with gripping, not a fresh sprain." },
      { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
    ],
  },
  "runners-lower-leg": {
    studyName: "Foot Pain Study",
    source: "Foot Pain Study",
    participantTag: "lowerleg-study-participant",
    bodyTagPrefix: "runners-lower-leg",
    bodyPrompt: "Which foot?",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
    ],
  },
  "desk-shoulders": {
    studyName: "Desk Shoulders Study",
    source: "Desk Shoulders Study",
    participantTag: "shoulder-study-participant",
    bodyTagPrefix: "desk-shoulders",
    bodyPrompt: "Which shoulder?",
    qualifications: [
      { id: "pain-duration", text: "I've had this pain for more than two weeks." },
      { id: "activity-pattern", text: "It flares after a day at the screen, not a fresh injury." },
      { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
    ],
  },
};

function validBody(study = "tennis-elbow") {
  const config = LIVE_STUDY_BOOKINGS[study];
  return {
    study,
    name: "Study Person",
    phone: "(415) 555-0100",
    email: "study@example.com",
    startTime: "2026-08-28T10:00:00-07:00",
    timezone: "America/Los_Angeles",
    idempotencyKey: "72e07b3a-31b4-4d9f-a805-6827306d506d",
    bodyPart: "left",
    publishOptIn: false,
    qualifications: Object.fromEntries(config.qualifications.map((item) => [item.id, true])),
  };
}

describe("live study booking registry", () => {
  it("maps exactly the five live studies to their source, Study Name, and trigger-safe tags", () => {
    expect(Object.keys(LIVE_STUDY_BOOKINGS)).toEqual(Object.keys(expected));
    for (const [slug, mapping] of Object.entries(expected)) {
      const config = getLiveStudyBooking(slug);
      expect(config).toMatchObject({ slug, ...mapping });
      expect(config.qualifications).toEqual(mapping.qualifications);
    }
  });

  it("rejects draft and unknown registry slugs", () => {
    expect(getLiveStudyBooking("carpal-tunnel")).toBeNull();
    expect(getLiveStudyBooking("tech-neck")).toBeNull();
    expect(getLiveStudyBooking("lower-back")).toBeNull();
    expect(getLiveStudyBooking("unknown")).toBeNull();
  });

  it("builds participant, exact side, and optional publication tags additively", () => {
    for (const [slug, mapping] of Object.entries(expected)) {
      const config = getLiveStudyBooking(slug);
      expect(studyEnrollmentTags(config, "both", false)).toEqual([
        mapping.participantTag,
        mapping.bodyTagPrefix + "-both",
      ]);
      expect(studyEnrollmentTags(config, "", true)).toEqual([
        mapping.participantTag,
        "study-publish-opt-in",
      ]);
    }
  });

  it("fingerprints study, side, and publication semantics into durable operation identity", () => {
    const config = getLiveStudyBooking("tmj");
    expect(studyOperationKind(config, "left", false)).toBe("study_booking:tmj:left:private");
    expect(studyOperationKind(config, "right", false)).not.toBe(studyOperationKind(config, "left", false));
    expect(studyOperationKind(config, "left", true)).not.toBe(studyOperationKind(config, "left", false));
    expect(studyOperationKind(getLiveStudyBooking("hand"), "left", false))
      .not.toBe(studyOperationKind(config, "left", false));
  });
});

describe("study booking validation", () => {
  it("accepts every live study only after every page-specific qualification is affirmative", () => {
    for (const slug of Object.keys(expected)) {
      const result = validateStudyBooking(validBody(slug));
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        config: { slug },
        email: "study@example.com",
        phone: "4155550100",
        bodyPart: "left",
        publishOptIn: false,
      });
    }
  });

  it("rejects missing qualification, invalid side, invalid contact data, and weak idempotency keys", () => {
    const missing = validBody("hand");
    missing.qualifications["activity-pattern"] = false;
    expect(validateStudyBooking(missing).error).toMatch(/every study qualification/i);
    expect(validateStudyBooking({ ...validBody(), bodyPart: "middle" }).error).toMatch(/left, right, both/i);
    expect(validateStudyBooking({ ...validBody(), email: "not-an-email" }).error).toMatch(/valid email/i);
    expect(validateStudyBooking({ ...validBody(), phone: "555" }).error).toMatch(/mobile/i);
    expect(validateStudyBooking({ ...validBody(), idempotencyKey: "short" }).error).toMatch(/refresh/i);
  });

  it("never promotes truthy strings into qualification or publication consent", () => {
    const body = validBody();
    body.qualifications["pain-duration"] = "true";
    body.publishOptIn = "true";
    expect(validateStudyBooking(body).error).toMatch(/every study qualification/i);
    body.qualifications["pain-duration"] = true;
    expect(validateStudyBooking(body).data.publishOptIn).toBe(false);
  });
});
