import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../functions/lib/ghl-worker-token.js", () => ({ getAccessToken: vi.fn().mockResolvedValue("token") }));

import { handleWebhook } from "./webhook.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";

function d1FromSqlite(raw) {
  const statement = (sql) => ({
    sql, values: [],
    bind(...values) { this.values = values; return this; },
    first() { return raw.prepare(this.sql).get(...this.values) || null; },
    all() { return { results: raw.prepare(this.sql).all(...this.values) }; },
    run() {
      const result = raw.prepare(this.sql).run(...this.values);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    prepare: statement,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const SECRET = "webhook-secret";
const NOW = Date.parse("2026-08-24T10:58:25.565-07:00");
const payload = {
  contact_id: "contact-integration",
  appointment_id: "appointment-integration",
  calendar_id: "SKDVOL8wtUN6Ne0ppbC9",
  status: "confirmed",
  event_type: "normal",
  start_time: "2026-08-25T13:00:00-07:00",
  source: "appointment-events-webhook",
};

let raw;
let env;
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  raw.prepare(`INSERT INTO workflow_versions
    (workflow_id, version, state, document, created_at, published_at)
    VALUES (?, ?, 'published', ?, ?, ?)`).run(
    FOLLOW_UP_WORKFLOW.id, FOLLOW_UP_WORKFLOW.version, JSON.stringify(FOLLOW_UP_WORKFLOW), NOW, NOW,
  );
  env = {
    REMINDER_DB: d1FromSqlite(raw),
    PORTAL_KV: {},
    GHL_WEBHOOK_SECRET: SECRET,
    NURTURE_ENGINE_URL: "https://nurture.example/event",
    FOLLOW_UP_RELIABILITY_SPINE_ENABLED: "enabled",
    FOLLOW_UP_RELIABILITY_SOURCE_VERSION: "ghl:appointment-events-webhook:v7",
    SOURCE_REVISION: "git:integration",
    WORKER_VERSION: "worker:integration",
  };
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("/contacts/")) {
      return new Response(JSON.stringify({ contact: { customFields: [] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, actions: [] }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function request() {
  return new Request("https://reminder.example/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Secret": SECRET },
    body: JSON.stringify(payload),
  });
}

describe("enabled Follow-Up reliability webhook", () => {
  it("durably accepts and dispatches before the existing reminder enrollment is acknowledged", async () => {
    const response = await handleWebhook(request(), env, NOW);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      reliability: { deduplicated: false },
      actions: expect.arrayContaining([expect.objectContaining({ engine: "reminder", action: "enroll" })]),
    });
    expect(body.reliability.sourceEventId).toMatch(/^src_/);
    expect(body.reliability.lifecycleInstanceId).toMatch(/^life_/);
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(7);
    expect(raw.prepare("SELECT transition FROM source_event_transitions ORDER BY sequence").all().at(-1))
      .toEqual({ transition: "dispatched" });
    expect(raw.prepare("SELECT COUNT(*) count FROM reminder_enrollments WHERE appointment_id=?").get(payload.appointment_id).count)
      .toBe(1);
    expect(raw.prepare("SELECT DISTINCT definition_version FROM reminder_enrollments").all())
      .toEqual([{ definition_version: FOLLOW_UP_WORKFLOW.version }]);
  });

  it("deduplicates an exact transport replay and keeps one lifecycle and reminder enrollment", async () => {
    expect((await handleWebhook(request(), env, NOW)).status).toBe(200);
    const replay = await handleWebhook(request(), env, NOW + 1);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ reliability: { deduplicated: true } });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(7);
    expect(raw.prepare("SELECT COUNT(*) count FROM reminder_enrollments").get().count).toBe(1);
  });
});
