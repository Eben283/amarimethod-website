import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_PAID_BOOKING_WORKFLOW,
  ASSESSMENT_PAID_BOOKING_WORKFLOW_ID,
  ASSESSMENT_PRODUCT_ID,
  assessmentBookingFromWorkflow,
  defineAssessmentPaidBookingWorkflow,
} from "./assessment-paid-booking-workflow.js";

describe("Assessment paid booking workflow", () => {
  it("is a complete executable document for the live public $29 product", () => {
    const booking = assessmentBookingFromWorkflow(ASSESSMENT_PAID_BOOKING_WORKFLOW);
    expect(ASSESSMENT_PAID_BOOKING_WORKFLOW.id).toBe(ASSESSMENT_PAID_BOOKING_WORKFLOW_ID);
    expect(booking).toMatchObject({
      isNonCreditBooking: true,
      calendarId: "EM6vB2mq7EAdGCbUb3j1",
      durationMinutes: 50,
    });
    expect(ASSESSMENT_PAID_BOOKING_WORKFLOW.booking.productId).toBe(ASSESSMENT_PRODUCT_ID);
    expect(ASSESSMENT_PAID_BOOKING_WORKFLOW.nodes.map((node) => node.id)).toContain("minute-recovery");
  });

  it("rejects a map that could point the $29 checkout at another product", () => {
    expect(() => defineAssessmentPaidBookingWorkflow({
      ...ASSESSMENT_PAID_BOOKING_WORKFLOW,
      booking: { ...ASSESSMENT_PAID_BOOKING_WORKFLOW.booking, productId: "other-product" },
    })).toThrow("Assessment product ID");
  });
});
