import { describe, expect, it, vi } from "vitest";
import { ASSESSMENT_PRODUCT_ID, reconcilePaidBookingIntents } from "./paid-booking-watchdog.js";

function fakeDb(intents) {
  const rows = new Map(intents.map((intent) => [intent.intent_id, { ...intent }]));
  return {
    rows,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() {
          if (!sql.includes("FROM paid_booking_intents")) throw new Error(`Unhandled query: ${sql}`);
          const [productId, oldest, newest, expiresAt, updatedAt, limit] = args;
          return {
            results: [...rows.values()].filter((row) => (
              row.product_id === productId && row.status === "pending" &&
              row.created_at <= oldest && row.created_at >= newest &&
              row.expires_at >= expiresAt && row.updated_at <= updatedAt
            )).slice(0, limit),
          };
        },
        async run() {
          if (sql.includes("SET status = 'manual_review'")) {
            const [now, intentId] = args;
            const row = rows.get(intentId);
            if (!row || !["pending", "bound"].includes(row.status)) return { meta: { changes: 0 } };
            Object.assign(row, { status: "manual_review", updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET updated_at = ?")) {
            const [now, intentId] = args;
            const row = rows.get(intentId);
            if (!row || row.status !== "pending") return { meta: { changes: 0 } };
            row.updated_at = now;
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unhandled update: ${sql}`);
        },
      };
    },
  };
}

function intent(now, overrides = {}) {
  return {
    intent_id: "intent-1",
    contact_id: "contact-1",
    product_id: ASSESSMENT_PRODUCT_ID,
    calendar_id: "EM6vB2mq7EAdGCbUb3j1",
    start_time: "2026-08-20T10:00:00-07:00",
    timezone: "America/Los_Angeles",
    status: "pending",
    order_id: null,
    appointment_id: null,
    created_at: now - 120_000,
    expires_at: now + 86_400_000,
    updated_at: now - 60_000,
    ...overrides,
  };
}

describe("paid booking watchdog", () => {
  it("replays a recent unbound assessment through the one authoritative handler", async () => {
    const now = Date.now();
    const db = fakeDb([intent(now)]);
    const fulfill = vi.fn(async () => new Response(JSON.stringify({ success: true, appointmentId: "appt-1" }), { status: 200 }));
    const result = await reconcilePaidBookingIntents(
      { ATTEND_DB: db, GHL_WEBHOOK_SECRET: "secret" },
      now,
      { findManualAppointment: vi.fn(async () => null), fulfill, recordOpsError: vi.fn(async () => ({ recorded: true })) },
    );
    expect(fulfill).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ intent_id: "intent-1" }));
    expect(result).toEqual({ checked: 1, recovered: 1, waitingForPayment: 0, manualReview: 0, errors: 0 });
    expect(db.rows.get("intent-1").updated_at).toBe(now);
  });

  it("stops rather than duplicating when staff already booked another assessment time", async () => {
    const now = Date.now();
    const db = fakeDb([intent(now)]);
    const fulfill = vi.fn();
    const recordOpsError = vi.fn(async () => ({ recorded: true }));
    const result = await reconcilePaidBookingIntents(
      { ATTEND_DB: db, GHL_WEBHOOK_SECRET: "secret" },
      now,
      {
        findManualAppointment: vi.fn(async () => ({ id: "manual-appt", startTime: "2026-08-21T10:00:00-07:00" })),
        fulfill,
        recordOpsError,
      },
    );
    expect(fulfill).not.toHaveBeenCalled();
    expect(db.rows.get("intent-1").status).toBe("manual_review");
    expect(recordOpsError).toHaveBeenCalledWith(expect.any(Object), "paid-booking-watchdog", expect.stringContaining("different appointment"), expect.objectContaining({ existingAppointmentId: "manual-appt" }));
    expect(result).toEqual({ checked: 1, recovered: 0, waitingForPayment: 0, manualReview: 1, errors: 0 });
  });

  it("does not scan stale or very recent checkout intents", async () => {
    const now = Date.now();
    const db = fakeDb([
      intent(now, { intent_id: "too-new", created_at: now - 30_000 }),
      intent(now, { intent_id: "stale", created_at: now - (31 * 60_000) }),
    ]);
    const fulfill = vi.fn();
    const result = await reconcilePaidBookingIntents(
      { ATTEND_DB: db, GHL_WEBHOOK_SECRET: "secret" },
      now,
      { findManualAppointment: vi.fn(), fulfill, recordOpsError: vi.fn() },
    );
    expect(result.checked).toBe(0);
    expect(fulfill).not.toHaveBeenCalled();
  });
});
