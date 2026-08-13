import { describe, expect, it } from "vitest";
import {
  bindPaidBookingIntent,
  completePaidBookingIntent,
  createPaidBookingIntent,
  flagPaidBookingIntentForManualReview,
  touchPaidBookingIntent,
} from "./paid-booking-intents.js";

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (sql.startsWith("INSERT INTO paid_booking_intents")) {
            const [intentId, contactId, productId, calendarId, startTime, timezone, participantAgreementVersion, participantAgreementAcceptedAt, participantAgreementIp, participantAgreementUserAgent, createdAt, expiresAt, updatedAt] = args;
            if (rows.has(intentId)) return { meta: { changes: 0 } };
            rows.set(intentId, { intent_id: intentId, contact_id: contactId, product_id: productId, calendar_id: calendarId, start_time: startTime, timezone, status: "pending", order_id: null, appointment_id: null, participant_agreement_version: participantAgreementVersion, participant_agreement_accepted_at: participantAgreementAcceptedAt, participant_agreement_ip: participantAgreementIp, participant_agreement_user_agent: participantAgreementUserAgent, created_at: createdAt, expires_at: expiresAt, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'bound'")) {
            const [orderId, now, intentId] = args;
            const row = rows.get(intentId);
            if (!row || row.status !== "pending" || row.order_id) return { meta: { changes: 0 } };
            Object.assign(row, { status: "bound", order_id: orderId, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'completed'")) {
            const [appointmentId, now, intentId] = args;
            const row = rows.get(intentId);
            if (!row || !["bound", "completed"].includes(row.status) || (row.appointment_id && row.appointment_id !== appointmentId)) return { meta: { changes: 0 } };
            Object.assign(row, { status: "completed", appointment_id: appointmentId, updated_at: now });
            return { meta: { changes: 1 } };
          }
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
            Object.assign(row, { updated_at: now });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unhandled SQL: ${sql}`);
        },
        async first() {
          if (sql.includes("WHERE intent_id")) return rows.get(args[0]) || null;
          if (sql.includes("WHERE order_id")) return [...rows.values()].find((row) => row.order_id === args[0]) || null;
          throw new Error(`Unhandled SQL: ${sql}`);
        },
        async all() {
          const [contactId, productId, createdCutoff, expiryCutoff] = args;
          return { results: [...rows.values()].filter((row) => row.contact_id === contactId && row.product_id === productId && row.status === "pending" && row.created_at <= createdCutoff && row.expires_at >= expiryCutoff).sort((a, b) => b.created_at - a.created_at).slice(0, 3) };
        },
      };
    },
  };
}

const intent = {
  intentId: "intent-12345678", contactId: "contact-1", productId: "assessment",
  calendarId: "cal-1", startTime: "2026-08-20T10:00:00-07:00", timezone: "America/Los_Angeles",
};

describe("paid booking intents", () => {
  it("makes a retried checkout idempotent and rejects changed meaning", async () => {
    const db = fakeDb();
    expect((await createPaidBookingIntent(db, intent, { now: 100 })).state).toBe("created");
    expect((await createPaidBookingIntent(db, intent, { now: 101 })).state).toBe("existing");
    expect((await createPaidBookingIntent(db, { ...intent, startTime: "2026-08-20T11:00:00-07:00" }, { now: 102 })).state).toBe("conflict");
  });

  it("persists Assessment clickwrap evidence with the checkout intent", async () => {
    const db = fakeDb();
    const agreementIntent = {
      ...intent,
      participantAgreementVersion: "participant-agreement-v2026-08-09",
      participantAgreementAcceptedAt: 123,
      participantAgreementIp: "203.0.113.7",
      participantAgreementUserAgent: "test browser",
    };
    const result = await createPaidBookingIntent(db, agreementIntent, { now: 124 });
    expect(result.intent).toMatchObject({
      participantAgreementVersion: "participant-agreement-v2026-08-09",
      participantAgreementAcceptedAt: 123,
      participantAgreementIp: "203.0.113.7",
      participantAgreementUserAgent: "test browser",
    });
    expect(db.rows.get(intent.intentId)).toMatchObject({
      participant_agreement_version: "participant-agreement-v2026-08-09",
      participant_agreement_accepted_at: 123,
    });
  });

  it("binds an order only when exactly one compatible intent exists", async () => {
    const db = fakeDb();
    await createPaidBookingIntent(db, intent, { now: 100, ttlMs: 1000 });
    const bound = await bindPaidBookingIntent(db, { orderId: "order-1", contactId: "contact-1", productId: "assessment", orderCreatedAt: 200 }, { now: 300, skewMs: 0 });
    expect(bound).toMatchObject({ state: "bound", intent: { intentId: intent.intentId, startTime: intent.startTime, orderId: "order-1" } });
    expect((await bindPaidBookingIntent(db, { orderId: "order-1", contactId: "contact-1", productId: "assessment", orderCreatedAt: 200 }, { now: 400 })).state).toBe("bound");
  });

  it("refuses to guess when two checkout intents can match the payment", async () => {
    const db = fakeDb();
    await createPaidBookingIntent(db, intent, { now: 100, ttlMs: 1000 });
    await createPaidBookingIntent(db, { ...intent, intentId: "intent-87654321", startTime: "2026-08-20T11:00:00-07:00" }, { now: 110, ttlMs: 1000 });
    const result = await bindPaidBookingIntent(db, { orderId: "order-ambiguous", contactId: "contact-1", productId: "assessment", orderCreatedAt: 200 }, { now: 300, skewMs: 0 });
    expect(result.state).toBe("ambiguous");
    expect(result.intents).toHaveLength(2);
  });

  it("checkpoints successful fulfillment on the intent", async () => {
    const db = fakeDb();
    await createPaidBookingIntent(db, intent, { now: 100, ttlMs: 1000 });
    await bindPaidBookingIntent(db, { orderId: "order-1", contactId: "contact-1", productId: "assessment", orderCreatedAt: 200 }, { now: 300, skewMs: 0 });
    await completePaidBookingIntent(db, intent.intentId, "appt-1", { now: 400 });
    expect(db.rows.get(intent.intentId)).toMatchObject({ status: "completed", appointment_id: "appt-1" });
  });

  it("holds a human-recovered booking and never lets a delayed webhook re-open it", async () => {
    const db = fakeDb();
    await createPaidBookingIntent(db, intent, { now: 100, ttlMs: 1000 });
    await bindPaidBookingIntent(db, { orderId: "order-1", contactId: "contact-1", productId: "assessment", orderCreatedAt: 200 }, { now: 300, skewMs: 0 });
    expect((await flagPaidBookingIntentForManualReview(db, intent.intentId, { now: 350 })).ok).toBe(true);
    expect((await bindPaidBookingIntent(db, { orderId: "order-1", contactId: "contact-1", productId: "assessment" })).state).toBe("manual_review");
  });

  it("uses updated_at as a bounded recovery-check clock while payment is pending", async () => {
    const db = fakeDb();
    await createPaidBookingIntent(db, intent, { now: 100, ttlMs: 1000 });
    expect((await touchPaidBookingIntent(db, intent.intentId, { now: 150 })).ok).toBe(true);
    expect(db.rows.get(intent.intentId).updated_at).toBe(150);
  });
});
