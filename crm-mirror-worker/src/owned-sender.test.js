import { describe, expect, it } from "vitest";
import {
  captureCommunicationCommand,
  communicationReadiness,
  deliveryReadiness,
  evaluateDeliveryEligibility,
  recordShadowDeliveryAttempt,
} from "./owned-sender.js";

function commandDb({ dnd = "off", emailConsent = "unknown", smsConsent = "unknown" } = {}) {
  const rows = { attempts: [], outcomes: [], communications: [] };
  return {
    rows,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            async first() {
              if (sql.includes("FROM contacts contact")) {
                return {
                  id: "contact-1",
                  display_name: "Surrina",
                  email_normalized: "surrina@example.test",
                  phone_e164: "+14155550100",
                  dnd_state: dnd,
                  email_consent_state: emailConsent,
                  sms_consent_state: smsConsent,
                };
              }
              if (sql.includes("FROM outbound_delivery_attempts")) {
                return rows.attempts.find((row) => row.actor === values[0] && row.idempotency_key === values[1]) || null;
              }
              return null;
            },
          };
        },
      };
    },
    async batch(statements) {
      const changes = [];
      for (const statement of statements) {
        if (statement.sql.includes("INSERT OR IGNORE INTO outbound_delivery_attempts")) {
          const [id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at, idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state] = statement.values;
          const existing = rows.attempts.find((row) => row.actor === actor && row.idempotency_key === idempotency_key);
          if (!existing) rows.attempts.push({ id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at, idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state });
          changes.push({ meta: { changes: existing ? 0 : 1 } });
        } else if (statement.sql.includes("INSERT OR IGNORE INTO outbound_delivery_events")) {
          const existing = rows.outcomes.some((row) => row.values[0] === statement.values[0]);
          if (!existing) rows.outcomes.push({ values: statement.values });
          changes.push({ meta: { changes: existing ? 0 : 1 } });
        } else if (statement.sql.includes("INSERT OR IGNORE INTO communication_events")) {
          const existing = rows.communications.some((row) => row.values[0] === statement.values[0]);
          if (!existing) rows.communications.push({ values: statement.values });
          changes.push({ meta: { changes: existing ? 0 : 1 } });
        }
      }
      return changes;
    },
  };
}

describe("owned sender foundation", () => {
  const contact = { email_normalized: "client@example.test", phone_e164: "+14155550100" };

  it("records an eligible command as not sent and links its message reference into Communication", async () => {
    const db = commandDb();
    const result = await captureCommunicationCommand(db, {
      contactId: "contact-1",
      actor: "Eben",
      channel: "email",
      idempotencyKey: "desk:contact-1:email:one",
      subject: "Checking in",
      body: "How are you feeling today?",
    }, "2026-08-08T18:00:00.000Z");

    expect(result).toMatchObject({
      contactId: "contact-1",
      actor: "Eben",
      channel: "email",
      policyState: "eligible",
      deliveryState: "not_sent_delivery_unavailable",
      deliveryEnabled: false,
      deduped: false,
    });
    expect(result.messageRef).toMatch(/^msg_[a-f0-9]{24}$/);
    expect(db.rows.attempts[0]).toMatchObject({
      actor: "Eben",
      dnd_state: "off",
      destination_masked: "su***@example.test",
      provider: "unassigned",
    });
    expect(JSON.stringify(db.rows.outcomes[0].values)).toContain(result.messageRef);
    expect(db.rows.communications[0].values).toContain(result.messageRef);
  });

  it("returns the same append-only command when the browser retries an idempotency key", async () => {
    const db = commandDb();
    const input = {
      contactId: "contact-1",
      actor: "Garrett",
      channel: "sms",
      idempotencyKey: "desk:contact-1:sms:retry-one",
      body: "I am checking in after your session.",
    };
    const first = await captureCommunicationCommand(db, input, "2026-08-08T18:01:00.000Z");
    const retry = await captureCommunicationCommand(db, input, "2026-08-08T18:02:00.000Z");

    expect(retry).toEqual({ ...first, deduped: true });
    expect(db.rows.attempts).toHaveLength(1);
    expect(db.rows.outcomes).toHaveLength(1);
    expect(db.rows.communications).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key for different message content", async () => {
    const db = commandDb();
    const input = {
      contactId: "contact-1",
      actor: "Garrett",
      channel: "sms",
      idempotencyKey: "desk:contact-1:sms:conflict-one",
      body: "First version",
    };
    await captureCommunicationCommand(db, input, "2026-08-08T18:02:00.000Z");

    await expect(captureCommunicationCommand(db, { ...input, body: "Different version" }, "2026-08-08T18:03:00.000Z"))
      .rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(db.rows.attempts).toHaveLength(1);
    expect(db.rows.attempts[0].body_clean).toBe("First version");
  });

  it("derives DND from the mirrored contact and records a policy-blocked non-send", async () => {
    const db = commandDb({ dnd: "on", smsConsent: "granted" });
    const result = await captureCommunicationCommand(db, {
      contactId: "contact-1",
      actor: "Eben",
      channel: "sms",
      idempotencyKey: "desk:contact-1:sms:dnd-on",
      body: "This must not leave the outbox.",
    }, "2026-08-08T18:03:00.000Z");

    expect(result).toMatchObject({
      dndState: "on",
      consentState: "granted",
      policyState: "blocked",
      deliveryState: "not_sent_policy_blocked",
      deliveryEnabled: false,
    });
    expect(JSON.stringify(db.rows.outcomes)).toContain("do_not_disturb");
  });

  it("keeps delivery unavailable and names every Amari-owned mail activation blocker", () => {
    const decision = evaluateDeliveryEligibility({ contact, channel: "sms", consents: [{ channel: "sms", state: "granted" }] });
    expect(decision.policyEligible).toBe(true);
    expect(decision.deliveryAllowed).toBe(false);
    expect(deliveryReadiness()).toMatchObject({ mode: "non_delivering_outbox", deliveryEnabled: false, fallbackProvider: null });
    expect(deliveryReadiness({ PORTAL_KV: {}, AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "id", AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "secret" })).toMatchObject({
      mode: "non_delivering_outbox",
      deliveryEnabled: false,
      channels: [expect.objectContaining({ channel: "email", configurationDetected: true, deliveryEnabled: false }), expect.anything()],
    });
    expect(deliveryReadiness({ PORTAL_KV: {}, GOOGLE_OAUTH_CLIENT_ID: "personal-id", GOOGLE_OAUTH_CLIENT_SECRET: "personal-secret" }).channels[0])
      .toMatchObject({ configurationDetected: false });
    expect(deliveryReadiness().channels[0].blockers).toEqual(expect.arrayContaining([
      "the signed actor must have an exact verified Amari mailbox grant and Google send-as identity",
      "sender-domain DKIM and DMARC evidence must be reviewed before activation",
      "Gmail reply sync control must be separately baselined and enabled",
      "provider outcome synchronization remains dormant and terminal delivery success is undefined",
    ]));
    expect(deliveryReadiness().channels[0].capabilities).toEqual({
      submissionAdapterImplemented: true,
      replyProviderAdapterImplemented: true,
      replySyncControlImplemented: true,
      providerOutcomeEvidenceImplemented: true,
    });
    expect(deliveryReadiness().channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", providerCandidate: "google-workspace", state: "unavailable" }),
      expect.objectContaining({ channel: "sms", providerCandidate: null, state: "unavailable" }),
    ]));
  });

  it("does not call the outbox ready until the command schema can be read", async () => {
    await expect(communicationReadiness(null, {})).resolves.toMatchObject({
      outboxAvailable: false,
      outboxBlockers: ["CRM command storage is not bound"],
    });
    await expect(communicationReadiness({ prepare() { throw new Error("missing table"); } }, {})).resolves.toMatchObject({
      outboxAvailable: false,
      outboxBlockers: ["owned communication command migration is not available"],
    });
    const db = commandDb();
    await expect(communicationReadiness(db, {})).resolves.toMatchObject({ outboxAvailable: true, outboxBlockers: [] });
  });

  it("allows a contact without a recorded opt-in unless the channel is opted out, and honors DND", () => {
    const unknown = evaluateDeliveryEligibility({ contact, channel: "email", consents: [] });
    expect(unknown.policyEligible).toBe(true);
    expect(unknown.reasons).toEqual([]);
    expect(evaluateDeliveryEligibility({ contact, channel: "email", consents: [{ channel: "email", state: "revoked" }] }).reasons)
      .toEqual(expect.arrayContaining(["channel_opted_out"]));
    expect(evaluateDeliveryEligibility({ contact, channel: "sms", consents: [{ channel: "sms", state: "granted" }], dnd: "on" }).reasons)
      .toEqual(expect.arrayContaining(["do_not_disturb"]));
  });

  it("does not let an unknown observation mask explicit consent evidence", () => {
    const decision = evaluateDeliveryEligibility({
      contact,
      channel: "sms",
      consents: [{ channel: "sms", state: "unknown" }, { channel: "sms", state: "granted" }],
    });
    expect(decision.consentState).toBe("granted");
  });

  it("writes an append-only shadow audit without a provider call or raw message content", async () => {
    const statements = [];
    const db = {
      prepare(sql) { return { bind(...values) { statements.push({ sql, values }); return { sql, values }; } }; },
      batch: async (batch) => { expect(batch).toHaveLength(2); },
    };
    const result = await recordShadowDeliveryAttempt(db, {
      contactId: "contact-1", actor: "Staff QA", channel: "email", contact,
      consents: [{ channel: "email", state: "granted" }], content: "Private message body",
    }, "2026-08-03T12:00:00.000Z");
    expect(result.deliveryAllowed).toBe(false);
    expect(statements).toHaveLength(2);
    expect(JSON.stringify(statements)).not.toContain("Private message body");
    expect(statements[0].values[7]).toMatch(/^[a-f0-9]{64}$/);
  });

});
