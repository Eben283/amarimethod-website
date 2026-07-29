import { describe, expect, it } from "vitest";
import { PAID_FOLLOWUP_CALENDARS } from "./portal-pay-followup.js";

describe("portal-pay-followup calendars", () => {
  it("reuses the existing pay-as-you-go follow-up calendars (no new calendar)", () => {
    expect(PAID_FOLLOWUP_CALENDARS["in-person"]).toBe("SKDVOL8wtUN6Ne0ppbC9");
    expect(PAID_FOLLOWUP_CALENDARS.virtual).toBe("oVn77FcecFY16iS2pHyP");
  });
});
