import { describe, expect, it } from "vitest";
import {
  clearBookingAppointmentCheckpoint,
  checkpointBookingAppointment,
  claimBookingOperation,
  completeBookingOperation,
  failBookingOperation,
} from "./booking-operations.js";

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (sql.startsWith("INSERT INTO booking_operations")) {
            const [opKey, kind, contactId, calendarId, startTime, leaseUntil, createdAt, updatedAt] = args;
            if (rows.has(opKey)) return { meta: { changes: 0 } };
            rows.set(opKey, {
              op_key: opKey, kind, contact_id: contactId, calendar_id: calendarId,
              start_time: startTime, status: "processing", appointment_id: null,
              result_json: null, lease_until: leaseUntil, attempts: 1,
              last_error: null, created_at: createdAt, updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          const row = rows.get(sql.includes("WHERE op_key = ? AND status = 'processing'") ? args.at(-2) : args[2]);
          if (sql.includes("attempts = attempts + 1")) {
            const [leaseUntil, now, opKey, cutoff] = args;
            const current = rows.get(opKey);
            if (!current || !["processing", "retryable"].includes(current.status) || current.lease_until > cutoff) return { meta: { changes: 0 } };
            Object.assign(current, { status: "processing", lease_until: leaseUntil, attempts: current.attempts + 1, last_error: null, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET appointment_id = NULL")) {
            const [now, opKey, appointmentId] = args;
            const current = rows.get(opKey);
            if (!current || current.status !== "processing" || current.appointment_id !== appointmentId) return { meta: { changes: 0 } };
            Object.assign(current, { appointment_id: null, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET appointment_id")) {
            const [appointmentId, leaseUntil, now, opKey] = args;
            const current = rows.get(opKey);
            if (!current || current.status !== "processing" || (current.appointment_id && current.appointment_id !== appointmentId)) return { meta: { changes: 0 } };
            Object.assign(current, { appointment_id: appointmentId, lease_until: leaseUntil, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("status = 'completed'")) {
            const [resultJson, now, opKey] = args;
            const current = rows.get(opKey);
            if (!current || current.status !== "processing") return { meta: { changes: 0 } };
            Object.assign(current, { status: "completed", result_json: resultJson, lease_until: 0, last_error: null, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = ?")) {
            const [status, error, now, opKey] = args;
            const current = rows.get(opKey);
            if (!current || current.status !== "processing") return { meta: { changes: 0 } };
            Object.assign(current, { status, lease_until: 0, last_error: error, updated_at: now });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unhandled SQL: ${sql}`);
        },
        async first() {
          return rows.get(args[0]) || null;
        },
      };
    },
  };
}

const input = {
  opKey: "portal:c1:key1",
  kind: "portal_followup",
  contactId: "c1",
  calendarId: "cal1",
  startTime: "2026-08-20T10:00:00-07:00",
};

describe("booking operation state machine", () => {
  it("allows only one active claimant", async () => {
    const db = fakeDb();
    expect((await claimBookingOperation(db, input, { now: 100 })).state).toBe("acquired");
    expect((await claimBookingOperation(db, input, { now: 101 })).state).toBe("in_progress");
  });

  it("resumes an expired lease while preserving the appointment checkpoint", async () => {
    const db = fakeDb();
    await claimBookingOperation(db, input, { now: 100, leaseMs: 10 });
    await checkpointBookingAppointment(db, input.opKey, "appt1", { now: 101, leaseMs: 10 });
    const resumed = await claimBookingOperation(db, input, { now: 112, leaseMs: 10 });
    expect(resumed).toMatchObject({ state: "acquired", operation: { appointmentId: "appt1", attempts: 2 } });
  });

  it("returns the durable result after completion", async () => {
    const db = fakeDb();
    await claimBookingOperation(db, input, { now: 100 });
    await completeBookingOperation(db, input.opKey, { success: true, appointment: { id: "appt1" } }, { now: 110 });
    const duplicate = await claimBookingOperation(db, input, { now: 120 });
    expect(duplicate).toMatchObject({ state: "completed", operation: { result: { success: true, appointment: { id: "appt1" } } } });
  });

  it("clears a checkpoint only for the exact cancelled appointment", async () => {
    const db = fakeDb();
    await claimBookingOperation(db, input, { now: 100 });
    await checkpointBookingAppointment(db, input.opKey, "appt1", { now: 101 });
    await clearBookingAppointmentCheckpoint(db, input.opKey, "appt1", { now: 102 });
    expect(db.rows.get(input.opKey).appointment_id).toBe(null);
  });

  it("rejects reuse of a key for another slot and preserves manual review", async () => {
    const db = fakeDb();
    await claimBookingOperation(db, input, { now: 100 });
    expect((await claimBookingOperation(db, { ...input, startTime: "2026-08-21T10:00:00-07:00" }, { now: 101 })).state).toBe("conflict");
    await failBookingOperation(db, input.opKey, "ambiguous appointment", { now: 102, manualReview: true });
    expect((await claimBookingOperation(db, input, { now: 103 })).state).toBe("manual_review");
  });

  it("makes explicit failures immediately retryable", async () => {
    const db = fakeDb();
    await claimBookingOperation(db, input, { now: 100 });
    await failBookingOperation(db, input.opKey, "provider 500", { now: 101 });
    const retry = await claimBookingOperation(db, input, { now: 102 });
    expect(retry).toMatchObject({ state: "acquired", operation: { attempts: 2 } });
  });
});
