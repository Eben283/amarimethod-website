import { describe, expect, it } from "vitest";
import {
  OwnedAppointmentPaymentError,
  recordOwnedAppointmentPayment,
} from "./owned-appointment-payments.js";

function paymentDb(appointment = { id: "owned-appointment", contact_id: "owned-contact" }) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            first: async () => appointment,
          };
        },
      };
    },
    async batch(statements) {
      writes.push(...statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

describe("owned appointment payment evidence", () => {
  it("records an append-only event and current projection under owned identity", async () => {
    const db = paymentDb();
    const result = await recordOwnedAppointmentPayment(db, "ghl-appointment", "ghl-contact", {
      status: "comped", note: "Partner gift", source: "staff", recordedBy: "Garrett",
    }, "2026-08-28T23:00:00.000Z");
    expect(result).toMatchObject({
      appointmentId: "owned-appointment", contactId: "owned-contact",
      status: "comped", note: "Partner gift", recordedBy: "Garrett",
    });
    expect(db.writes).toHaveLength(2);
    expect(db.writes[0].sql).toContain("INSERT INTO appointment_payment_events");
    expect(db.writes[1].sql).toContain("ON CONFLICT(appointment_id) DO UPDATE");
  });

  it("rejects unproved paid status and mismatched identity", async () => {
    await expect(recordOwnedAppointmentPayment(paymentDb(), "appointment", "contact", {
      status: "paid", recordedBy: "Garrett",
    }, "2026-08-28T23:00:00.000Z")).rejects.toMatchObject({ code: "invalid_payment", status: 400 });
    await expect(recordOwnedAppointmentPayment(paymentDb(null), "appointment", "contact", {
      status: "comped", recordedBy: "Garrett",
    }, "2026-08-28T23:00:00.000Z")).rejects.toEqual(expect.any(OwnedAppointmentPaymentError));
  });
});
