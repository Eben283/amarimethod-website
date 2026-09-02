import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import {
  captureOwnedEmailCommand,
  dispatchOwnedEmails,
  ownedEmailDeliveryReleaseReadiness,
  ownedEmailDispatchReadiness,
  OWNED_EMAIL_SOURCE_MODE,
} from "./owned-email-dispatch.js";

const MIGRATIONS = [
  "0001_initial_schema.sql",
  "0006_staff_communications.sql",
  "0010_owned_sender_foundation.sql",
  "0015_owned_communication_commands.sql",
  "0016_gmail_provider_evidence.sql",
  "0024_owned_email_dispatch_control.sql",
  "0031_owned_contact_profile_authority.sql",
];

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of MIGRATIONS) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const now = "2026-09-01T20:00:00.000Z";
  sqlite.prepare(
    `INSERT INTO contacts
     (id, display_name, email_normalized, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("contact-1", "A Client", "client@example.test", now, now);
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
    _run: () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  });
  const db = {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => item._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, db, now };
}

function command(overrides = {}) {
  return {
    contactId: "contact-1",
    actor: "Garrett",
    channel: "email",
    idempotencyKey: "desk:contact-1:email:owned-one",
    subject: "Checking in",
    body: "How are you feeling today?",
    ...overrides,
  };
}

function released(db, overrides = {}) {
  return {
    CRM_DB: db,
    OWNED_EMAIL_DELIVERY_RELEASE: "approved",
    OWNED_EMAIL_ACTOR_ALLOWLIST: JSON.stringify(["Garrett"]),
    ...overrides,
  };
}

describe("owned email command and dormant dispatcher", () => {
  it("keeps the production source gate immutable and cannot be activated by environment alone", async () => {
    expect(OWNED_EMAIL_SOURCE_MODE).toBe("shadow");
    expect(ownedEmailDeliveryReleaseReadiness(released({}))).toMatchObject({
      sourceMode: "shadow",
      releaseApproved: true,
      actorAllowlistValid: true,
      enabled: false,
      fallbackProvider: null,
      terminalDeliveryEvidence: false,
    });
    const throwingDb = new Proxy({}, { get() { throw new Error("database must not be read while shadow"); } });
    await expect(dispatchOwnedEmails(released(throwingDb))).resolves.toMatchObject({
      status: "disabled", considered: 0, submitted: 0,
    });
  });

  it("records a shadow command as terminally blocked and never promotes it later", async () => {
    const { sqlite, db, now } = fixture();
    const result = await captureOwnedEmailCommand(db, command(), now);
    expect(result).toMatchObject({
      actor: "Garrett", channel: "email", state: "shadow_blocked",
      policyState: "eligible", deliveryEnabled: false, deduped: false,
    });
    expect(sqlite.prepare(
      "SELECT state, attempts, provider_message_id FROM owned_communication_dispatches",
    ).get()).toEqual({ state: "shadow_blocked", attempts: 0, provider_message_id: null });
    expect(() => sqlite.prepare(
      "UPDATE owned_communication_dispatches SET state = 'pending' WHERE command_id = ?",
    ).run(result.commandId)).toThrow(/invalid owned communication dispatch transition/);
    sqlite.close();
  });

  it("creates a pending row only under an explicit source-active build and submits exactly once", async () => {
    const { sqlite, db, now } = fixture();
    const captured = await captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" });
    expect(captured.state).toBe("pending");
    const sendGmailEmail = vi.fn(async () => ({ id: "gmail-message-1", threadId: "gmail-thread-1" }));
    const env = released(db);
    const outcome = await dispatchOwnedEmails(env, Date.parse(now) + 1000, 10, { sourceMode: "active", sendGmailEmail });

    expect(outcome).toMatchObject({ status: "succeeded", considered: 1, submitted: 1, retryable: 0, manualReview: 0 });
    expect(sendGmailEmail).toHaveBeenCalledOnce();
    expect(sendGmailEmail).toHaveBeenCalledWith(env, {
      actor: "Garrett", to: "client@example.test", subject: "Checking in", text: "How are you feeling today?",
    });
    expect(sqlite.prepare(
      "SELECT state, attempts, provider_message_id, last_error_code FROM owned_communication_dispatches",
    ).get()).toEqual({ state: "submitted", attempts: 1, provider_message_id: "gmail-message-1", last_error_code: null });
    expect(sqlite.prepare(
      "SELECT mailbox_actor, grant_owner, submission_ref, contact_id, provider_message_id FROM gmail_provider_submissions",
    ).get()).toEqual({
      mailbox_actor: "Garrett",
      grant_owner: "garrett@amarimethod.com",
      submission_ref: captured.commandId,
      contact_id: "contact-1",
      provider_message_id: "gmail-message-1",
    });
    await expect(dispatchOwnedEmails(env, Date.parse(now) + 2000, 10, { sourceMode: "active", sendGmailEmail }))
      .resolves.toMatchObject({ considered: 0, submitted: 0 });
    expect(sendGmailEmail).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it("never retries a provider-accepted submission whose CRM proof cannot be reconciled", async () => {
    const { sqlite, db, now } = fixture();
    await captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" });
    const sendGmailEmail = vi.fn(async () => ({ id: "gmail-accepted", threadId: "thread-accepted" }));
    const recordSubmission = vi.fn(async () => { throw new Error("evidence write unavailable"); });
    const outcome = await dispatchOwnedEmails(released(db), Date.parse(now) + 1000, 10, {
      sourceMode: "active", sendGmailEmail, recordSubmission,
    });
    expect(outcome).toMatchObject({ status: "attention", submitted: 0, unreconciled: 1 });
    expect(sqlite.prepare(
      "SELECT state, provider_message_id, last_error_code FROM owned_communication_dispatches",
    ).get()).toEqual({
      state: "submission_unreconciled",
      provider_message_id: "gmail-accepted",
      last_error_code: "submission_evidence_unreconciled",
    });
    await dispatchOwnedEmails(released(db), Date.parse(now) + 2000, 10, {
      sourceMode: "active", sendGmailEmail, recordSubmission,
    });
    expect(sendGmailEmail).toHaveBeenCalledOnce();
    sqlite.close();
  });

  it("never automatically reclaims an executing row after a possible provider crossing", async () => {
    const { sqlite, db, now } = fixture();
    const captured = await captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" });
    sqlite.prepare(
      `UPDATE owned_communication_dispatches
          SET state = 'executing', attempts = 1, lease_until = ?, updated_at = ?
        WHERE command_id = ?`,
    ).run(Date.parse(now) - 1, now, captured.commandId);
    const sendGmailEmail = vi.fn();
    await expect(dispatchOwnedEmails(released(db), Date.parse(now) + 60_000, 10, {
      sourceMode: "active", sendGmailEmail,
    })).resolves.toMatchObject({ considered: 0, submitted: 0, retryable: 0 });
    expect(sendGmailEmail).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT state, attempts FROM owned_communication_dispatches").get())
      .toEqual({ state: "executing", attempts: 1 });
    await expect(ownedEmailDispatchReadiness(db, released(db), "active")).resolves.toMatchObject({
      state: "attention", attention: 1, counts: { executing: 1 }, terminalSuccessModel: "not_available_from_gmail_submission",
    });
    sqlite.close();
  });

  it("rechecks current consent and DND after claiming but before provider I/O", async () => {
    const { sqlite, db, now } = fixture();
    await captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" });
    sqlite.prepare(
      `INSERT INTO consents
       (id, contact_id, channel, state, effective_at, source, evidence_ref, recorded_by)
       VALUES (?, ?, 'email', 'revoked', ?, 'owned:test', ?, 'test')`,
    ).run("consent-1", "contact-1", "2026-09-01T20:00:00.500Z", "evidence-1");
    const sendGmailEmail = vi.fn();
    const outcome = await dispatchOwnedEmails(released(db), Date.parse(now) + 1000, 10, { sourceMode: "active", sendGmailEmail });
    expect(outcome).toMatchObject({ status: "attention", manualReview: 1, submitted: 0 });
    expect(sendGmailEmail).not.toHaveBeenCalled();
    expect(sqlite.prepare(
      "SELECT state, last_error_code FROM owned_communication_dispatches",
    ).get()).toEqual({ state: "manual_review", last_error_code: "policy_changed_channel_opted_out" });
    sqlite.close();
  });

  it("retries only an explicitly retryable pre-acceptance provider failure", async () => {
    const { sqlite, db, now } = fixture();
    await captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" });
    const temporary = Object.assign(new Error("temporary"), { retryable: true });
    const sendGmailEmail = vi.fn()
      .mockRejectedValueOnce(temporary)
      .mockResolvedValueOnce({ id: "gmail-after-retry", threadId: null });
    const recordSubmission = vi.fn(async () => ({ submissionId: "proof-1" }));
    const env = released(db);
    await expect(dispatchOwnedEmails(env, Date.parse(now) + 1000, 10, {
      sourceMode: "active", sendGmailEmail, recordSubmission,
    })).resolves.toMatchObject({ status: "attention", retryable: 1 });
    expect(sqlite.prepare("SELECT state, attempts FROM owned_communication_dispatches").get())
      .toEqual({ state: "retryable", attempts: 1 });
    await expect(dispatchOwnedEmails(env, Date.parse(now) + 2000, 10, {
      sourceMode: "active", sendGmailEmail, recordSubmission,
    })).resolves.toMatchObject({ status: "succeeded", submitted: 1 });
    expect(sqlite.prepare("SELECT state, attempts FROM owned_communication_dispatches").get())
      .toEqual({ state: "submitted", attempts: 2 });
    expect(sendGmailEmail).toHaveBeenCalledTimes(2);
    sqlite.close();
  });

  it("deduplicates exact command replay, rejects drift, and preserves append-only evidence", async () => {
    const { sqlite, db, now } = fixture();
    const first = await captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" });
    await expect(captureOwnedEmailCommand(db, command(), now, { sourceMode: "active" }))
      .resolves.toEqual({ ...first, deduped: true });
    await expect(captureOwnedEmailCommand(db, command({ body: "Changed body" }), now, { sourceMode: "active" }))
      .rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_communication_commands").get().count).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_communication_dispatch_events").get().count).toBe(1);
    const eventDetail = sqlite.prepare("SELECT detail_json FROM owned_communication_dispatch_events").get().detail_json;
    expect(eventDetail).not.toContain("Checking in");
    expect(eventDetail).not.toContain("How are you feeling");
    expect(eventDetail).not.toContain("client@example.test");
    expect(() => sqlite.prepare("UPDATE owned_communication_commands SET body_clean = 'changed'").run()).toThrow(/append-only/);
    expect(() => sqlite.prepare("DELETE FROM owned_communication_dispatch_events").run()).toThrow(/append-only/);
    sqlite.close();
  });

  it("reports aggregate dispatch control without exposing message or contact data", async () => {
    const { db, now } = fixture();
    await captureOwnedEmailCommand(db, command(), now);
    await expect(ownedEmailDispatchReadiness(db, released(db))).resolves.toMatchObject({
      configured: true,
      state: "ready",
      deliveryEnabled: false,
      counts: { shadow_blocked: 1, pending: 0, executing: 0, retryable: 0, submitted: 0 },
      attention: 0,
      terminalSuccessModel: "not_available_from_gmail_submission",
      release: { sourceMode: "shadow", enabled: false },
    });
  });
});
