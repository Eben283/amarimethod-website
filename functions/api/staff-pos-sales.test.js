import { describe, expect, it } from "vitest";
import { posPaymentActionAvailable } from "./staff-pos-sales.js";

describe("Staff POS activation boundary", () => {
  it("blocks every money-taking action while the invoice bridge is disabled", () => {
    for (const action of ["start-checkout", "charge-saved-card", "record-cash", "fulfill"]) {
      expect(posPaymentActionAvailable({}, action)).toBe(false);
      expect(posPaymentActionAvailable({ STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "false" }, action)).toBe(false);
    }
  });

  it("keeps draft/save/preview usable and opens payment only on explicit activation", () => {
    expect(posPaymentActionAvailable({}, "create")).toBe(true);
    expect(posPaymentActionAvailable({}, "save")).toBe(true);
    expect(posPaymentActionAvailable({}, "preview-checkout-text")).toBe(true);
    expect(posPaymentActionAvailable({ STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true" }, "charge-saved-card")).toBe(true);
  });
});
