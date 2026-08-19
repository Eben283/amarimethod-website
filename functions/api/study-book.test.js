import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ghl.js", () => ({
  ghlFetch: vi.fn(),
  applyTagDelta: vi.fn(),
}));

vi.mock("../lib/study-enrollment-marker.js", () => ({
  ensureStudyBookingConfirmedMarker: vi.fn(),
}));

vi.mock("../lib/app-owned-buffer.js", () => ({
  assertSlotRespectsAppBuffer: vi.fn(),
  fetchAppBufferEvents: vi.fn(async () => []),
  filterSlotsByAppBuffer: vi.fn((slots) => slots),
}));

vi.mock("../lib/ghl-appointment-handoff.js", () => {
  class AppointmentHandoffError extends Error {
    constructor(phase, status, detail, appointmentId = null, cleanupStatus = null) {
      super("GHL appointment " + phase + " failed (" + status + "): " + detail);
      this.name = "AppointmentHandoffError";
      this.phase = phase;
      this.status = status;
      this.detail = detail;
      this.appointmentId = appointmentId;
      this.cleanupStatus = cleanupStatus;
    }
  }
  return {
    AppointmentHandoffError,
    createConfirmedAppointment: vi.fn(),
  };
});

vi.mock("../lib/booking-operations.js", () => ({
  claimBookingOperation: vi.fn(),
  checkpointBookingAppointment: vi.fn(async () => ({ ok: true })),
  checkpointBookingCreateAttempt: vi.fn(async (_db, _opKey, details) => ({
    ok: true,
    createAttempt: {
      at: 1,
      kind: details.kind,
      contactId: details.contactId,
      calendarId: details.calendarId,
      startTime: details.startTime,
    },
  })),
  clearBookingAppointmentCheckpoint: vi.fn(async () => ({ ok: true })),
  completeBookingOperation: vi.fn(async () => ({ ok: true })),
  failBookingOperation: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../lib/ops-path-emit.js", () => ({
  emitPathHop: vi.fn(async () => ({ id: "event-1" })),
}));

import { applyTagDelta, ghlFetch } from "../lib/ghl.js";
import { ensureStudyBookingConfirmedMarker } from "../lib/study-enrollment-marker.js";
import { assertSlotRespectsAppBuffer } from "../lib/app-owned-buffer.js";
import {
  AppointmentHandoffError,
  createConfirmedAppointment,
} from "../lib/ghl-appointment-handoff.js";
import {
  claimBookingOperation,
  checkpointBookingAppointment,
  checkpointBookingCreateAttempt,
  clearBookingAppointmentCheckpoint,
  completeBookingOperation,
  failBookingOperation,
} from "../lib/booking-operations.js";
import { onRequestPost } from "./study-book-v2.js";

const jsonResponse = (body = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const validBody = {
  study: "tennis-elbow",
  name: "Study Person",
  phone: "(415) 555-0100",
  email: "study@example.com",
  bodyPart: "left",
  qualifications: {
    "pain-duration": true,
    "three-visits": true,
  },
  publishOptIn: true,
  startTime: "2026-08-28T10:00:00-07:00",
  timezone: "America/Los_Angeles",
  idempotencyKey: "72e07b3a-31b4-4d9f-a805-6827306d506d",
};

function context(body = validBody, options = {}) {
  const origin = options.origin === undefined
    ? "https://www.amarimethod.com"
    : options.origin;
  const requestUrl = options.requestUrl || "https://www.amarimethod.com/api/study-book-v2";
  const env = options.attendDb === false ? {} : { ATTEND_DB: { name: "test-db" } };
  Object.assign(env, options.env || {});
  return {
    request: new Request(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "CF-Connecting-IP": "192.0.2.1",
      },
      body: JSON.stringify(body),
    }),
    env,
    waitUntil: vi.fn(),
  };
}

function operation(input, appointmentId = null) {
  return { ...input, appointmentId, status: "processing" };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertSlotRespectsAppBuffer.mockResolvedValue(undefined);
  applyTagDelta.mockResolvedValue({ added: [], removed: [] });
  ensureStudyBookingConfirmedMarker.mockResolvedValue({
    tag: "study-booking-confirmed-before-enrollment",
    verified: true,
  });
  checkpointBookingAppointment.mockResolvedValue({ ok: true });
  checkpointBookingCreateAttempt.mockImplementation(async (_db, _opKey, details) => ({
    ok: true,
    createAttempt: {
      at: 1,
      kind: details.kind,
      contactId: details.contactId,
      calendarId: details.calendarId,
      startTime: details.startTime,
    },
  }));
  clearBookingAppointmentCheckpoint.mockResolvedValue({ ok: true });
  completeBookingOperation.mockResolvedValue({ ok: true });
  failBookingOperation.mockResolvedValue({ ok: true });
});

describe("POST /api/study-book-v2", () => {
  it("rejects an untrusted Origin and missing ATTEND_DB before any GHL call", async () => {
    const crossOrigin = await onRequestPost(context(validBody, { origin: "https://evil.example" }));
    expect(crossOrigin.status).toBe(403);
    const missingDb = await onRequestPost(context(validBody, { attendDb: false }));
    expect(missingDb.status).toBe(500);
    expect(ghlFetch).not.toHaveBeenCalled();
    expect(claimBookingOperation).not.toHaveBeenCalled();
  });

  it("rejects invalid or draft studies and incomplete eligibility before any GHL or D1 call", async () => {
    const invalidStudy = await onRequestPost(context({ ...validBody, study: "carpal-tunnel" }));
    expect(invalidStudy.status).toBe(400);

    const incomplete = await onRequestPost(context({
      ...validBody,
      qualifications: { "pain-duration": true, "three-visits": false },
    }));
    expect(incomplete.status).toBe(400);
    expect(ghlFetch).not.toHaveBeenCalled();
    expect(claimBookingOperation).not.toHaveBeenCalled();
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
  });

  it("orders buffer, identity plus Study Name, claim, create, checkpoint, confirm, tags, and completion", async () => {
    const order = [];
    let identityPayload = null;

    ghlFetch.mockImplementation(async (_context, url, options = {}) => {
      if (url.includes("/contacts/search/duplicate")) return jsonResponse({});
      if (url.endsWith("/contacts/search")) return jsonResponse({ contacts: [] });
      if (url.endsWith("/contacts/upsert")) {
        order.push("identity");
        identityPayload = JSON.parse(options.body);
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        order.push("reconcile");
        return jsonResponse({ events: [] });
      }
      throw new Error("Unexpected GHL request: " + url);
    });
    assertSlotRespectsAppBuffer.mockImplementation(async () => {
      order.push("buffer");
    });
    claimBookingOperation.mockImplementation(async (_db, input) => {
      order.push("claim");
      return { state: "acquired", operation: operation(input) };
    });
    checkpointBookingAppointment.mockImplementation(async () => {
      order.push("checkpoint");
      return { ok: true };
    });
    checkpointBookingCreateAttempt.mockImplementation(async (_db, _opKey, details) => {
      order.push("create-marker");
      return {
        ok: true,
        createAttempt: {
          at: 1,
          kind: details.kind,
          contactId: details.contactId,
          calendarId: details.calendarId,
          startTime: details.startTime,
        },
      };
    });
    createConfirmedAppointment.mockImplementation(async ({ onCreated }) => {
      order.push("create:new");
      await onCreated("appointment-1");
      order.push("confirm");
      return { id: "appointment-1", appointmentStatus: "confirmed" };
    });
    ensureStudyBookingConfirmedMarker.mockImplementation(async () => {
      order.push("marker");
      return { tag: "study-booking-confirmed-before-enrollment", verified: true };
    });
    applyTagDelta.mockImplementation(async () => {
      order.push("tags");
      return { added: [] };
    });
    completeBookingOperation.mockImplementation(async () => {
      order.push("complete");
      return { ok: true };
    });

    const response = await onRequestPost(context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      study: { slug: "tennis-elbow", name: "Elbow Pain Study" },
      appointment: { id: "appointment-1", startTime: validBody.startTime },
    });
    expect(order).toEqual([
      "buffer",
      "identity",
      "claim",
      "reconcile",
      "create-marker",
      "create:new",
      "checkpoint",
      "confirm",
      "marker",
      "tags",
      "complete",
    ]);
    expect(identityPayload).toMatchObject({
      firstName: "Study",
      lastName: "Person",
      source: "Tennis Elbow Study",
      locationId: "7pIO7FHVAyBT1jKGhfQM",
      customFields: [{ id: "1xhxStKyEN47shwjOKC0", fieldValue: "Elbow Pain Study" }],
    });
    expect(identityPayload.tags).toBeUndefined();
    expect(ensureStudyBookingConfirmedMarker).toHaveBeenCalledWith(
      expect.anything(),
      "contact-1",
    );
    expect(ensureStudyBookingConfirmedMarker.mock.invocationCallOrder[0])
      .toBeLessThan(applyTagDelta.mock.invocationCallOrder[0]);
    expect(claimBookingOperation.mock.calls[0][1].kind)
      .toBe("study_booking:tennis-elbow:left:publish");
    expect(applyTagDelta).toHaveBeenCalledWith(
      expect.anything(),
      "contact-1",
      { add: ["elbow-study-participant", "elbow-study-arm-left", "study-publish-opt-in"] },
    );
  });

  it("returns a completed durable result without buffer, contact mutation, appointment, or tags", async () => {
    ghlFetch.mockResolvedValueOnce(jsonResponse({ contact: { id: "contact-1" } }));
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "completed",
      operation: {
        ...operation(input),
        status: "completed",
        result: {
          success: true,
          study: { slug: "tennis-elbow", name: "Elbow Pain Study" },
          appointment: { id: "appointment-1", startTime: validBody.startTime },
        },
      },
    }));

    const response = await onRequestPost(context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alreadyProcessed).toBe(true);
    expect(assertSlotRespectsAppBuffer).not.toHaveBeenCalled();
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(applyTagDelta).not.toHaveBeenCalled();
  });

  it("keeps a confirmed appointment when marker readback fails and never applies participant tags", async () => {
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) return jsonResponse({});
      if (url.endsWith("/contacts/search")) return jsonResponse({ contacts: [] });
      if (url.endsWith("/contacts/upsert")) return jsonResponse({ contact: { id: "contact-1" } });
      if (url.endsWith("/contacts/contact-1/appointments")) return jsonResponse({ events: [] });
      throw new Error("Unexpected marker test GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));
    createConfirmedAppointment.mockImplementation(async ({ onCreated }) => {
      await onCreated("appointment-1");
      return { id: "appointment-1", appointmentStatus: "confirmed" };
    });
    ensureStudyBookingConfirmedMarker.mockRejectedValueOnce(
      new Error("study booking marker was not present in provider readback"),
    );

    const response = await onRequestPost(context());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      booked: true,
      retrySameKey: true,
      doNotRebook: true,
      reservationPending: true,
    });
    expect(applyTagDelta).not.toHaveBeenCalled();
    expect(completeBookingOperation).not.toHaveBeenCalled();
    expect(failBookingOperation).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      expect.stringContaining("marker was not present"),
      { manualReview: false },
    );
  });

  it("uses only the exact isolated preview fixture and state bindings", async () => {
    const preview = "https://codex-study-single-entry-boo.amarimethod-website.pages.dev";
    const previewDb = { name: "proof-db" };
    const rateKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const env = {
      STUDY_BOOKING_PREVIEW_ORIGIN: preview,
      STUDY_PREVIEW_ATTEND_DB: previewDb,
      STUDY_PREVIEW_RATE_LIMIT_KV: rateKv,
      STUDY_PREVIEW_EVIDENCE_KV: { name: "proof-evidence" },
      GHL_API_KEY: "proof-only-key",
      STUDY_PREVIEW_FIXTURE_CONTACT_ID: "fixture-contact",
      PORTAL_KV: { name: "production-oauth" },
      GHL_CLIENT_ID: "production-client",
      GHL_CLIENT_SECRET: "production-secret",
    };
    ghlFetch.mockResolvedValueOnce(jsonResponse({ contact: { id: "fixture-contact" } }));
    claimBookingOperation.mockImplementation(async (db, input) => {
      expect(db).toBe(previewDb);
      return {
        state: "completed",
        operation: {
          ...operation(input),
          status: "completed",
          result: {
            success: true,
            study: { slug: "tennis-elbow", name: "Elbow Pain Study" },
            appointment: { id: "appointment-1", startTime: validBody.startTime },
          },
        },
      };
    });

    const response = await onRequestPost(context(validBody, {
      origin: preview,
      requestUrl: preview + "/api/study-book-v2",
      env,
    }));

    expect(response.status).toBe(200);
    expect(ghlFetch.mock.calls[0][0].env).toEqual({ GHL_API_KEY: "proof-only-key" });
    expect(rateKv.put).toHaveBeenCalledTimes(1);
    expect(claimBookingOperation).toHaveBeenCalledWith(previewDb, expect.anything());
  });

  it("rejects a non-fixture preview contact before D1 claim or provider mutation", async () => {
    const preview = "https://codex-study-single-entry-boo.amarimethod-website.pages.dev";
    const env = {
      STUDY_BOOKING_PREVIEW_ORIGIN: preview,
      STUDY_PREVIEW_ATTEND_DB: { name: "proof-db" },
      STUDY_PREVIEW_RATE_LIMIT_KV: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      },
      STUDY_PREVIEW_EVIDENCE_KV: { name: "proof-evidence" },
      GHL_API_KEY: "proof-only-key",
      STUDY_PREVIEW_FIXTURE_CONTACT_ID: "fixture-contact",
    };
    ghlFetch.mockResolvedValueOnce(jsonResponse({ contact: { id: "another-contact" } }));

    const response = await onRequestPost(context(validBody, {
      origin: preview,
      requestUrl: preview + "/api/study-book-v2",
      env,
    }));

    expect(response.status).toBe(403);
    expect(claimBookingOperation).not.toHaveBeenCalled();
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(applyTagDelta).not.toHaveBeenCalled();
    expect(ghlFetch.mock.calls.some(([, , options]) =>
      ["PUT", "PATCH", "DELETE"].includes(options?.method))).toBe(false);
  });

  it("keeps a confirmed appointment checkpoint when tags fail, then resumes tags without a duplicate create", async () => {
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) return jsonResponse({});
      if (url.endsWith("/contacts/search")) return jsonResponse({ contacts: [] });
      if (url.endsWith("/contacts/upsert")) return jsonResponse({ contact: { id: "contact-1" } });
      if (url.endsWith("/contacts/contact-1/appointments")) return jsonResponse({ events: [] });
      throw new Error("Unexpected first-attempt GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));
    createConfirmedAppointment.mockImplementation(async ({ onCreated }) => {
      await onCreated("appointment-1");
      return { id: "appointment-1", appointmentStatus: "confirmed" };
    });
    applyTagDelta.mockRejectedValueOnce(new Error("tag provider unavailable"));

    const first = await onRequestPost(context());
    const firstBody = await first.json();
    expect(first.status).toBe(422);
    expect(firstBody).toMatchObject({ booked: true, retrySameKey: true });
    expect(clearBookingAppointmentCheckpoint).not.toHaveBeenCalled();
    expect(failBookingOperation).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      expect.stringContaining("tag provider unavailable"),
      { manualReview: false },
    );

    vi.clearAllMocks();
    ensureStudyBookingConfirmedMarker.mockResolvedValue({
      tag: "study-booking-confirmed-before-enrollment",
      verified: true,
    });
    applyTagDelta.mockResolvedValue({ added: [] });
    completeBookingOperation.mockResolvedValue({ ok: true });
    failBookingOperation.mockResolvedValue({ ok: true });
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) {
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        return jsonResponse({
          events: [{
            id: "appointment-1",
            calendarId: "J1N09B6bRYPOGNyVAfmX",
            startTime: validBody.startTime,
            appointmentStatus: "confirmed",
          }],
        });
      }
      if (url.endsWith("/contacts/contact-1")) return jsonResponse({ success: true });
      throw new Error("Unexpected retry GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input, "appointment-1"),
    }));

    const retry = await onRequestPost(context());
    expect(retry.status).toBe(200);
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(assertSlotRespectsAppBuffer).not.toHaveBeenCalled();
    expect(applyTagDelta).toHaveBeenCalledTimes(1);
    expect(completeBookingOperation).toHaveBeenCalledTimes(1);
  });

  it("adopts an exact appointment only for the same durably marked operation", async () => {
    let listCount = 0;
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) {
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        listCount += 1;
        return jsonResponse({
          events: [{
            id: "appointment-existing",
            calendarId: "J1N09B6bRYPOGNyVAfmX",
            startTime: validBody.startTime,
            appointmentStatus: "confirmed",
          }],
        });
      }
      if (url.endsWith("/contacts/contact-1")) return jsonResponse({ success: true });
      throw new Error("Unexpected adoption GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: {
        ...operation(input),
        attempts: 2,
        result: {
          createAttempt: {
            at: 1,
            kind: input.kind,
            contactId: input.contactId,
            calendarId: input.calendarId,
            startTime: input.startTime,
          },
        },
      },
    }));

    const adopted = await onRequestPost(context());
    expect(adopted.status).toBe(200);
    expect(listCount).toBe(2);
    expect(checkpointBookingAppointment).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      "appointment-existing",
    );
    expect(checkpointBookingCreateAttempt).not.toHaveBeenCalled();
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(assertSlotRespectsAppBuffer).not.toHaveBeenCalled();
  });

  it("sends a fresh semantic key with an unexplained exact appointment to manual review without identity or tag mutation", async () => {
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) {
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        return jsonResponse({
          events: [{
            id: "appointment-existing",
            calendarId: "J1N09B6bRYPOGNyVAfmX",
            startTime: validBody.startTime,
            appointmentStatus: "confirmed",
          }],
        });
      }
      throw new Error("Unexpected fresh-key GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));

    const response = await onRequestPost(context({ ...validBody, bodyPart: "right" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ manualReview: true, doNotRebook: true });
    expect(claimBookingOperation.mock.calls[0][1].kind)
      .toBe("study_booking:tennis-elbow:right:publish");
    expect(ghlFetch.mock.calls.some(([, , options]) => options?.method === "PUT")).toBe(false);
    expect(checkpointBookingAppointment).not.toHaveBeenCalled();
    expect(checkpointBookingCreateAttempt).not.toHaveBeenCalled();
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(applyTagDelta).not.toHaveBeenCalled();
  });

  it("sends more than one exact active appointment to manual review", async () => {
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) {
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        return jsonResponse({ events: [{
          id: "appointment-1",
          calendarId: "J1N09B6bRYPOGNyVAfmX",
          startTime: validBody.startTime,
          appointmentStatus: "confirmed",
        }, {
          id: "appointment-2",
          calendarId: "J1N09B6bRYPOGNyVAfmX",
          startTime: validBody.startTime,
          appointmentStatus: "new",
        }] });
      }
      throw new Error("Unexpected ambiguity GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));

    const response = await onRequestPost(context());
    expect(response.status).toBe(409);
    expect((await response.json()).manualReview).toBe(true);
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
  });

  it.each([
    ["missing calendar", {
      id: "appointment-1",
      startTime: validBody.startTime,
      appointmentStatus: "confirmed",
    }],
    ["wrong calendar", {
      id: "appointment-1",
      calendarId: "another-calendar",
      startTime: validBody.startTime,
      appointmentStatus: "confirmed",
    }],
    ["missing start", {
      id: "appointment-1",
      calendarId: "J1N09B6bRYPOGNyVAfmX",
      appointmentStatus: "confirmed",
    }],
    ["unparseable start", {
      id: "appointment-1",
      calendarId: "J1N09B6bRYPOGNyVAfmX",
      startTime: "not-a-time",
      appointmentStatus: "confirmed",
    }],
    ["wrong start", {
      id: "appointment-1",
      calendarId: "J1N09B6bRYPOGNyVAfmX",
      startTime: "2026-08-28T10:10:00-07:00",
      appointmentStatus: "confirmed",
    }],
  ])("fails closed when a checkpoint readback has %s", async (_label, providerAppointment) => {
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) {
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        return jsonResponse({ events: [providerAppointment] });
      }
      throw new Error("Unexpected checkpoint GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input, "appointment-1"),
    }));

    const response = await onRequestPost(context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ manualReview: true, doNotRebook: true });
    expect(ghlFetch.mock.calls.some(([, , options]) => options?.method === "PUT")).toBe(false);
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(applyTagDelta).not.toHaveBeenCalled();
  });

  it("locks an ambiguous create transport failure to the same frozen operation", async () => {
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) return jsonResponse({});
      if (url.endsWith("/contacts/search")) return jsonResponse({ contacts: [] });
      if (url.endsWith("/contacts/upsert")) return jsonResponse({ contact: { id: "contact-1" } });
      if (url.endsWith("/contacts/contact-1/appointments")) return jsonResponse({ events: [] });
      throw new Error("Unexpected transport test GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));
    createConfirmedAppointment.mockRejectedValue(new TypeError("network response interrupted"));

    const response = await onRequestPost(context());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      retrySameKey: true,
      doNotRebook: true,
      appointmentUncertain: true,
      reservationPending: true,
    });
    expect(checkpointBookingCreateAttempt).toHaveBeenCalledTimes(1);
    expect(applyTagDelta).not.toHaveBeenCalled();
    expect(failBookingOperation).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      expect.stringContaining("network response interrupted"),
      { manualReview: false },
    );
  });

  it("reports a confirmed checkpoint as reserved when Study Name reassertion fails", async () => {
    ghlFetch.mockImplementation(async (_context, url, options = {}) => {
      if (url.includes("/contacts/search/duplicate")) {
        return jsonResponse({ contact: { id: "contact-1" } });
      }
      if (url.endsWith("/contacts/contact-1/appointments")) {
        return jsonResponse({ events: [{
          id: "appointment-1",
          calendarId: "J1N09B6bRYPOGNyVAfmX",
          startTime: validBody.startTime,
          appointmentStatus: "confirmed",
        }] });
      }
      if (url.endsWith("/contacts/contact-1") && options.method === "PUT") {
        return jsonResponse({ error: "provider unavailable" }, 500);
      }
      throw new Error("Unexpected confirmed retry GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input, "appointment-1"),
    }));

    const response = await onRequestPost(context());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      booked: true,
      retrySameKey: true,
      doNotRebook: true,
      reservationPending: true,
      appointment: { id: "appointment-1", startTime: validBody.startTime },
    });
    expect(createConfirmedAppointment).not.toHaveBeenCalled();
    expect(applyTagDelta).not.toHaveBeenCalled();
  });

  it("clears a checkpoint only after cancellation PUT and cancelled-state readback", async () => {
    let appointmentReads = 0;
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) return jsonResponse({});
      if (url.endsWith("/contacts/search")) return jsonResponse({ contacts: [] });
      if (url.endsWith("/contacts/upsert")) return jsonResponse({ contact: { id: "contact-1" } });
      if (url.endsWith("/contacts/contact-1/appointments")) {
        appointmentReads += 1;
        return appointmentReads === 1
          ? jsonResponse({ events: [] })
          : jsonResponse({ events: [{ id: "appointment-1", appointmentStatus: "cancelled" }] });
      }
      throw new Error("Unexpected GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));
    createConfirmedAppointment.mockImplementation(async ({ onCreated }) => {
      await onCreated("appointment-1");
      throw new AppointmentHandoffError(
        "confirm",
        500,
        "confirm failed",
        "appointment-1",
        200,
      );
    });

    const response = await onRequestPost(context());
    expect(response.status).toBe(422);
    expect(clearBookingAppointmentCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      "appointment-1",
    );
    expect(failBookingOperation).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      expect.stringContaining("cancellation verified"),
      { manualReview: false },
    );
  });

  it("retains a checkpoint when cancellation PUT is 2xx but cancelled-state readback is unverified", async () => {
    let appointmentReads = 0;
    ghlFetch.mockImplementation(async (_context, url) => {
      if (url.includes("/contacts/search/duplicate")) return jsonResponse({});
      if (url.endsWith("/contacts/search")) return jsonResponse({ contacts: [] });
      if (url.endsWith("/contacts/upsert")) return jsonResponse({ contact: { id: "contact-1" } });
      if (url.endsWith("/contacts/contact-1/appointments")) {
        appointmentReads += 1;
        return appointmentReads === 1
          ? jsonResponse({ events: [] })
          : jsonResponse({ events: [{
              id: "appointment-1",
              calendarId: "J1N09B6bRYPOGNyVAfmX",
              startTime: validBody.startTime,
              appointmentStatus: "confirmed",
            }] });
      }
      throw new Error("Unexpected GHL request: " + url);
    });
    claimBookingOperation.mockImplementation(async (_db, input) => ({
      state: "acquired",
      operation: operation(input),
    }));
    createConfirmedAppointment.mockImplementation(async ({ onCreated }) => {
      await onCreated("appointment-1");
      throw new AppointmentHandoffError(
        "confirm",
        500,
        "confirm failed",
        "appointment-1",
        200,
      );
    });

    const response = await onRequestPost(context());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      manualReview: true,
      doNotRebook: true,
      appointmentUncertain: true,
    });
    expect(clearBookingAppointmentCheckpoint).not.toHaveBeenCalled();
    expect(failBookingOperation).toHaveBeenCalledWith(
      expect.anything(),
      "study-book:" + validBody.idempotencyKey,
      expect.stringContaining("cancellation unverified"),
      { manualReview: true },
    );
  });
});
