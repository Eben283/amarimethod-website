import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./delivery-receipts.js", () => ({
  reconcileDeliveryReceipts: vi.fn(),
}));
vi.mock("./workflow-store.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    publishedWorkflow: vi.fn(),
    saveDraftWorkflow: vi.fn(),
    publishDraftWorkflow: vi.fn(),
  };
});
vi.mock("./store.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, appendEvent: vi.fn() };
});

import worker from "./index.js";
import { reconcileDeliveryReceipts } from "./delivery-receipts.js";
import { NO_SHOW_RECOVERY_RELEASE_WORKFLOW, NO_SHOW_RECOVERY_WORKFLOW } from "./no-show-recovery-workflow.js";
import { publishedWorkflow, publishDraftWorkflow, saveDraftWorkflow } from "./workflow-store.js";
import { appendEvent } from "./store.js";

describe("POST /receipts/run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs receipt reconciliation only and cannot invoke the send cycle", async () => {
    reconcileDeliveryReceipts.mockResolvedValue({ checked: 2, recorded: 2, pending: 0, errors: 0 });
    const response = await worker.fetch(new Request("https://reminder.test/receipts/run", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    }), { WORKER_AUTH_SECRET: "test-secret" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      receipts: { checked: 2, recorded: 2, pending: 0, errors: 0 },
    });
    expect(reconcileDeliveryReceipts).toHaveBeenCalledOnce();
  });
});

describe("POST /workflow-release — No Show", () => {
  beforeEach(() => vi.clearAllMocks());

  const request = () => new Request("https://reminder.test/workflow-release", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json", "X-Staff-Actor": "Eben" },
    body: JSON.stringify({ workflowId: "no-show-recovery" }),
  });
  const env = (over = {}) => ({
    WORKER_AUTH_SECRET: "test-secret",
    REMINDER_DB: { prepare() {}, batch() {} },
    CRM_DB: { prepare() {} },
    PORTAL_KV: {},
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "client",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    OWNED_SMS: { fetch() {} },
    APPOINTMENT_MANAGE_LINK_SECRET: "appointment-manage-link-secret-at-least-32-characters",
    NO_SHOW_BEHAVIOR_RELEASE: "approved",
    NO_SHOW_DELIVERY_RELEASE: "approved",
    ...over,
  });

  it("requires both independent release approvals", async () => {
    const response = await worker.fetch(request(), env({ NO_SHOW_DELIVERY_RELEASE: undefined }));
    expect(response.status).toBe(403);
    expect(publishedWorkflow).not.toHaveBeenCalled();
  });

  it("refuses publication while any owned delivery dependency is absent", async () => {
    const response = await worker.fetch(request(), env({ OWNED_SMS: undefined }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "No Show owned delivery is not ready",
      reason: "owned-sms-unavailable",
    });
    expect(publishedWorkflow).not.toHaveBeenCalled();
  });

  it("stops if the currently published source contract is not exact v3 shadow", async () => {
    publishedWorkflow.mockResolvedValue({ ...NO_SHOW_RECOVERY_WORKFLOW, version: 9 });
    const response = await worker.fetch(request(), env());
    expect(response.status).toBe(409);
    expect(saveDraftWorkflow).not.toHaveBeenCalled();
  });

  it("publishes exact v4 active and appends its audited release event", async () => {
    publishedWorkflow.mockResolvedValue(NO_SHOW_RECOVERY_WORKFLOW);
    publishDraftWorkflow.mockResolvedValue(NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    const response = await worker.fetch(request(), env());
    expect(response.status).toBe(200);
    expect(saveDraftWorkflow).toHaveBeenCalledWith(expect.any(Object), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(publishDraftWorkflow).toHaveBeenCalledWith(expect.any(Object), "no-show-recovery", 4, 3);
    expect(appendEvent).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      flowKey: "no-show-recovery",
      definitionVersion: 4,
      action: "workflow_published",
      outcome: "published",
      detail: { actor: "Eben", lane: "no_show_behavior_release" },
    }));
  });
});
