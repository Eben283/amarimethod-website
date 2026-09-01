import { describe, expect, it } from "vitest";
import {
  appointmentManageIdempotencyKey,
  issueAppointmentManageToken,
  verifyAppointmentManageToken,
} from "./appointment-manage-token.js";

const SECRET = "appointment-manage-test-secret-that-is-at-least-32-bytes";
const NOW = Date.parse("2026-09-01T22:00:00.000Z");
const claims = (patch = {}) => ({
  appointmentId: "appointment-owned",
  contactId: "contact-owned",
  revision: 2,
  capabilities: ["reschedule", "cancel", "calendar"],
  iat: NOW,
  exp: NOW + 14 * 24 * 60 * 60 * 1000,
  ...patch,
});

describe("appointment manage bearer tokens", () => {
  it("round-trips exact bounded owned identity and capabilities", async () => {
    const token = await issueAppointmentManageToken(SECRET, claims(), NOW);
    expect(token.split(".")).toHaveLength(2);
    await expect(verifyAppointmentManageToken(SECRET, token, { nowMs: NOW + 1, capability: "cancel" }))
      .resolves.toEqual({
        appointmentId: "appointment-owned",
        capabilities: ["calendar", "cancel", "reschedule"],
        contactId: "contact-owned",
        exp: claims().exp,
        iat: NOW,
        revision: 2,
        v: 1,
      });
  });

  it("rejects tampering, the wrong secret, expiry, and ungranted actions", async () => {
    const token = await issueAppointmentManageToken(SECRET, claims({ capabilities: ["cancel"] }), NOW);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    await expect(verifyAppointmentManageToken(SECRET, tampered, { nowMs: NOW + 1 })).rejects.toThrow(/signature/);
    await expect(verifyAppointmentManageToken(`${SECRET}-wrong`, token, { nowMs: NOW + 1 })).rejects.toThrow(/signature/);
    await expect(verifyAppointmentManageToken(SECRET, token, { nowMs: claims().exp + 1 })).rejects.toThrow(/lifetime/);
    await expect(verifyAppointmentManageToken(SECRET, token, { nowMs: NOW + 1, capability: "reschedule" }))
      .rejects.toThrow(/not granted/);
  });

  it("refuses missing identities, short secrets, future issue clocks, and overlong lifetimes", async () => {
    await expect(issueAppointmentManageToken(SECRET, claims({ contactId: "" }), NOW)).rejects.toThrow(/identity/);
    await expect(issueAppointmentManageToken("short", claims(), NOW)).rejects.toThrow(/secret/);
    await expect(issueAppointmentManageToken(SECRET, claims({ iat: NOW + 10 * 60 * 1000 }), NOW)).rejects.toThrow(/lifetime/);
    await expect(issueAppointmentManageToken(SECRET, claims({ exp: NOW + 36 * 24 * 60 * 60 * 1000 }), NOW)).rejects.toThrow(/lifetime/);
  });

  it("derives stable action-specific idempotency without exposing the token", async () => {
    const token = await issueAppointmentManageToken(SECRET, claims(), NOW);
    const cancel = await appointmentManageIdempotencyKey(token, "cancel");
    expect(cancel).toMatch(/^client-manage:[A-Za-z0-9_-]{43}$/);
    expect(await appointmentManageIdempotencyKey(token, "cancel")).toBe(cancel);
    expect(await appointmentManageIdempotencyKey(token, "reschedule", "2026-09-08T18:00:00.000Z")).not.toBe(cancel);
    expect(cancel).not.toContain(token);
  });
});
