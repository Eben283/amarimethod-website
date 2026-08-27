import { describe, expect, it } from "vitest";
import { buildStaffSmsPayload, PRACTICE_SMS_FROM_NUMBER } from "./staff-send-text.js";

describe("staff-composed external SMS", () => {
  it("always uses the published Amari practice number", () => {
    expect(PRACTICE_SMS_FROM_NUMBER).toBe("+16288777673");
    expect(buildStaffSmsPayload("contact123", "Hello")).toEqual({
      type: "SMS",
      contactId: "contact123",
      message: "Hello",
      fromNumber: "+16288777673",
    });
  });
});
