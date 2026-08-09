// Dormant, provider-free operational control for Gmail reply synchronization.
// Actor/mailbox identity is derived here; callers cannot supply a mailbox.

const MAILBOXES = Object.freeze({
  Eben: "eben@amarimethod.com",
  Garrett: "garrett@amarimethod.com",
});
const OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const REASON_CODE = /^[a-z][a-z0-9_]{2,80}$/;
const UINT64 = /^\d{1,20}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const RUN_OUTCOMES = new Set(["succeeded", "partial", "failed", "recovery_required"]);
const COUNT_FIELDS = Object.freeze(["historyRecords", "messages", "accepted", "reviewed", "skipped", "ignored", "deduped"]);

export class GmailReplySyncControlError extends Error {
  constructor(message, code = "invalid_control_command") {
    super(message);
    this.name = "GmailReplySyncControlError";
    this.code = code;
  }
}

function exactCommand(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GmailReplySyncControlError("Gmail reply sync command is required");
  }
  const unsupported = Object.keys(input).filter((field) => !allowed.includes(field));
  if (unsupported.length) {
    throw new GmailReplySyncControlError(`unsupported Gmail reply sync fields: ${unsupported.join(", ")}`);
  }
}

function operationId(value) {
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    throw new GmailReplySyncControlError("operationId is invalid");
  }
  return value;
}

function historyId(value) {
  if (typeof value !== "string" || !UINT64.test(value) || BigInt(value) > UINT64_MAX) {
    throw new GmailReplySyncControlError("historyId must be a uint64 decimal string");
  }
  return value;
}

function reasonCode(value) {
  if (typeof value !== "string" || !REASON_CODE.test(value)) {
    throw new GmailReplySyncControlError("reasonCode is invalid");
  }
  return value;
}

function runId(value) {
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    throw new GmailReplySyncControlError("runId is invalid");
  }
  return value;
}

function leaseDuration(value) {
  if (!Number.isInteger(value) || value < 30 || value > 900) {
    throw new GmailReplySyncControlError("leaseSeconds must be between 30 and 900");
  }
  return value;
}

function outcome(value) {
  if (!RUN_OUTCOMES.has(value)) throw new GmailReplySyncControlError("run outcome is invalid");
  return value;
}

function runCounts(value) {
  exactCommand(value, COUNT_FIELDS);
  const result = {};
  for (const field of COUNT_FIELDS) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new GmailReplySyncControlError(`counts.${field} must be a non-negative integer`);
    }
    result[field] = value[field];
  }
  return result;
}

function optionalHistoryId(value, label) {
  if (value == null) return null;
  try { return historyId(value); }
  catch { throw new GmailReplySyncControlError(`${label} must be a uint64 decimal string`); }
}

function optionalErrorCode(value, runOutcome) {
  if (value == null) {
    if (runOutcome === "failed" || runOutcome === "recovery_required") {
      throw new GmailReplySyncControlError("errorCode is required for an unsuccessful run");
    }
    return null;
  }
  if (!REASON_CODE.test(value)) throw new GmailReplySyncControlError("errorCode is invalid");
  if (runOutcome === "succeeded" || runOutcome === "partial") {
    throw new GmailReplySyncControlError("errorCode is not allowed for a successful or partial run");
  }
  return value;
}

function runReadModel(row) {
  return {
    mailboxActor: row.mailbox_actor,
    grantOwner: row.grant_owner,
    runId: row.run_id,
    outcome: row.outcome,
    cursorBefore: row.cursor_before,
    cursorAfter: row.cursor_after,
    counts: {
      historyRecords: Number(row.history_records), messages: Number(row.messages),
      accepted: Number(row.accepted), reviewed: Number(row.reviewed), skipped: Number(row.skipped),
      ignored: Number(row.ignored), deduped: Number(row.deduped),
    },
    errorCode: row.error_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new GmailReplySyncControlError(`${label} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function identityFor(actor) {
  const mailboxActor = String(actor || "").trim();
  const grantOwner = MAILBOXES[mailboxActor];
  if (!grantOwner) throw new Error("staff actor does not have an Amari mailbox");
  return Object.freeze({ mailboxActor, grantOwner });
}

function readModel(identity, row) {
  return {
    ...identity,
    state: row?.state || "baseline_required",
    killSwitchEngaged: row ? Boolean(row.kill_switch_engaged) : true,
    baselineHistoryId: row?.baseline_history_id || null,
    revision: Number(row?.revision || 0),
    lease: row?.lease_run_id ? {
      runId: row.lease_run_id,
      cursorBefore: row.lease_cursor_before,
      startedAt: row.lease_started_at,
      expiresAt: row.lease_expires_at,
    } : null,
    updatedAt: row?.updated_at || null,
  };
}

export function createGmailReplySyncControl(db, signedActor) {
  if (!db) throw new Error("Gmail reply sync storage is unavailable");
  const identity = identityFor(signedActor);
  async function read() {
    const row = await db.prepare(
      `SELECT state, kill_switch_engaged, baseline_history_id,
              lease_run_id, lease_cursor_before, lease_started_at, lease_expires_at, revision, updated_at
         FROM gmail_reply_sync_controls
        WHERE mailbox_actor = ? AND grant_owner = ?`,
    ).bind(identity.mailboxActor, identity.grantOwner).first();
    return readModel(identity, row);
  }

  return Object.freeze({
    mailboxContext: identity,
    read,
    async recordBaseline(command) {
      exactCommand(command, ["operationId", "historyId", "observedAt"]);
      const op = operationId(command.operationId);
      const cursor = historyId(command.historyId);
      const at = timestamp(command.observedAt, "observedAt");
      const existing = await db.prepare(
        `SELECT event_type, control_revision, history_id, reason_code, occurred_at
           FROM gmail_reply_sync_control_events
          WHERE grant_owner = ? AND operation_id = ?`,
      ).bind(identity.grantOwner, op).first();
      if (existing) {
        if (existing.event_type !== "baseline_recorded" || existing.history_id !== cursor
          || existing.control_revision !== null || existing.reason_code !== null || existing.occurred_at !== at) {
          throw new GmailReplySyncControlError("operationId was already used for different evidence", "idempotency_conflict");
        }
        return { ...(await read()), deduped: true };
      }
      const current = await read();
      if (!new Set(["baseline_required", "recovery_required"]).has(current.state)) {
        throw new GmailReplySyncControlError("mailbox is not awaiting a baseline", "invalid_state_transition");
      }
      if (current.state === "recovery_required") {
        const latest = await db.prepare(
          `SELECT history_id FROM gmail_history_observations
            WHERE mailbox_actor = ? AND grant_owner = ? AND mailbox_address = ?
            ORDER BY length(history_id) DESC, history_id DESC LIMIT 1`,
        ).bind(identity.mailboxActor, identity.grantOwner, identity.grantOwner).first();
        if (!latest?.history_id) {
          throw new GmailReplySyncControlError("recovery cursor evidence is missing", "recovery_cursor_missing");
        }
        let prior;
        try { prior = historyId(latest.history_id); }
        catch { throw new GmailReplySyncControlError("recovery cursor evidence is invalid", "recovery_cursor_invalid"); }
        if (BigInt(cursor) <= BigInt(prior)) {
          throw new GmailReplySyncControlError("recovery baseline must advance beyond the stale cursor", "stale_recovery_baseline");
        }
      }
      const eventId = `gmail-reply-control:${identity.mailboxActor}:${op}`;
      await db.batch([
        db.prepare(
          `INSERT INTO gmail_history_observations
           (id, mailbox_actor, grant_owner, mailbox_address, history_id, observed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(`gmail-reply-baseline:${identity.mailboxActor}:${op}`, identity.mailboxActor,
          identity.grantOwner, identity.grantOwner, cursor, at, at),
        db.prepare(
          `INSERT INTO gmail_reply_sync_control_events
           (id, mailbox_actor, grant_owner, operation_id, event_type, control_revision, history_id, reason_code, occurred_at, created_at)
           VALUES (?, ?, ?, ?, 'baseline_recorded', NULL, ?, NULL, ?, ?)`,
        ).bind(eventId, identity.mailboxActor, identity.grantOwner, op, cursor, at, at),
        db.prepare(
          `INSERT INTO gmail_reply_sync_controls
           (mailbox_actor, grant_owner, state, kill_switch_engaged, baseline_history_id, revision, updated_at)
           VALUES (?, ?, 'baselined', 1, ?, 1, ?)
           ON CONFLICT(mailbox_actor) DO UPDATE SET
             state = 'baselined', kill_switch_engaged = 1,
             baseline_history_id = excluded.baseline_history_id,
             lease_run_id = NULL, lease_cursor_before = NULL,
             lease_started_at = NULL, lease_expires_at = NULL,
             revision = gmail_reply_sync_controls.revision + 1,
             updated_at = excluded.updated_at
           WHERE gmail_reply_sync_controls.grant_owner = excluded.grant_owner
             AND gmail_reply_sync_controls.state IN ('baseline_required', 'recovery_required')`,
        ).bind(identity.mailboxActor, identity.grantOwner, cursor, at),
      ]);
      return { ...(await read()), deduped: false };
    },
    async enable(command) {
      exactCommand(command, ["operationId", "expectedRevision", "occurredAt"]);
      const op = operationId(command.operationId);
      if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
        throw new GmailReplySyncControlError("expectedRevision must be a positive integer");
      }
      const at = timestamp(command.occurredAt, "occurredAt");
      const existing = await db.prepare(
        `SELECT event_type, control_revision, history_id, reason_code, occurred_at
           FROM gmail_reply_sync_control_events
          WHERE grant_owner = ? AND operation_id = ?`,
      ).bind(identity.grantOwner, op).first();
      if (existing) {
        if (existing.event_type !== "enabled" || existing.history_id !== null
          || Number(existing.control_revision) !== command.expectedRevision
          || existing.reason_code !== null || existing.occurred_at !== at) {
          throw new GmailReplySyncControlError("operationId was already used for different evidence", "idempotency_conflict");
        }
        return { ...(await read()), deduped: true };
      }
      const current = await read();
      if (current.state !== "baselined" || !current.killSwitchEngaged) {
        throw new GmailReplySyncControlError("mailbox must be baselined before enablement", "invalid_state_transition");
      }
      if (current.revision !== command.expectedRevision) {
        throw new GmailReplySyncControlError("mailbox control revision changed", "stale_control_revision");
      }
      await db.batch([
        db.prepare(
          `INSERT INTO gmail_reply_sync_control_events
           (id, mailbox_actor, grant_owner, operation_id, event_type, control_revision, history_id, reason_code, occurred_at, created_at)
           VALUES (?, ?, ?, ?, 'enabled', ?, NULL, NULL, ?, ?)`,
        ).bind(`gmail-reply-control:${identity.mailboxActor}:${op}`, identity.mailboxActor,
          identity.grantOwner, op, command.expectedRevision, at, at),
        db.prepare(
          `UPDATE gmail_reply_sync_controls
              SET state = 'enabled', kill_switch_engaged = 0, revision = revision + 1, updated_at = ?
            WHERE mailbox_actor = ? AND grant_owner = ?
              AND state = 'baselined' AND kill_switch_engaged = 1 AND revision = ?`,
        ).bind(at, identity.mailboxActor, identity.grantOwner, command.expectedRevision),
      ]);
      return { ...(await read()), deduped: false };
    },
    async disable(command) {
      exactCommand(command, ["operationId", "reasonCode", "occurredAt"]);
      const op = operationId(command.operationId);
      const reason = reasonCode(command.reasonCode);
      const at = timestamp(command.occurredAt, "occurredAt");
      const existing = await db.prepare(
        `SELECT event_type, control_revision, history_id, reason_code, occurred_at
           FROM gmail_reply_sync_control_events
          WHERE grant_owner = ? AND operation_id = ?`,
      ).bind(identity.grantOwner, op).first();
      if (existing) {
        if (existing.event_type !== "disabled" || existing.history_id !== null
          || existing.control_revision !== null || existing.reason_code !== reason || existing.occurred_at !== at) {
          throw new GmailReplySyncControlError("operationId was already used for different evidence", "idempotency_conflict");
        }
        return { ...(await read()), deduped: true };
      }
      await db.batch([
        db.prepare(
          `INSERT INTO gmail_reply_sync_control_events
           (id, mailbox_actor, grant_owner, operation_id, event_type, control_revision, history_id, reason_code, occurred_at, created_at)
           VALUES (?, ?, ?, ?, 'disabled', NULL, NULL, ?, ?, ?)`,
        ).bind(`gmail-reply-control:${identity.mailboxActor}:${op}`, identity.mailboxActor,
          identity.grantOwner, op, reason, at, at),
        db.prepare(
          `INSERT INTO gmail_reply_sync_controls
           (mailbox_actor, grant_owner, state, kill_switch_engaged, baseline_history_id, updated_at)
           VALUES (?, ?, 'baseline_required', 1, NULL, ?)
           ON CONFLICT(mailbox_actor) DO UPDATE SET
             state = CASE
                       WHEN gmail_reply_sync_controls.state = 'recovery_required' THEN 'recovery_required'
                       WHEN gmail_reply_sync_controls.baseline_history_id IS NULL THEN 'baseline_required'
                       ELSE 'baselined'
                     END,
             kill_switch_engaged = 1,
             lease_run_id = NULL, lease_cursor_before = NULL,
             lease_started_at = NULL, lease_expires_at = NULL,
             revision = gmail_reply_sync_controls.revision + 1,
             updated_at = excluded.updated_at
           WHERE gmail_reply_sync_controls.grant_owner = excluded.grant_owner`,
        ).bind(identity.mailboxActor, identity.grantOwner, at),
      ]);
      return { ...(await read()), deduped: false };
    },
    async claimRun(command) {
      exactCommand(command, ["runId", "startedAt", "leaseSeconds"]);
      const id = runId(command.runId);
      const startedAt = timestamp(command.startedAt, "startedAt");
      const seconds = leaseDuration(command.leaseSeconds);
      const expiresAt = new Date(Date.parse(startedAt) + (seconds * 1000)).toISOString();
      const current = await read();
      if (current.state !== "enabled" || current.killSwitchEngaged) {
        return { claimed: false, reason: "kill_switch_engaged", ...current };
      }
      if (current.lease?.runId === id && current.lease.expiresAt > startedAt) {
        return { claimed: true, deduped: true, runId: id, lease: current.lease };
      }
      const claimed = await db.prepare(
        `UPDATE gmail_reply_sync_controls
            SET lease_run_id = ?,
                lease_cursor_before = (
                  SELECT observation.history_id FROM gmail_history_observations observation
                   WHERE observation.mailbox_actor = gmail_reply_sync_controls.mailbox_actor
                     AND observation.grant_owner = gmail_reply_sync_controls.grant_owner
                     AND observation.mailbox_address = gmail_reply_sync_controls.grant_owner
                   ORDER BY length(observation.history_id) DESC, observation.history_id DESC LIMIT 1
                ),
                lease_started_at = ?, lease_expires_at = ?, updated_at = ?
          WHERE mailbox_actor = ? AND grant_owner = ?
            AND state = 'enabled' AND kill_switch_engaged = 0
            AND (lease_run_id IS NULL OR lease_expires_at <= ?)
            AND EXISTS (
              SELECT 1 FROM gmail_history_observations observation
               WHERE observation.mailbox_actor = gmail_reply_sync_controls.mailbox_actor
                 AND observation.grant_owner = gmail_reply_sync_controls.grant_owner
                 AND observation.mailbox_address = gmail_reply_sync_controls.grant_owner
            )
          RETURNING lease_run_id, lease_cursor_before, lease_started_at, lease_expires_at`,
      ).bind(id, startedAt, expiresAt, startedAt, identity.mailboxActor, identity.grantOwner, startedAt).first();
      if (!claimed) return { claimed: false, reason: "lease_held", ...(await read()) };
      return {
        claimed: true,
        deduped: false,
        runId: id,
        lease: {
          runId: claimed.lease_run_id,
          cursorBefore: claimed.lease_cursor_before,
          startedAt: claimed.lease_started_at,
          expiresAt: claimed.lease_expires_at,
        },
      };
    },
    async completeRun(command) {
      exactCommand(command, ["runId", "outcome", "cursorBefore", "cursorAfter", "counts", "errorCode", "finishedAt"]);
      const id = runId(command.runId);
      const runOutcome = outcome(command.outcome);
      const cursorBefore = historyId(command.cursorBefore);
      const cursorAfter = optionalHistoryId(command.cursorAfter, "cursorAfter");
      if ((runOutcome === "succeeded" || runOutcome === "partial") && !cursorAfter) {
        throw new GmailReplySyncControlError("cursorAfter is required for a successful or partial run");
      }
      const counts = runCounts(command.counts);
      const errorCode = optionalErrorCode(command.errorCode, runOutcome);
      const finishedAt = timestamp(command.finishedAt, "finishedAt");
      const existing = await db.prepare(
        `SELECT mailbox_actor, grant_owner, run_id, outcome, cursor_before, cursor_after,
                history_records, messages, accepted, reviewed, skipped, ignored, deduped,
                error_code, started_at, finished_at
           FROM gmail_reply_sync_runs WHERE grant_owner = ? AND run_id = ?`,
      ).bind(identity.grantOwner, id).first();
      if (existing) {
        const prior = runReadModel(existing);
        if (prior.outcome !== runOutcome || prior.cursorBefore !== cursorBefore
          || prior.cursorAfter !== cursorAfter || prior.errorCode !== errorCode
          || prior.finishedAt !== finishedAt
          || COUNT_FIELDS.some((field) => prior.counts[field] !== counts[field])) {
          throw new GmailReplySyncControlError("runId was already used for different evidence", "idempotency_conflict");
        }
        return { ...prior, deduped: true };
      }
      const current = await read();
      if (current.state !== "enabled" || current.killSwitchEngaged || current.lease?.runId !== id) {
        throw new GmailReplySyncControlError("run does not own the active mailbox lease", "lease_not_owned");
      }
      if (cursorBefore !== current.lease.cursorBefore) {
        throw new GmailReplySyncControlError("run cursorBefore does not match its pinned lease", "cursor_before_mismatch");
      }
      if (current.lease.expiresAt < finishedAt) {
        throw new GmailReplySyncControlError("run lease expired before completion", "lease_expired");
      }
      const latest = await db.prepare(
        `SELECT history_id FROM gmail_history_observations
          WHERE mailbox_actor = ? AND grant_owner = ? AND mailbox_address = ?
          ORDER BY length(history_id) DESC, history_id DESC LIMIT 1`,
      ).bind(identity.mailboxActor, identity.grantOwner, identity.grantOwner).first();
      if (!latest?.history_id) {
        throw new GmailReplySyncControlError("run checkpoint evidence is missing", "run_checkpoint_missing");
      }
      let latestCursor;
      try { latestCursor = historyId(latest.history_id); }
      catch { throw new GmailReplySyncControlError("run checkpoint evidence is invalid", "run_checkpoint_invalid"); }
      if (BigInt(latestCursor) < BigInt(cursorBefore)) {
        throw new GmailReplySyncControlError("committed Gmail checkpoint regressed", "committed_cursor_regression");
      }
      if (cursorAfter == null && latestCursor !== cursorBefore) {
        throw new GmailReplySyncControlError("cursorAfter is required for committed partial progress", "cursor_after_required");
      }
      if (cursorAfter != null && BigInt(cursorAfter) < BigInt(cursorBefore)) {
        throw new GmailReplySyncControlError("cursorAfter cannot regress before cursorBefore", "cursor_after_regression");
      }
      if (cursorAfter != null && cursorAfter !== latestCursor) {
        throw new GmailReplySyncControlError("cursorAfter is not the latest committed checkpoint", "cursor_after_not_latest");
      }
      await db.batch([
        db.prepare(
          `INSERT INTO gmail_reply_sync_runs
           (id, mailbox_actor, grant_owner, run_id, outcome, cursor_before, cursor_after,
            history_records, messages, accepted, reviewed, skipped, ignored, deduped,
            error_code, started_at, finished_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(`gmail-reply-run:${identity.mailboxActor}:${id}`, identity.mailboxActor, identity.grantOwner,
          id, runOutcome, cursorBefore, cursorAfter, counts.historyRecords, counts.messages, counts.accepted,
          counts.reviewed, counts.skipped, counts.ignored, counts.deduped, errorCode,
          current.lease.startedAt, finishedAt, finishedAt),
        db.prepare(
          `UPDATE gmail_reply_sync_controls
              SET state = CASE WHEN ? = 'recovery_required' THEN 'recovery_required' ELSE state END,
                  kill_switch_engaged = CASE WHEN ? = 'recovery_required' THEN 1 ELSE kill_switch_engaged END,
                  lease_run_id = NULL, lease_cursor_before = NULL,
                  lease_started_at = NULL, lease_expires_at = NULL,
                  revision = CASE WHEN ? = 'recovery_required' THEN revision + 1 ELSE revision END,
                  updated_at = ?
            WHERE mailbox_actor = ? AND grant_owner = ? AND lease_run_id = ?`,
        ).bind(runOutcome, runOutcome, runOutcome, finishedAt, identity.mailboxActor, identity.grantOwner, id),
      ]);
      return { ...runReadModel({
        mailbox_actor: identity.mailboxActor, grant_owner: identity.grantOwner,
        run_id: id, outcome: runOutcome, cursor_before: cursorBefore, cursor_after: cursorAfter,
        history_records: counts.historyRecords, messages: counts.messages, accepted: counts.accepted,
        reviewed: counts.reviewed, skipped: counts.skipped, ignored: counts.ignored, deduped: counts.deduped,
        error_code: errorCode, started_at: current.lease.startedAt, finished_at: finishedAt,
      }), deduped: false };
    },
    async recentRuns(limit = 10) {
      const parsed = Number(limit);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
        throw new GmailReplySyncControlError("run limit must be between 1 and 50");
      }
      const rows = await db.prepare(
        `SELECT mailbox_actor, grant_owner, run_id, outcome, cursor_before, cursor_after,
                history_records, messages, accepted, reviewed, skipped, ignored, deduped,
                error_code, started_at, finished_at
           FROM gmail_reply_sync_runs
          WHERE mailbox_actor = ? AND grant_owner = ?
          ORDER BY finished_at DESC, id DESC LIMIT ?`,
      ).bind(identity.mailboxActor, identity.grantOwner, parsed).all();
      return (rows.results || []).map(runReadModel);
    },
  });
}
