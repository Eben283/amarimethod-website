import { describe, expect, it } from "vitest";
import worker, { parseClientDeskLimit, parseContactSearch, parseQueueLimit, parseSyncRequest } from "./index.js";

function outboxDb() {
  const attempts = [];
  return {
    attempts,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            async first() {
              if (sql.includes("FROM contacts contact")) return {
                id: "contact-1", display_name: "Surrina", email_normalized: "surrina@example.test", phone_e164: "+14155550100",
                dnd_state: "off", email_consent_state: "unknown", sms_consent_state: "unknown",
              };
              if (sql.includes("FROM outbound_delivery_attempts")) return attempts.find((row) => row.actor === values[0] && row.idempotency_key === values[1]) || null;
              return null;
            },
          };
        },
      };
    },
    async batch(statements) {
      return statements.map((statement) => {
        if (!statement.sql.includes("INSERT OR IGNORE INTO outbound_delivery_attempts")) return { meta: { changes: 1 } };
        const [id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at, idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state] = statement.values;
        const existing = attempts.find((row) => row.actor === actor && row.idempotency_key === idempotency_key);
        if (!existing) attempts.push({ id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at, idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state });
        return { meta: { changes: existing ? 0 : 1 } };
      });
    },
  };
}

describe("CRM mirror request validation", () => {
  it("uses bounded, read-only defaults", () => {
    expect(parseSyncRequest({})).toEqual({ sources: ["ghl", "stripe", "stripe-invoices"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["stripe", "stripe"], limit: 999 })).toEqual({
      sources: ["stripe"], limit: 50, pages: 8,
    });
  });

  it("rejects an empty or unsupported source set", () => {
    expect(() => parseSyncRequest({ sources: ["gmail"] })).toThrow("sources must contain owned-appointment-lifecycles");
    expect(parseSyncRequest({ sources: ["owned-appointment-lifecycles"] })).toEqual({ sources: ["owned-appointment-lifecycles"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["owned-quiz-nurture"] })).toEqual({ sources: ["owned-quiz-nurture"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["ghl-conversations"] })).toEqual({ sources: ["ghl-conversations"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["ghl-conversations-recent"] })).toEqual({ sources: ["ghl-conversations-recent"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["ghl-message-export"], pages: 99 })).toEqual({ sources: ["ghl-message-export"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["ghl-client-records"] })).toEqual({ sources: ["ghl-client-records"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["stripe-invoices"] })).toEqual({ sources: ["stripe-invoices"], limit: 25, pages: 8 });
  });

  it("does not make reconciliation a sync source", () => {
    expect(() => parseSyncRequest({ sources: ["reconciliation"] })).toThrow("sources must contain owned-appointment-lifecycles");
  });

  it("bounds the protected reconciliation review queue", () => {
    expect(parseQueueLimit(null)).toBe(25);
    expect(parseQueueLimit("0")).toBe(1);
    expect(parseQueueLimit("99")).toBe(50);
  });

  it("loads the complete mirrored contact index without relaxing queue limits", () => {
    expect(parseClientDeskLimit(null)).toBe(1000);
    expect(parseClientDeskLimit("0")).toBe(1);
    expect(parseClientDeskLimit("1500")).toBe(1000);
    expect(parseQueueLimit("1500")).toBe(50);
  });

  it("requires a bounded contact search term", () => {
    expect(parseContactSearch(null)).toBeNull();
    expect(() => parseContactSearch("x")).toThrow("search needs at least 2 characters");
    expect(parseContactSearch("  Eben  ")).toBe("Eben");
    expect(parseContactSearch("a".repeat(120))).toHaveLength(100);
  });

  it("does not make approval actions a sync source", () => {
    expect(() => parseSyncRequest({ sources: ["reconciliation-review"] })).toThrow("sources must contain owned-appointment-lifecycles");
  });

});

describe("CRM mirror dashboard access handoff", () => {
  it("keeps missed-appointment truth authenticated, read-only, and explicit about legacy non-authority", async () => {
    let batches = 0;
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: {
        prepare(sql) {
          return { sql, bind(...values) { return { sql, values }; } };
        },
        async batch() {
          batches += 1;
          return [
            { results: [{ id: "contact-1", display_name: "Avery", legacy_missed_appointments: "3" }] },
            { results: [{ appointments: 2, missed_appointments: 1, missing_facts: 0, baseline_facts: 2, current_mismatches: 0 }] },
            { results: [{
              appointment_id: "appointment-1", appointment_revision: 2, normalized_status: "no_show",
              authority: "provider_mirror", source_kind: "migration_baseline", history_complete: 0,
              effective_at: "2026-08-01T18:00:00.000Z", recorded_at: "2026-08-01T18:00:00.000Z",
              starts_at: "2026-08-01T17:00:00.000Z", ends_at: "2026-08-01T18:00:00.000Z",
              service_name: "Partner Initial Session",
            }] },
          ];
        },
      },
    };
    const url = "https://crm.test/appointments/missed-truth?contactId=contact-1";
    expect((await worker.fetch(new Request(url), env)).status).toBe(401);
    const response = await worker.fetch(new Request(url, {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      readOnly: true,
      mutableCounterWritten: false,
      authorityPromoted: false,
      state: "baseline",
      summary: { missedAppointments: 1 },
      legacyObservation: { observedValue: 3, matchesDerived: false, authoritative: false },
    });
    expect(batches).toBe(1);
  });

  it("keeps attendance mutation source-pinned shadow despite environment flags", async () => {
    let storageTouches = 0;
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      OWNED_ATTENDANCE_SOURCE_MODE: "active",
      CRM_DB: {
        prepare() {
          storageTouches += 1;
          throw new Error("source-shadow route must not touch storage");
        },
      },
    };
    const request = (headers = {}, extra = {}) => new Request(
      "https://crm.test/appointments/attendance-commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          appointmentId: "appointment-1",
          contactId: "contact-1",
          idempotencyKey: "attendance-command-0001",
          targetStatus: "attended",
          expectedRevision: 1,
          ...extra,
        }),
      },
    );
    expect((await worker.fetch(request(), env)).status).toBe(401);
    const invalidActor = await worker.fetch(request({
      Authorization: "Bearer test-secret",
      "X-Staff-Actor": "Client",
    }), env);
    expect(invalidActor.status).toBe(400);
    await expect(invalidActor.json()).resolves.toEqual({ error: "recognized_staff_actor_required" });

    const unsupported = await worker.fetch(request({
      Authorization: "Bearer test-secret",
      "X-Staff-Actor": "Garrett",
    }, { grantSession: true }), env);
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toEqual({ error: "unsupported_fields", fields: ["grantSession"] });

    const shadow = await worker.fetch(request({
      Authorization: "Bearer test-secret",
      "X-Staff-Actor": "Garrett",
    }), env);
    expect(shadow.status).toBe(503);
    await expect(shadow.json()).resolves.toEqual({
      error: "owned_attendance_shadow_only",
      detail: "owned attendance commands remain source-level shadow",
    });
    expect(storageTouches).toBe(0);
  });

  it("keeps recovery intake Worker-authenticated, Client-scoped, and unable to accept booking or entitlement fields", async () => {
    const url = "https://crm.test/appointments/recovery-requests";
    const payload = {
      appointmentId: "appointment-1",
      contactId: "contact-1",
      appointmentRevision: 3,
      grantSession: true,
    };
    const request = (headers = {}) => new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
    const env = { WORKER_AUTH_SECRET: "test-secret", CRM_DB: {} };
    expect((await worker.fetch(request(), env)).status).toBe(401);
    const staff = await worker.fetch(request({
      Authorization: "Bearer test-secret", "X-Staff-Actor": "Garrett",
    }), env);
    expect(staff.status).toBe(403);
    await expect(staff.json()).resolves.toEqual({ error: "client_recovery_request_required" });
    const client = await worker.fetch(request({
      Authorization: "Bearer test-secret", "X-Staff-Actor": "Client",
    }), env);
    expect(client.status).toBe(400);
    await expect(client.json()).resolves.toEqual({ error: "unsupported_fields", fields: ["grantSession"] });
    expect((await worker.fetch(new Request(url), env)).status).toBe(401);
  });

  it("keeps native appointment capture behind Worker auth and recognized Staff identity", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret", CRM_DB: {} };
    const request = (headers = {}) => new Request("https://crm.test/appointments/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        action: "schedule",
        contactId: "contact-1",
        serviceId: "partner-initial",
        idempotencyKey: "partner-session-0001",
        startTime: "2026-09-01T10:00:00-07:00",
        timezone: "America/Los_Angeles",
      }),
    });

    expect((await worker.fetch(request(), env)).status).toBe(401);
    const invalidActor = await worker.fetch(request({
      Authorization: "Bearer test-secret",
      "X-Staff-Actor": "Unknown Person",
    }), env);
    expect(invalidActor.status).toBe(400);
    await expect(invalidActor.json()).resolves.toEqual({ error: "recognized_staff_actor_required" });

    const clientSchedule = await worker.fetch(request({
      Authorization: "Bearer test-secret",
      "X-Staff-Actor": "Client",
    }), env);
    expect(clientSchedule.status).toBe(403);
    await expect(clientSchedule.json()).resolves.toEqual({ error: "client_schedule_forbidden" });
  });

  it("keeps person and family automation evidence behind Worker authentication", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret", CRM_DB: {}, AUTOMATION_DB: {} };

    const personResponse = await worker.fetch(new Request("https://crm.test/automations/people/owned_person_1"), env);
    const familyResponse = await worker.fetch(new Request("https://crm.test/automations/families/initial-session-reminders"), env);

    expect(personResponse.status).toBe(401);
    expect(familyResponse.status).toBe(401);
  });

  it("serves one person's owned automation evidence through the Worker-authenticated read seam", async () => {
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: {
        prepare: () => ({ bind: () => ({ all: async () => ({ results: [{
          id: "owned_person_1", provider_contact_id: "legacy_ghl_1", display_name: "Eben Forrest",
        }] }) }) }),
      },
      AUTOMATION_DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) },
    };
    const response = await worker.fetch(new Request("https://crm.test/automations/people/legacy_ghl_1", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      configured: true,
      contactId: "owned_person_1",
      providerContactId: "legacy_ghl_1",
      automationContactIds: ["owned_person_1", "legacy_ghl_1"],
      enrollments: [],
      events: [],
    });

    const familyResponse = await worker.fetch(new Request("https://crm.test/automations/families/initial-session-reminders", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(familyResponse.status).toBe(200);
    await expect(familyResponse.json()).resolves.toMatchObject({
      success: true,
      configured: true,
      familyKey: "initial-session-reminders",
      enrollments: [],
      events: [],
    });
  });

  it("keeps actor-scoped Gmail reply evidence behind Worker auth and never claims sync is on", async () => {
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: {
        prepare(sql) {
          return { bind: (...values) => ({
            async all() {
              if (sql.includes("FROM gmail_history_observations")) return { results: [{
                mailbox_actor: values[0], grant_owner: values[1], mailbox_address: values[1],
                history_id: "900719925474099399999", observed_at: "2026-08-09T16:00:00.000Z",
              }] };
              if (sql.includes("FROM gmail_sync_gap_reviews")) return { results: [] };
              return { results: [] };
            },
          }) };
        },
      },
    };
    const denied = await worker.fetch(new Request("https://crm.test/gmail/reply-readiness?actor=Eben"), env);
    expect(denied.status).toBe(401);

    const response = await worker.fetch(new Request("https://crm.test/gmail/reply-readiness?actor=Eben", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true, actor: "Eben", mailbox: "eben@amarimethod.com", state: "quiet",
      replySyncEnabled: false, checkpoint: { historyId: "900719925474099399999" }, syncGaps: [],
    });
  });

  it("keeps owned dated follow-ups behind worker auth and returns only the owned record contract", async () => {
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: [{
              id: "followup_1",
              title: "Call tomorrow",
              due_on: "2026-08-09",
              completed_at: null,
              created_by: "Eben",
              completed_by: null,
              created_at: "2026-08-08T20:00:00.000Z",
              updated_at: "2026-08-08T20:00:00.000Z",
              contact_id: "contact_1",
              display_name: "Surrina",
              contact_external_id: "ghl_1",
            }] }),
          }),
        }),
      },
    };
    const denied = await worker.fetch(new Request("https://crm.test/owned-followups"), env);
    expect(denied.status).toBe(401);

    const response = await worker.fetch(new Request("https://crm.test/owned-followups", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      truncated: false,
      followups: [{ id: "followup_1", contactId: "contact_1", providerContactId: "ghl_1", contactName: "Surrina", dueOn: "2026-08-09" }],
    });
  });

  it("exchanges an opaque one-time link for an HttpOnly dashboard session without exposing the bearer secret", async () => {
    const values = new Map();
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      PORTAL_KV: {
        put: async (key, value) => values.set(key, value),
        get: async (key) => values.get(key) || null,
        delete: async (key) => values.delete(key),
      },
    };
    const minted = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret", "X-Staff-Actor": "Garrett" },
    }), env);
    expect(minted.status).toBe(200);
    const body = await minted.json();
    expect(body.url).toContain("/dashboard-access/");
    expect(body.url).not.toContain("test-secret");
    const handoff = await worker.fetch(new Request(body.url), env);
    expect(handoff.status).toBe(302);
    expect(handoff.headers.get("Location")).toBe("/");
    expect(handoff.headers.get("Set-Cookie")).toContain("HttpOnly");
    const replay = await worker.fetch(new Request(body.url), env);
    expect(replay.status).toBe(200);
    expect(await replay.text()).toContain("expired");

    const mintedEmbed = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const embedBody = await mintedEmbed.json();
    const embedHandoff = await worker.fetch(new Request(`${embedBody.url}?embed=1&parent_origin=${encodeURIComponent("https://www.amarimethod.com")}`), env);
    expect(embedHandoff.status).toBe(302);
    expect(embedHandoff.headers.get("Location")).toMatch(/^\/\?embed=1&parent_origin=https%3A%2F%2Fwww\.amarimethod\.com#dashboard_session=/);

    const mintedApexEmbed = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const apexEmbedBody = await mintedApexEmbed.json();
    const apexEmbedHandoff = await worker.fetch(new Request(`${apexEmbedBody.url}?embed=1&parent_origin=${encodeURIComponent("https://amarimethod.com")}`), env);
    expect(apexEmbedHandoff.status).toBe(302);
    expect(apexEmbedHandoff.headers.get("Location")).toMatch(/^\/\?embed=1&parent_origin=https%3A%2F%2Famarimethod\.com#dashboard_session=/);

    const mintedUntrustedEmbed = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const untrustedEmbedBody = await mintedUntrustedEmbed.json();
    const untrustedEmbedHandoff = await worker.fetch(new Request(`${untrustedEmbedBody.url}?embed=1&parent_origin=${encodeURIComponent("https://example.com")}`), env);
    expect(untrustedEmbedHandoff.headers.get("Location")).toBe("/?embed=1");

    const deskMinted = await worker.fetch(new Request("https://crm.test/dashboard-access-link?view=client-desk", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const deskBody = await deskMinted.json();
    const deskHandoff = await worker.fetch(new Request(`${deskBody.url}?contact=person_123`), env);
    expect(deskHandoff.headers.get("Location")).toBe("/client-desk?contact=person_123");
    const desk = await worker.fetch(new Request("https://crm.test/client-desk", {
      headers: { Cookie: deskHandoff.headers.get("Set-Cookie") },
    }), env);
    const framePolicy = desk.headers.get("Content-Security-Policy");
    expect(framePolicy).toContain("https://amarimethod.com");
    expect(framePolicy).toContain("https://www.amarimethod.com");
    expect(framePolicy).toContain("https://amarimethod-website.pages.dev");
  });

  it("keeps sender readiness behind staff authentication", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret" };
    const denied = await worker.fetch(new Request("https://crm.test/sender/readiness"), env);
    expect(denied.status).toBe(401);

    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/sender/readiness", {
      headers: { Cookie: session.headers.get("Set-Cookie") },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "non_delivering_outbox", deliveryEnabled: false });
  });

  it("does not expose the former Client Desk email-send route to a staff browser session", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret" };
    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/client-desk/contacts/contact-1/email", {
      method: "POST",
      headers: {
        Cookie: session.headers.get("Set-Cookie"),
        Origin: "https://crm.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subject: "Private test", body: "Must not send" }),
    }), env);
    expect(response.status).toBe(401);
  });

  it("rejects browser-supplied provider evidence on the non-delivering outbox command route", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret", CRM_DB: {} };
    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/communications/outbox", {
      method: "POST",
      headers: {
        Cookie: session.headers.get("Set-Cookie"),
        Origin: "https://crm.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactId: "contact-1",
        channel: "email",
        idempotencyKey: "desk:contact-1:email:provider-smuggle",
        subject: "Checking in",
        body: "This is only a command.",
        providerMessageId: "browser-forged-id",
        deliveryStatus: "delivered",
      }),
    }), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "unsupported_fields" });
  });

  it("derives the actor from the signed Staff session and returns a durable non-send", async () => {
    const db = outboxDb();
    const env = { WORKER_AUTH_SECRET: "test-secret", CRM_DB: db };
    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/communications/outbox", {
      method: "POST",
      headers: {
        Cookie: session.headers.get("Set-Cookie"),
        Origin: "https://crm.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactId: "contact-1",
        channel: "email",
        idempotencyKey: "desk:contact-1:email:owned-command",
        subject: "Checking in",
        body: "This records a non-delivering command.",
      }),
    }), env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      command: {
        actor: "Staff",
        contactId: "contact-1",
        deliveryState: "not_sent_delivery_unavailable",
        deliveryEnabled: false,
      },
    });
    expect(db.attempts[0]).toMatchObject({ actor: "Staff", destination_masked: "su***@example.test", provider: "unassigned" });
  });

  it("reports the owned outbox as available without claiming either channel can deliver", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret", CRM_DB: outboxDb(), PORTAL_KV: {}, AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "id", AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "secret" };
    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/communications/outbox/readiness", {
      headers: { Cookie: session.headers.get("Set-Cookie") },
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outboxAvailable: true,
      deliveryEnabled: false,
      fallbackProvider: null,
      emailDispatch: expect.objectContaining({
        configured: false,
        state: "unavailable",
        deliveryEnabled: false,
        release: expect.objectContaining({ sourceMode: "shadow", enabled: false, fallbackProvider: null }),
      }),
      channels: [
        expect.objectContaining({
          channel: "email",
          configurationDetected: true,
          deliveryEnabled: false,
          blockers: expect.arrayContaining([
            "the signed actor must have an exact verified Amari mailbox grant and Google send-as identity",
            "sender-domain DKIM and DMARC evidence must be reviewed before activation",
            "Gmail reply sync control must be separately baselined and enabled",
            "delivery command dispatcher is not activated",
            "provider outcome synchronization remains dormant and terminal delivery success is undefined",
          ]),
          capabilities: expect.objectContaining({
            submissionAdapterImplemented: true,
            replyProviderAdapterImplemented: true,
            replySyncControlImplemented: true,
            providerOutcomeEvidenceImplemented: true,
          }),
        }),
        expect.objectContaining({ channel: "sms", configurationDetected: false, deliveryEnabled: false }),
      ],
    });
  });

  it("serves aggregate CRM readiness only behind the existing auth boundary", async () => {
    const fresh = new Date().toISOString();
    const results = [
      [{ completed_at: "2026-08-01T12:00:00.000Z", records_seen: 400, known_records: 400, missing_records: 0 }],
      [{ completed_at: "2026-08-01T12:00:00.000Z", records_seen: 55, known_records: 55, missing_records: 0 }],
      [{ status: "partial", finished_at: fresh, failure_detail: null }],
      [{ status: "succeeded", finished_at: fresh, failure_detail: null }],
      [{ count: 396 }], [{ count: 1694 }], [{ count: 0 }],
      [{ result: "ready", checked_at: "2026-07-27T18:10:04.000Z" }],
      [],
    ];
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: {
        prepare: (sql) => ({ sql }),
        batch: async (statements) => statements.map((_statement, index) => ({ results: results[index] })),
      },
    };
    const denied = await worker.fetch(new Request("https://crm.test/readiness"), env);
    expect(denied.status).toBe(401);

    const response = await worker.fetch(new Request("https://crm.test/readiness", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      worker: "amari-crm-mirror",
      shadowOnly: true,
      completeness: { ghl: { state: "complete" }, stripe: { state: "complete" } },
      recovery: { result: "ready" },
      currentSyncOverall: "healthy",
    });
  });

  it("serves appointment shadow readiness behind auth and fails open to the live schedule", async () => {
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: { prepare: () => { throw new Error("no such table: appointment_projection_events"); } },
    };
    const denied = await worker.fetch(new Request("https://crm.test/appointments/readiness"), env);
    expect(denied.status).toBe(401);

    const response = await worker.fetch(new Request("https://crm.test/appointments/readiness", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      configured: false,
      shadowOnly: true,
      state: "unavailable",
      liveScheduleFallback: true,
      bufferPolicy: { state: "confirmed", runtimeAppOwnedMinutes: 20, historicalDocumentedMinutes: 10 },
    });
  });
});
