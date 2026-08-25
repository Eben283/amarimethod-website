import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureFollowUpReliability, handleEvent, forwardEventToEngine } = vi.hoisted(() => ({
  captureFollowUpReliability: vi.fn(),
  handleEvent: vi.fn(),
  forwardEventToEngine: vi.fn(),
}));

vi.mock("./follow-up-reliability.js", () => ({ captureFollowUpReliability }));
vi.mock("./engine.js", () => ({ handleEvent }));
vi.mock("../../functions/lib/engine-forward.js", () => ({ forwardEventToEngine }));
vi.mock("../../functions/lib/ghl-worker-token.js", () => ({ getAccessToken: vi.fn().mockResolvedValue("token") }));
vi.mock("./workflow-store.js", () => ({ publishedWorkflow: vi.fn().mockResolvedValue({ id: "follow-up" }) }));
vi.mock("./store.js", () => ({ appendEvent: vi.fn().mockResolvedValue(undefined) }));

import { handleWebhook } from "./webhook.js";

const SECRET = "secret";
const env = {
  REMINDER_DB: {},
  GHL_WEBHOOK_SECRET: SECRET,
  FOLLOW_UP_RELIABILITY_SPINE_ENABLED: "enabled",
  NURTURE_ENGINE_URL: "https://nurture.example/event",
};

function requestFor(status) {
  return new Request("https://reminder.example/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Secret": SECRET },
    body: JSON.stringify({
      contact_id: "contact-1",
      appointment_id: "appointment-1",
      calendar_id: "SKDVOL8wtUN6Ne0ppbC9",
      status,
      event_type: "normal",
      start_time: "2026-08-25T10:30:00-07:00",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  captureFollowUpReliability.mockResolvedValue({
    enabled: true,
    applicable: true,
    accepted: false,
    created: true,
    deduplicated: false,
    sourceEventId: "source-1",
    exceptionId: "exception-1",
  });
  handleEvent.mockResolvedValue({ actions: [] });
  forwardEventToEngine.mockResolvedValue({ ok: true, skipped: true, actions: [] });
});

describe("Follow-Up reliability transport acknowledgement", () => {
  it.each(["showed", "cancelled", "noshow"])(
    "durably rejects %s from reminder entry but continues existing lifecycle routing",
    async (status) => {
      const response = await handleWebhook(requestFor(status), env, Date.now());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        reliability: {
          sourceEventId: "source-1",
          rejected: true,
          exceptionId: "exception-1",
          deduplicated: false,
        },
      });
      expect(handleEvent).toHaveBeenCalledWith(
        env,
        expect.objectContaining({ type: status, appointmentEventType: "normal" }),
        expect.any(Number),
        { workflowOverrides: [] },
      );
      expect(forwardEventToEngine).toHaveBeenCalledTimes(1);
    },
  );
});
