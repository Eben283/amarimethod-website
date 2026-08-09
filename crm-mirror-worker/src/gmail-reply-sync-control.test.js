import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { recordGmailEvidence } from "./gmail-evidence.js";
import { createGmailReplySyncControl } from "./gmail-reply-sync-control.js";

const MIGRATIONS = [
  "../migrations/0001_initial_schema.sql",
  "../migrations/0006_staff_communications.sql",
  "../migrations/0010_owned_sender_foundation.sql",
  "../migrations/0015_owned_communication_commands.sql",
  "../migrations/0016_gmail_provider_evidence.sql",
  "../migrations/0017_gmail_sync_gap_evidence.sql",
  "../migrations/0018_gmail_reply_sync_control.sql",
];

function d1(raw) {
  function statement(sql, values = []) {
    return {
      bind(...next) { return statement(sql, next); },
      async first() { return raw.prepare(sql).get(...values) || null; },
      async all() { return { results: raw.prepare(sql).all(...values) }; },
      async run() {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes || 0) } };
      },
    };
  }
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture(actor = "Eben") {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const relative of MIGRATIONS) raw.exec(readFileSync(new URL(relative, import.meta.url), "utf8"));
  const db = d1(raw);
  return { raw, db, control: createGmailReplySyncControl(db, actor) };
}

describe("dormant Gmail reply-sync control", () => {
  it("defaults an exact Staff mailbox to baseline-required with the kill switch engaged", async () => {
    const { raw, control } = fixture();

    await expect(control.read()).resolves.toEqual({
      mailboxActor: "Eben",
      grantOwner: "eben@amarimethod.com",
      state: "baseline_required",
      killSwitchEngaged: true,
      baselineHistoryId: null,
      revision: 0,
      lease: null,
      updatedAt: null,
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_reply_sync_controls").get().count).toBe(0);
  });

  it("records a uint64 baseline idempotently while remaining disabled", async () => {
    const { raw, control } = fixture();
    const command = {
      operationId: "baseline-eben-1",
      historyId: "18446744073709551615",
      observedAt: "2026-08-09T07:00:00.000Z",
    };

    await expect(control.recordBaseline(command)).resolves.toMatchObject({
      deduped: false,
      state: "baselined",
      killSwitchEngaged: true,
      baselineHistoryId: command.historyId,
    });
    await expect(control.recordBaseline(command)).resolves.toMatchObject({ deduped: true });
    await expect(control.read()).resolves.toMatchObject({
      state: "baselined",
      killSwitchEngaged: true,
      baselineHistoryId: command.historyId,
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_reply_sync_control_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(1);
  });

  it("enables only a baselined mailbox and makes the transition idempotent", async () => {
    const { control } = fixture();
    const at = "2026-08-09T07:00:00.000Z";
    await control.recordBaseline({ operationId: "baseline-1", historyId: "101", observedAt: at });

    await expect(control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: at })).resolves.toMatchObject({
      deduped: false,
      state: "enabled",
      killSwitchEngaged: false,
      baselineHistoryId: "101",
    });
    await expect(control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: at })).resolves.toMatchObject({
      deduped: true,
      state: "enabled",
    });

    const unbaselined = fixture("Garrett").control;
    await expect(unbaselined.enable({ operationId: "unsafe-enable", expectedRevision: 1, occurredAt: at }))
      .rejects.toMatchObject({ code: "invalid_state_transition" });
  });

  it("rolls back to a disabled baselined state without erasing the cursor", async () => {
    const { control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z" });

    await expect(control.disable({
      operationId: "rollback-1",
      reasonCode: "operator_rollback",
      occurredAt: "2026-08-09T07:02:00.000Z",
    })).resolves.toMatchObject({
      deduped: false,
      state: "baselined",
      killSwitchEngaged: true,
      baselineHistoryId: "101",
      lease: null,
    });
  });

  it("gives one enabled run an expiring lease and rejects concurrent work", async () => {
    const { db, control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z" });
    const competing = createGmailReplySyncControl(db, "Eben");

    await expect(control.claimRun({
      runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120,
    })).resolves.toMatchObject({ claimed: true, deduped: false, runId: "run-1" });
    await expect(control.claimRun({
      runId: "run-1", startedAt: "2026-08-09T07:02:30.000Z", leaseSeconds: 120,
    })).resolves.toMatchObject({ claimed: true, deduped: true, runId: "run-1" });
    await expect(competing.claimRun({
      runId: "run-2", startedAt: "2026-08-09T07:03:00.000Z", leaseSeconds: 120,
    })).resolves.toMatchObject({ claimed: false, reason: "lease_held" });
    await expect(competing.claimRun({
      runId: "run-2", startedAt: "2026-08-09T07:04:01.000Z", leaseSeconds: 120,
    })).resolves.toMatchObject({ claimed: true, deduped: false, runId: "run-2" });
  });

  it("pins a run to its starting checkpoint and accepts only the latest committed cursor", async () => {
    const { db, control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({
      operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z",
    });
    await expect(control.claimRun({
      runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120,
    })).resolves.toMatchObject({ lease: { runId: "run-1", cursorBefore: "101" } });
    await recordGmailEvidence(db, { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" }, {
      kind: "history_observation", mailboxAddress: "eben@amarimethod.com", historyId: "105",
      observedAt: "2026-08-09T07:02:30.000Z",
    }, "2026-08-09T07:02:30.000Z");
    const result = {
      runId: "run-1", outcome: "succeeded", cursorBefore: "101", cursorAfter: "105",
      counts: { historyRecords: 4, messages: 2, accepted: 1, reviewed: 1, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: null, finishedAt: "2026-08-09T07:03:00.000Z",
    };

    await expect(control.completeRun({ ...result, cursorBefore: "100" }))
      .rejects.toMatchObject({ code: "cursor_before_mismatch" });
    await expect(control.completeRun({ ...result, cursorAfter: "104" }))
      .rejects.toMatchObject({ code: "cursor_after_not_latest" });
    await expect(control.completeRun(result)).resolves.toMatchObject({
      cursorBefore: "101", cursorAfter: "105", outcome: "succeeded",
    });
  });

  it("appends one completed run and releases its lease idempotently", async () => {
    const { db, control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z" });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });
    await recordGmailEvidence(db, { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" }, {
      kind: "history_observation", mailboxAddress: "eben@amarimethod.com", historyId: "105",
      observedAt: "2026-08-09T07:02:30.000Z",
    }, "2026-08-09T07:02:30.000Z");
    const result = {
      runId: "run-1",
      outcome: "succeeded",
      cursorBefore: "101",
      cursorAfter: "105",
      counts: { historyRecords: 4, messages: 2, accepted: 1, reviewed: 1, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: null,
      finishedAt: "2026-08-09T07:03:00.000Z",
    };

    await expect(control.completeRun(result)).resolves.toMatchObject({ deduped: false, outcome: "succeeded" });
    await expect(control.completeRun(result)).resolves.toMatchObject({ deduped: true, outcome: "succeeded" });
    await expect(control.read()).resolves.toMatchObject({ state: "enabled", lease: null });
    await expect(control.recentRuns()).resolves.toEqual([expect.objectContaining({
      runId: "run-1",
      outcome: "succeeded",
      cursorBefore: "101",
      cursorAfter: "105",
      counts: result.counts,
    })]);
  });

  it("fails closed into recovery-required without accepting more work", async () => {
    const { control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z" });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });

    await control.completeRun({
      runId: "run-1",
      outcome: "recovery_required",
      cursorBefore: "101",
      cursorAfter: null,
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: "history_cursor_expired",
      finishedAt: "2026-08-09T07:03:00.000Z",
    });

    await expect(control.read()).resolves.toMatchObject({
      state: "recovery_required", killSwitchEngaged: true, baselineHistoryId: "101", lease: null,
    });
    await expect(control.claimRun({
      runId: "run-2", startedAt: "2026-08-09T07:03:01.000Z", leaseSeconds: 120,
    })).resolves.toMatchObject({ claimed: false, reason: "kill_switch_engaged" });
    await expect(control.recordBaseline({
      operationId: "stale-rebaseline", historyId: "101", observedAt: "2026-08-09T07:03:30.000Z",
    })).rejects.toMatchObject({ code: "stale_recovery_baseline" });
    await expect(control.recordBaseline({
      operationId: "rebaseline-1", historyId: "200", observedAt: "2026-08-09T07:04:00.000Z",
    })).resolves.toMatchObject({ state: "baselined", killSwitchEngaged: true, baselineHistoryId: "200" });
  });

  it("records committed partial progress when a run enters recovery", async () => {
    const { db, control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({
      operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z",
    });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });
    await recordGmailEvidence(db, { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" }, {
      kind: "history_observation", mailboxAddress: "eben@amarimethod.com", historyId: "103",
      observedAt: "2026-08-09T07:02:30.000Z",
    }, "2026-08-09T07:02:30.000Z");
    const recovery = {
      runId: "run-1", outcome: "recovery_required", cursorBefore: "101", cursorAfter: null,
      counts: { historyRecords: 2, messages: 1, accepted: 1, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: "gmail_provider_failed", finishedAt: "2026-08-09T07:03:00.000Z",
    };

    await expect(control.completeRun(recovery)).rejects.toMatchObject({ code: "cursor_after_required" });
    await expect(control.completeRun({ ...recovery, cursorAfter: "103" })).resolves.toMatchObject({
      outcome: "recovery_required", cursorBefore: "101", cursorAfter: "103",
    });
    await expect(control.read()).resolves.toMatchObject({ state: "recovery_required", lease: null });
  });

  it("does not let rollback bypass recovery-required with a stale baseline", async () => {
    const { raw, control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({
      operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z",
    });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });
    await control.completeRun({
      runId: "run-1", outcome: "recovery_required", cursorBefore: "101", cursorAfter: null,
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: "history_cursor_expired", finishedAt: "2026-08-09T07:03:00.000Z",
    });

    await expect(control.disable({
      operationId: "rollback-in-recovery", reasonCode: "operator_rollback", occurredAt: "2026-08-09T07:04:00.000Z",
    })).resolves.toMatchObject({
      state: "recovery_required", killSwitchEngaged: true, baselineHistoryId: "101", lease: null,
    });
    expect(() => raw.prepare(
      `UPDATE gmail_reply_sync_controls
          SET state = 'baselined', baseline_history_id = '200', updated_at = '2026-08-09T07:04:30.000Z'
        WHERE mailbox_actor = 'Eben'`,
    ).run()).toThrow("fresh baseline");
    await expect(control.enable({
      operationId: "unsafe-enable", expectedRevision: 4, occurredAt: "2026-08-09T07:05:00.000Z",
    })).rejects.toMatchObject({ code: "invalid_state_transition" });
  });

  it("derives exact mailbox identity and rejects body-selected or cross-wired ownership", async () => {
    const { raw, control } = fixture();

    expect(() => createGmailReplySyncControl(d1(raw), "Staff")).toThrow("does not have an Amari mailbox");
    await expect(control.recordBaseline({
      operationId: "spoofed-1",
      historyId: "101",
      observedAt: "2026-08-09T07:00:00.000Z",
      mailboxActor: "Garrett",
      grantOwner: "garrett@amarimethod.com",
    })).rejects.toMatchObject({ code: "invalid_control_command" });
    expect(() => raw.prepare(
      `INSERT INTO gmail_reply_sync_controls
       (mailbox_actor, grant_owner, state, kill_switch_engaged, baseline_history_id, updated_at)
       VALUES ('Eben', 'garrett@amarimethod.com', 'baseline_required', 1, NULL, '2026-08-09T07:00:00.000Z')`,
    ).run()).toThrow();
  });

  it("keeps completed run and control-event evidence append-only", async () => {
    const { raw, control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({ operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z" });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });
    await control.completeRun({
      runId: "run-1", outcome: "failed", cursorBefore: "101", cursorAfter: null,
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: "gmail_provider_failed", finishedAt: "2026-08-09T07:03:00.000Z",
    });

    expect(() => raw.prepare("UPDATE gmail_reply_sync_runs SET outcome = 'succeeded'").run()).toThrow("append-only");
    expect(() => raw.prepare("DELETE FROM gmail_reply_sync_control_events").run()).toThrow("append-only");
  });

  it("does not let a stale enable command undo a newer kill-switch rollback", async () => {
    const { control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({
      operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z",
    });
    await control.disable({
      operationId: "rollback-1", reasonCode: "operator_rollback", occurredAt: "2026-08-09T07:02:00.000Z",
    });

    await expect(control.enable({
      operationId: "stale-enable", expectedRevision: 1, occurredAt: "2026-08-09T07:01:30.000Z",
    })).rejects.toMatchObject({ code: "stale_control_revision" });
    await expect(control.read()).resolves.toMatchObject({
      state: "baselined", killSwitchEngaged: true, revision: 3,
    });
  });

  it("invalidates an in-flight lease when rollback engages the kill switch", async () => {
    const { control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await control.enable({
      operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z",
    });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });
    await control.disable({
      operationId: "rollback-1", reasonCode: "operator_rollback", occurredAt: "2026-08-09T07:02:30.000Z",
    });

    await expect(control.completeRun({
      runId: "run-1", outcome: "succeeded", cursorBefore: "101", cursorAfter: "102",
      counts: { historyRecords: 1, messages: 1, accepted: 1, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: null, finishedAt: "2026-08-09T07:03:00.000Z",
    })).rejects.toMatchObject({ code: "lease_not_owned" });
    await expect(control.recentRuns()).resolves.toEqual([]);
  });

  it("rejects conflicting reuse of operation and run idempotency keys", async () => {
    const { control } = fixture();
    await control.recordBaseline({
      operationId: "baseline-1", historyId: "101", observedAt: "2026-08-09T07:00:00.000Z",
    });
    await expect(control.recordBaseline({
      operationId: "baseline-1", historyId: "102", observedAt: "2026-08-09T07:00:00.000Z",
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await control.enable({
      operationId: "enable-1", expectedRevision: 1, occurredAt: "2026-08-09T07:01:00.000Z",
    });
    await control.claimRun({ runId: "run-1", startedAt: "2026-08-09T07:02:00.000Z", leaseSeconds: 120 });
    const result = {
      runId: "run-1", outcome: "failed", cursorBefore: "101", cursorAfter: null,
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      errorCode: "gmail_provider_failed", finishedAt: "2026-08-09T07:03:00.000Z",
    };
    await control.completeRun(result);
    await expect(control.completeRun({ ...result, errorCode: "different_failure" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("contains no provider, watch, route, send, or GHL runtime seam", () => {
    const source = readFileSync(new URL("./gmail-reply-sync-control.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/gmailapis|fetch\s*\(|users\/watch|messages\/send|GHL_/);
  });
});
