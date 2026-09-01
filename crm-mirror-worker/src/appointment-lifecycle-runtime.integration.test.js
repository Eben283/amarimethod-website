import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { NO_SHOW_RECOVERY_RELEASE_WORKFLOW, NO_SHOW_RECOVERY_WORKFLOW } from "../../reminder-engine-worker/src/no-show-recovery-workflow.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUTH = "synthetic-runtime-proof-secret";
const WEBHOOK_SECRET = "synthetic-runtime-webhook-secret";
const CONTACT_ID = "synthetic-partner-contact";
const PROVIDER_CONTACT_ID = "synthetic-ghl-contact";
const PROVIDER_APPOINTMENT_ID = "synthetic-ghl-appointment";
const PARTNER_CALENDAR_ID = "lfsnaiGiLNL2z12pLKDP";
const PARTNER_FLOW = "partner-initial-in-person";
const NO_SHOW_FLOW = "no-show-recovery";
const instances = new Set();
let scripts;
let egress = 0;

const BRIDGE = `export default { fetch(request, env) { return env.CRM.fetch(request); } };`;
const OWNED_SMS = `export default { async fetch(request) {
  const body = await request.json();
  if (request.headers.get("Authorization") !== "Bearer ${AUTH}"
      || !/^\\+[1-9][0-9]{7,14}$/.test(body?.to || "")
      || !body?.text || !body?.idempotencyKey) {
    return Response.json({ success: false }, { status: 400 });
  }
  return Response.json({ success: true, messageId: "synthetic-owned-sms:" + body.to });
} };`;

async function bundle(entryPoint) {
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
    sourcemap: false,
    minify: false,
  });
  expect(result.warnings).toEqual([]);
  expect(result.outputFiles).toHaveLength(1);
  return result.outputFiles[0].text;
}

function splitSql(sql) {
  const tokens = [];
  let index = 0;
  while (index < sql.length) {
    if (/\s/.test(sql[index])) { index += 1; continue; }
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw new Error("unterminated SQL comment");
      index = end + 2;
      continue;
    }
    const start = index;
    const opening = sql[index];
    if (["'", "\"", "`", "["].includes(opening)) {
      const closing = opening === "[" ? "]" : opening;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === closing) {
          index += 1;
          if (sql[index] === closing) { index += 1; continue; }
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error("unterminated SQL quote");
      tokens.push({ value: sql.slice(start, index), upper: "", start, end: index });
      continue;
    }
    if (/[A-Za-z_]/.test(opening)) {
      while (index < sql.length && /[A-Za-z_0-9]/.test(sql[index])) index += 1;
    } else {
      index += 1;
    }
    const value = sql.slice(start, index);
    tokens.push({ value, upper: value.toUpperCase(), start, end: index });
  }

  const statements = [];
  let current = [];
  let parens = 0;
  let trigger = false;
  let triggerBody = false;
  let triggerEnded = false;
  let cases = 0;
  for (const token of tokens) {
    current.push(token);
    if (current.length === 2) trigger = current[0].upper === "CREATE" && current[1].upper === "TRIGGER";
    if (token.value === "(") parens += 1;
    if (token.value === ")") parens -= 1;
    if (parens < 0) throw new Error("unbalanced SQL parentheses");
    if (trigger && token.upper === "BEGIN" && !triggerBody) triggerBody = true;
    else if (triggerBody && token.upper === "CASE") cases += 1;
    else if (triggerBody && token.upper === "END") {
      if (cases > 0) cases -= 1;
      else triggerEnded = true;
    }
    if (token.value === ";" && parens === 0 && (!trigger || triggerEnded)) {
      statements.push(sql.slice(current[0].start, token.end));
      current = [];
      parens = 0;
      trigger = false;
      triggerBody = false;
      triggerEnded = false;
      cases = 0;
    }
  }
  if (current.length || parens || triggerBody) throw new Error("incomplete SQL statement");
  return statements;
}

async function applySql(db, sql) {
  const statements = splitSql(sql);
  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50).map((statement) => db.prepare(statement)));
  }
}

async function applyCrmSchema(db) {
  const directory = join(ROOT, "crm-mirror-worker/migrations");
  const names = readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  expect(names.at(-1)).toBe("0025_appointment_recovery_requests.sql");
  for (const name of names) {
    const sql = readFileSync(join(directory, name), "utf8");
    await applySql(db, sql);
  }
}

async function startRuntime() {
  const base = {
    modules: true,
    compatibilityDate: "2026-08-27",
    compatibilityFlags: ["nodejs_compat"],
    outboundService: () => {
      egress += 1;
      return new Response("external network forbidden in synthetic runtime proof", { status: 403 });
    },
  };
  const mf = new Miniflare({
    ...convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      workers: [
        {
          ...base,
          name: "bridge",
          script: BRIDGE,
          serviceBindings: { CRM: "crm" },
        },
        {
          ...base,
          name: "crm",
          script: scripts.crm,
          // Deliberately no GHL credential or location binding. Provider edges
          // are checkpointed inputs to this owned runtime, never hidden calls.
          bindings: { WORKER_AUTH_SECRET: AUTH },
          d1Databases: { CRM_DB: "crm-db", AUTOMATION_DB: "automation-db" },
          kvNamespaces: ["PORTAL_KV"],
          serviceBindings: { REMINDER: "reminder" },
        },
        {
          ...base,
          name: "reminder",
          script: scripts.reminder,
          bindings: {
            WORKER_AUTH_SECRET: AUTH,
            GHL_APPOINTMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
            NO_SHOW_BEHAVIOR_RELEASE: "approved",
            NO_SHOW_DELIVERY_RELEASE: "approved",
            APPOINTMENT_MANAGE_LINK_SECRET: "appointment-manage-link-secret-at-least-32-characters",
            AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "synthetic-client",
            AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-secret",
          },
          d1Databases: { REMINDER_DB: "reminder-db", CRM_DB: "crm-db" },
          kvNamespaces: ["PORTAL_KV"],
          serviceBindings: { OWNED_SMS: "owned-sms" },
        },
        {
          ...base,
          name: "owned-sms",
          script: OWNED_SMS,
        },
      ],
    }),
  });
  instances.add(mf);
  await mf.ready;
  const crmDb = await mf.getD1Database("CRM_DB", "crm");
  const reminderDb = await mf.getD1Database("REMINDER_DB", "reminder");
  await applyCrmSchema(crmDb);
  await applySql(reminderDb, readFileSync(join(ROOT, "reminder-engine-worker/schema.sql"), "utf8"));
  return { mf, crmDb, reminderDb };
}

async function request(mf, pathname, { method = "GET", body } = {}) {
  const response = await mf.dispatchFetch(`http://runtime.test${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${AUTH}`,
      "Content-Type": "application/json",
      "X-Staff-Actor": "Garrett",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  expect(response.status, JSON.stringify(payload)).toBeLessThan(300);
  return payload;
}

async function ghlWebhook(mf, body) {
  const reminder = await mf.getWorker("reminder");
  const response = await reminder.fetch("http://reminder.test/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  expect(response.status, JSON.stringify(payload)).toBeLessThan(300);
  return payload;
}

beforeAll(async () => {
  scripts = {
    crm: await bundle("crm-mirror-worker/src/index.js"),
    reminder: await bundle("reminder-engine-worker/src/index.js"),
  };
}, 30_000);

afterEach(async () => {
  for (const mf of instances) await mf.dispose();
  instances.clear();
  expect(egress).toBe(0);
  egress = 0;
}, 30_000);

describe("owned Partner Initial lifecycle native runtime", () => {
  it("runs command capture through the real CRM Worker and service-bound shadow enrollment exactly once", async () => {
    const { mf, crmDb, reminderDb } = await startRuntime();
    const now = Date.now();
    const startAt = new Date(now + 7 * 86_400_000).toISOString();
    const recordedAt = new Date(now).toISOString();
    await crmDb.batch([
      crmDb.prepare(
        `INSERT INTO contacts (id, display_name, created_at, updated_at)
         VALUES (?, 'Synthetic Partner — Runtime Proof', ?, ?)`,
      ).bind(CONTACT_ID, recordedAt, recordedAt),
      crmDb.prepare(
        `INSERT INTO external_records
           (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         VALUES ('synthetic-contact-crosswalk', 'ghl', 'contact', ?, ?, 'contact', ?, ?)`,
      ).bind(PROVIDER_CONTACT_ID, CONTACT_ID, CONTACT_ID, recordedAt),
    ]);

    const capture = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "schedule",
        contactId: CONTACT_ID,
        serviceId: "partner-initial",
        idempotencyKey: "synthetic-partner-runtime-proof-v1",
        startTime: startAt,
        timezone: "America/Los_Angeles",
      },
    });
    const commandId = capture.appointment.commandId;
    const appointmentId = capture.appointment.appointmentId;
    expect(capture.appointment).toMatchObject({
      contactId: CONTACT_ID,
      serviceId: "partner-initial",
      startsAt: startAt,
      authority: "owned",
      providerSyncState: "pending",
      commandState: "accepted",
    });

    await request(mf, "/appointments/commands", {
      method: "POST",
      body: { action: "claim", commandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "provider-link",
        commandId,
        provider: "ghl",
        providerRecordId: PROVIDER_APPOINTMENT_ID,
        providerCalendarId: PARTNER_CALENDAR_ID,
        providerStatusRaw: "confirmed",
      },
    });
    const completion = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete",
        commandId,
        result: {
          action: "schedule",
          actor: "Garrett",
          contactId: CONTACT_ID,
          appointmentId,
          providerAppointmentId: PROVIDER_APPOINTMENT_ID,
          newStartTime: startAt,
          appointmentStatus: "confirmed",
          reminderVerification: "pending_event_evidence",
          authority: "owned",
        },
      },
    });
    expect(completion.execution).toMatchObject({
      commandId,
      appointmentId,
      state: "completed",
      provider: "ghl",
      providerRecordId: PROVIDER_APPOINTMENT_ID,
    });

    const beforeDispatch = await crmDb.prepare(
      "SELECT state, attempts FROM appointment_lifecycle_dispatches WHERE command_id = ?",
    ).bind(commandId).first();
    expect(beforeDispatch).toEqual({ state: "pending", attempts: 0 });
    expect(await reminderDb.prepare("SELECT COUNT(*) AS count FROM reminder_enrollments").first())
      .toEqual({ count: 0 });

    const firstSync = await request(mf, "/sync", {
      method: "POST",
      body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(firstSync.results.ownedAppointmentLifecycles).toEqual({
      status: "succeeded",
      considered: 1,
      dispatched: 1,
      retryable: 0,
      manualReview: 0,
    });

    const enrollmentId = `${PARTNER_FLOW}:${PROVIDER_APPOINTMENT_ID}`;
    expect(await reminderDb.prepare(
      `SELECT enrollment_id, flow_key, definition_version, appointment_id, contact_id,
              calendar_id, start_at, status
         FROM reminder_enrollments WHERE enrollment_id = ?`,
    ).bind(enrollmentId).first()).toEqual({
      enrollment_id: enrollmentId,
      flow_key: PARTNER_FLOW,
      definition_version: 4,
      appointment_id: PROVIDER_APPOINTMENT_ID,
      contact_id: PROVIDER_CONTACT_ID,
      calendar_id: PARTNER_CALENDAR_ID,
      start_at: startAt,
      status: "active",
    });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM reminder_steps WHERE enrollment_id = ?",
    ).bind(enrollmentId).first()).toEqual({ count: 6 });
    expect((await reminderDb.prepare(
      `SELECT action, outcome, engine, flow_key, appointment_id, contact_id
         FROM automation_events WHERE flow_key = ? ORDER BY id`,
    ).bind(PARTNER_FLOW).all()).results).toEqual([{
        action: "enrolled",
        outcome: "enrolled",
        engine: "reminder",
        flow_key: PARTNER_FLOW,
        appointment_id: PROVIDER_APPOINTMENT_ID,
        contact_id: PROVIDER_CONTACT_ID,
      }]);

    const partnerQueue = (await reminderDb.prepare(
      "SELECT step_index, due_at, status FROM reminder_steps WHERE enrollment_id = ? ORDER BY step_index",
    ).bind(enrollmentId).all()).results;
    const providerReplay = await ghlWebhook(mf, {
      appointment: {
        id: PROVIDER_APPOINTMENT_ID,
        calendarId: PARTNER_CALENDAR_ID,
        contactId: PROVIDER_CONTACT_ID,
        startTime: startAt,
        appointmentStatus: "confirmed",
        modifiedBy: "user",
      },
    });
    expect(providerReplay.actions).toContainEqual({
      engine: "reminder", action: "enroll-noop", detail: { flowKey: PARTNER_FLOW },
    });
    expect((await reminderDb.prepare(
      "SELECT step_index, due_at, status FROM reminder_steps WHERE enrollment_id = ? ORDER BY step_index",
    ).bind(enrollmentId).all()).results).toEqual(partnerQueue);

    const secondSync = await request(mf, "/sync", {
      method: "POST",
      body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(secondSync.results.ownedAppointmentLifecycles).toMatchObject({ considered: 0, dispatched: 0 });
    expect(await reminderDb.prepare("SELECT COUNT(*) AS count FROM reminder_enrollments").first())
      .toEqual({ count: 1 });

    const readiness = await request(mf, "/appointments/readiness");
    expect(readiness.lifecycleDispatch).toEqual({
      configured: true,
      state: "ready",
      blocking: 0,
      counts: { pending: 0, executing: 0, retryable: 0, dispatched: 1, manual_review: 0 },
      shadowOnly: true,
      deliveryEnabled: false,
    });
    expect(await crmDb.prepare(
      "SELECT state, attempts, last_error FROM appointment_lifecycle_dispatches WHERE command_id = ?",
    ).bind(commandId).first()).toEqual({ state: "dispatched", attempts: 1, last_error: null });

  }, 30_000);

  it("exits a legacy GHL No Show recovery by exact owned identity when the partner rebooks on Google", async () => {
    const { mf, crmDb, reminderDb } = await startRuntime();
    const now = Date.now();
    const recordedAt = new Date(now).toISOString();
    const startAt = new Date(now + 8 * 86_400_000).toISOString();
    const googleEventId = "synthetic-google-rebooking";
    const googleCalendarId = "synthetic-garrett@group.calendar.google.com";
    await crmDb.batch([
      crmDb.prepare(
        `INSERT INTO contacts (id, display_name, created_at, updated_at)
         VALUES (?, 'Synthetic Partner — Cross-provider Exit', ?, ?)`,
      ).bind(CONTACT_ID, recordedAt, recordedAt),
      crmDb.prepare(
        `INSERT INTO external_records
           (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         VALUES ('synthetic-exit-contact-crosswalk', 'ghl', 'contact', ?, ?, 'contact', ?, ?)`,
      ).bind(PROVIDER_CONTACT_ID, CONTACT_ID, CONTACT_ID, recordedAt),
    ]);
    await reminderDb.prepare(
      `INSERT INTO workflow_versions
         (workflow_id, version, state, document, created_at, published_at)
       VALUES (?, ?, 'published', ?, ?, ?)`,
    ).bind(
      NO_SHOW_FLOW, NO_SHOW_RECOVERY_WORKFLOW.version,
      JSON.stringify(NO_SHOW_RECOVERY_WORKFLOW), now, now,
    ).run();

    const reminder = await mf.getWorker("reminder");
    const reminderEvent = async (event) => {
      const response = await reminder.fetch("http://reminder.test/event", {
        method: "POST",
        headers: { Authorization: `Bearer ${AUTH}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      return body;
    };
    const missed = (contactId, appointmentId) => ({
      recognized: true, type: "noshow", status: "no-show", appointmentEventType: "normal",
      calendarId: PARTNER_CALENDAR_ID, contactId, appointmentId,
      startAt: new Date(now - 60 * 60_000).toISOString(), modifiedBy: "user",
      context: { affiliatePartner: "false" },
    });
    expect((await reminderEvent(missed(PROVIDER_CONTACT_ID, "legacy-ghl-no-show"))).actions)
      .toContainEqual({ engine: "reminder", action: "enroll", detail: { flowKey: NO_SHOW_FLOW } });
    expect((await reminderEvent(missed("unrelated-ghl-contact", "unrelated-no-show"))).actions)
      .toContainEqual({ engine: "reminder", action: "enroll", detail: { flowKey: NO_SHOW_FLOW } });

    const sweep = await reminder.fetch("http://reminder.test/run", {
      method: "POST", headers: { Authorization: `Bearer ${AUTH}` },
    });
    expect(sweep.status).toBe(200);
    expect(await reminderDb.prepare(
      `SELECT status FROM reminder_steps
        WHERE enrollment_id = ? AND step_index = 0`,
    ).bind(`${NO_SHOW_FLOW}:legacy-ghl-no-show`).first()).toEqual({ status: "would_send" });

    const capture = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "schedule", contactId: CONTACT_ID, serviceId: "partner-initial",
        idempotencyKey: "synthetic-cross-provider-exit-v1",
        startTime: startAt, timezone: "America/Los_Angeles",
      },
    });
    const commandId = capture.appointment.commandId;
    const appointmentId = capture.appointment.appointmentId;
    await request(mf, "/appointments/commands", {
      method: "POST", body: { action: "claim", commandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "provider-link", commandId, provider: "google_calendar",
        providerRecordId: googleEventId, providerCalendarId: googleCalendarId,
        providerStatusRaw: "confirmed",
      },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete", commandId,
        result: {
          action: "schedule", actor: "Garrett", contactId: CONTACT_ID,
          appointmentId, providerAppointmentId: googleEventId,
          newStartTime: startAt, appointmentStatus: "confirmed",
          reminderVerification: "pending_event_evidence", authority: "owned",
        },
      },
    });
    const sync = await request(mf, "/sync", {
      method: "POST", body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(sync.results.ownedAppointmentLifecycles).toMatchObject({
      status: "succeeded", considered: 1, dispatched: 1, retryable: 0, manualReview: 0,
    });

    expect(await reminderDb.prepare(
      "SELECT status FROM reminder_enrollments WHERE enrollment_id = ?",
    ).bind(`${NO_SHOW_FLOW}:legacy-ghl-no-show`).first()).toEqual({ status: "cancelled" });
    expect((await reminderDb.prepare(
      "SELECT step_index, status FROM reminder_steps WHERE enrollment_id = ? ORDER BY step_index",
    ).bind(`${NO_SHOW_FLOW}:legacy-ghl-no-show`).all()).results).toEqual([
      { step_index: 0, status: "would_send" },
      { step_index: 1, status: "cancelled" },
      { step_index: 2, status: "cancelled" },
    ]);
    expect(await reminderDb.prepare(
      "SELECT status FROM reminder_enrollments WHERE enrollment_id = ?",
    ).bind(`${NO_SHOW_FLOW}:unrelated-no-show`).first()).toEqual({ status: "active" });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM reminder_steps WHERE enrollment_id = ? AND status = 'pending'",
    ).bind(`${NO_SHOW_FLOW}:unrelated-no-show`).first()).toEqual({ count: 2 });
    const exitEvent = await reminderDb.prepare(
      `SELECT id, contact_id, action, outcome, detail FROM automation_events
        WHERE flow_key = ? AND action = 'exited' ORDER BY id DESC LIMIT 1`,
    ).bind(NO_SHOW_FLOW).first();
    expect(exitEvent).toMatchObject({ contact_id: CONTACT_ID, action: "exited", outcome: "exited" });
    expect(JSON.parse(exitEvent.detail)).toEqual({
      reason: "confirmed_rebooking", identityScope: "owned_contact", aliasesMatched: 2,
      cancelledSteps: 2, exitedEnrollments: 1,
    });
    const partnerEnrollmentEvent = await reminderDb.prepare(
      `SELECT id FROM automation_events
        WHERE flow_key = ? AND action = 'enrolled' AND appointment_id = ?`,
    ).bind(PARTNER_FLOW, googleEventId).first();
    expect(Number(exitEvent.id)).toBeLessThan(Number(partnerEnrollmentEvent.id));

    const replay = await reminderEvent({
      recognized: true, type: "confirmed", status: "confirmed",
      calendarId: googleCalendarId, contactId: CONTACT_ID, appointmentId: googleEventId,
      startAt, modifiedBy: "user",
      context: {
        source: "owned_crm", commandId, ownedAppointmentId: appointmentId,
        ownedContactId: CONTACT_ID, serviceId: "partner-initial",
        provider: "google_calendar", providerAppointmentId: googleEventId,
        providerCalendarId: googleCalendarId, providerContactId: null,
      },
    });
    expect(replay.actions).toContainEqual({
      engine: "reminder", action: "enroll-noop", detail: { flowKey: PARTNER_FLOW },
    });
    expect(replay.actions.some((action) => action.action === "exit")).toBe(false);
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM automation_events WHERE flow_key = ? AND action = 'exited'",
    ).bind(NO_SHOW_FLOW).first()).toEqual({ count: 1 });
  }, 30_000);

  it("delivers an active affiliate no-show SMS from owned CRM through the provider-neutral edge with durable evidence", async () => {
    const { mf, crmDb, reminderDb } = await startRuntime();
    const now = Date.now();
    const recordedAt = new Date(now).toISOString();
    const appointmentId = "owned-no-show-appointment";
    const providerAppointmentId = "legacy-no-show-appointment";
    const providerContactId = "legacy-no-show-contact";
    const phone = "+14155550123";
    await crmDb.batch([
      crmDb.prepare(
        `INSERT INTO contacts
           (id, display_name, first_name, email_normalized, phone_e164, created_at, updated_at)
         VALUES (?, 'Synthetic Affiliate — Owned SMS', 'Avery', 'avery@example.test', ?, ?, ?)`,
      ).bind(CONTACT_ID, phone, recordedAt, recordedAt),
      crmDb.prepare(
        `INSERT INTO external_records
           (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         VALUES ('synthetic-owned-sms-contact-crosswalk', 'ghl', 'contact', ?, ?, 'contact', ?, ?)`,
      ).bind(providerContactId, CONTACT_ID, CONTACT_ID, recordedAt),
      crmDb.prepare(
        `INSERT INTO appointments
           (id, contact_id, service_id, provider_appointment_id, provider_calendar_id,
            provider_status_raw, status, starts_at, ends_at, timezone,
            authority, provider_sync_state, revision, created_at, updated_at)
         VALUES (?, ?, 'partner-initial', ?, ?, 'noshow', 'no_show', ?, ?,
                 'America/Los_Angeles', 'provider_mirror', 'synced', 1, ?, ?)`,
      ).bind(
        appointmentId, CONTACT_ID, providerAppointmentId, PARTNER_CALENDAR_ID,
        new Date(now - 60 * 60_000).toISOString(), new Date(now - 10 * 60_000).toISOString(),
        recordedAt, recordedAt,
      ),
    ]);
    const captureRecovery = () => mf.dispatchFetch("http://runtime.test/appointments/recovery-requests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH}`,
        "Content-Type": "application/json",
        "X-Staff-Actor": "Client",
      },
      body: JSON.stringify({
        appointmentId,
        contactId: CONTACT_ID,
        appointmentRevision: 1,
      }),
    });
    const firstRecovery = await captureRecovery();
    expect(firstRecovery.status).toBe(201);
    await expect(firstRecovery.json()).resolves.toMatchObject({
      request: { appointmentId, contactId: CONTACT_ID, state: "pending_review", deduped: false },
    });
    const replayRecovery = await captureRecovery();
    expect(replayRecovery.status).toBe(200);
    await expect(replayRecovery.json()).resolves.toMatchObject({
      request: { appointmentId, state: "pending_review", deduped: true },
    });
    const recoveryQueue = await mf.dispatchFetch("http://runtime.test/appointments/recovery-requests?limit=25", {
      headers: { Authorization: `Bearer ${AUTH}` },
    });
    expect(recoveryQueue.status).toBe(200);
    await expect(recoveryQueue.json()).resolves.toMatchObject({
      requests: [{ appointmentId, contactId: CONTACT_ID, state: "pending_review" }],
      truncated: false,
    });
    expect(await crmDb.prepare("SELECT COUNT(*) AS count FROM appointment_recovery_requests").first())
      .toEqual({ count: 1 });
    expect(await crmDb.prepare("SELECT COUNT(*) AS count FROM appointment_recovery_request_events").first())
      .toEqual({ count: 1 });
    expect(await crmDb.prepare("SELECT COUNT(*) AS count FROM appointment_authority_commands").first())
      .toEqual({ count: 0 });
    expect(await crmDb.prepare("SELECT COUNT(*) AS count FROM appointment_payment_records").first())
      .toEqual({ count: 0 });
    expect(await crmDb.prepare("SELECT COUNT(*) AS count FROM owned_communication_commands").first())
      .toEqual({ count: 0 });
    await reminderDb.prepare(
      `INSERT INTO workflow_versions
         (workflow_id, version, state, document, created_at, published_at)
       VALUES (?, ?, 'published', ?, ?, ?)`,
    ).bind(
      NO_SHOW_FLOW, NO_SHOW_RECOVERY_RELEASE_WORKFLOW.version,
      JSON.stringify(NO_SHOW_RECOVERY_RELEASE_WORKFLOW), now, now,
    ).run();

    const reminder = await mf.getWorker("reminder");
    const eventResponse = await reminder.fetch("http://reminder.test/event", {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recognized: true, type: "noshow", status: "no-show", appointmentEventType: "normal",
        calendarId: PARTNER_CALENDAR_ID, contactId: providerContactId,
        appointmentId: providerAppointmentId,
        startAt: new Date(now - 60 * 60_000).toISOString(), modifiedBy: "user",
        context: { affiliatePartner: "true" },
      }),
    });
    expect(eventResponse.status).toBe(200);
    expect((await eventResponse.json()).actions).toContainEqual({
      engine: "reminder", action: "enroll", detail: { flowKey: NO_SHOW_FLOW },
    });
    const runResponse = await reminder.fetch("http://reminder.test/run", {
      method: "POST", headers: { Authorization: `Bearer ${AUTH}` },
    });
    expect(runResponse.status).toBe(200);

    const enrollmentId = `${NO_SHOW_FLOW}:${providerAppointmentId}`;
    expect(await reminderDb.prepare(
      "SELECT status FROM reminder_steps WHERE enrollment_id = ? AND step_index = 0",
    ).bind(enrollmentId).first()).toEqual({ status: "sent" });
    expect(await reminderDb.prepare(
      `SELECT flow_key, enrollment_id, step_index, definition_version, channel, provider,
              state, provider_reference
         FROM owned_delivery_attempts WHERE enrollment_id = ?`,
    ).bind(enrollmentId).first()).toEqual({
      flow_key: NO_SHOW_FLOW,
      enrollment_id: enrollmentId,
      step_index: 0,
      definition_version: 4,
      channel: "sms",
      provider: "owned-sms",
      state: "accepted",
      provider_reference: `synthetic-owned-sms:${phone}`,
    });
    expect(await reminderDb.prepare(
      `SELECT COUNT(*) AS count FROM owned_delivery_receipts
        WHERE provider = 'owned-sms' AND provider_reference = ? AND proof_level = 'accepted'`,
    ).bind(`synthetic-owned-sms:${phone}`).first()).toEqual({ count: 1 });
    const event = await reminderDb.prepare(
      `SELECT outcome, channel, message_ref FROM automation_events
        WHERE flow_key = ? AND action = 'send' ORDER BY id DESC LIMIT 1`,
    ).bind(NO_SHOW_FLOW).first();
    expect(event).toEqual({
      outcome: "sent", channel: "sms", message_ref: `synthetic-owned-sms:${phone}`,
    });
  }, 30_000);

  it.each([
    ["discovery-call", "USgPsktqRcuomdUgpShL", "owned-first"],
    ["discovery-call-virtual", "ZEIGFHBi17SpZ3Ezi5DR", "provider-first"],
  ])("runs owned %s through the real CRM binding and deduplicates %s dual ingress", async (serviceId, calendarId, ingressOrder) => {
    const { mf, crmDb, reminderDb } = await startRuntime();
    const now = Date.now();
    const startAt = new Date(now + 7 * 86_400_000).toISOString();
    const recordedAt = new Date(now).toISOString();
    const providerAppointmentId = `synthetic-${serviceId}`;
    await crmDb.batch([
      crmDb.prepare(
        `INSERT INTO contacts (id, display_name, created_at, updated_at)
         VALUES (?, 'Synthetic Discovery — Runtime Proof', ?, ?)`,
      ).bind(CONTACT_ID, recordedAt, recordedAt),
      crmDb.prepare(
        `INSERT INTO external_records
           (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         VALUES ('synthetic-discovery-contact-crosswalk', 'ghl', 'contact', ?, ?, 'contact', ?, ?)`,
      ).bind(PROVIDER_CONTACT_ID, CONTACT_ID, CONTACT_ID, recordedAt),
    ]);

    const capture = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "schedule",
        contactId: CONTACT_ID,
        serviceId,
        idempotencyKey: `synthetic-${serviceId}-runtime-proof-v1`,
        startTime: startAt,
        timezone: "America/Los_Angeles",
      },
    });
    const commandId = capture.appointment.commandId;
    const appointmentId = capture.appointment.appointmentId;
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: { action: "claim", commandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "provider-link",
        commandId,
        provider: "ghl",
        providerRecordId: providerAppointmentId,
        providerCalendarId: calendarId,
        providerStatusRaw: "confirmed",
      },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete",
        commandId,
        result: {
          action: "schedule",
          actor: "Garrett",
          contactId: CONTACT_ID,
          appointmentId,
          providerAppointmentId,
          newStartTime: startAt,
          appointmentStatus: "confirmed",
          reminderVerification: "pending_event_evidence",
          authority: "owned",
        },
      },
    });

    expect(await crmDb.prepare(
      "SELECT state FROM appointment_lifecycle_dispatches WHERE command_id = ?",
    ).bind(commandId).first()).toEqual({ state: "pending" });
    const confirmedProviderEvent = {
      appointment: {
        id: providerAppointmentId,
        calendarId,
        contactId: PROVIDER_CONTACT_ID,
        startTime: startAt,
        appointmentStatus: "confirmed",
        modifiedBy: "user",
      },
    };
    if (ingressOrder === "provider-first") {
      expect((await ghlWebhook(mf, confirmedProviderEvent)).actions).toContainEqual({
        engine: "reminder", action: "enroll", detail: { flowKey: "discovery-call" },
      });
    }
    const sync = await request(mf, "/sync", {
      method: "POST",
      body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(sync.results.ownedAppointmentLifecycles).toMatchObject({
      status: "succeeded", considered: 1, dispatched: 1, manualReview: 0,
    });

    const enrollmentId = `discovery-call:${providerAppointmentId}`;
    expect(await reminderDb.prepare(
      `SELECT flow_key, appointment_id, contact_id, calendar_id, status
         FROM reminder_enrollments WHERE enrollment_id = ?`,
    ).bind(enrollmentId).first()).toEqual({
      flow_key: "discovery-call",
      appointment_id: providerAppointmentId,
      contact_id: PROVIDER_CONTACT_ID,
      calendar_id: calendarId,
      status: "active",
    });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM reminder_steps WHERE enrollment_id = ?",
    ).bind(enrollmentId).first()).toEqual({ count: 7 });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM automation_events WHERE flow_key = 'discovery-call' AND outcome = 'enrolled'",
    ).first()).toEqual({ count: 1 });
    expect(await crmDb.prepare(
      "SELECT state, attempts, last_error FROM appointment_lifecycle_dispatches WHERE command_id = ?",
    ).bind(commandId).first()).toEqual({ state: "dispatched", attempts: 1, last_error: null });

    const queueBeforeReplay = (await reminderDb.prepare(
      "SELECT step_index, due_at, status FROM reminder_steps WHERE enrollment_id = ? ORDER BY step_index",
    ).bind(enrollmentId).all()).results;
    const providerReplay = await ghlWebhook(mf, confirmedProviderEvent);
    expect(providerReplay.actions).toContainEqual({
      engine: "reminder", action: "enroll-noop", detail: { flowKey: "discovery-call" },
    });
    expect(await reminderDb.prepare("SELECT COUNT(*) AS count FROM reminder_enrollments").first())
      .toEqual({ count: 1 });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM reminder_steps WHERE enrollment_id = ?",
    ).bind(enrollmentId).first()).toEqual({ count: 7 });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM automation_events WHERE flow_key = 'discovery-call' AND outcome = 'enrolled'",
    ).first()).toEqual({ count: 1 });
    expect((await reminderDb.prepare(
      "SELECT step_index, due_at, status FROM reminder_steps WHERE enrollment_id = ? ORDER BY step_index",
    ).bind(enrollmentId).all()).results).toEqual(queueBeforeReplay);

    const cancellation = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "manage",
        manageAction: "cancel",
        contactId: CONTACT_ID,
        appointmentId,
        idempotencyKey: `synthetic-${serviceId}-cancel-runtime-proof-v1`,
      },
    });
    const cancellationCommandId = cancellation.command.commandId;
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: { action: "claim", commandId: cancellationCommandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete",
        commandId: cancellationCommandId,
        result: { action: "cancel", contactId: CONTACT_ID, appointmentStatus: "cancelled" },
      },
    });
    expect(await crmDb.prepare(
      "SELECT event_type, state FROM appointment_lifecycle_dispatches WHERE command_id = ?",
    ).bind(cancellationCommandId).first()).toEqual({ event_type: "cancelled", state: "pending" });

    const cancelledProviderEvent = {
      appointment: {
        id: providerAppointmentId,
        calendarId,
        contactId: PROVIDER_CONTACT_ID,
        startTime: startAt,
        appointmentStatus: "cancelled",
        modifiedBy: "user",
      },
    };
    if (ingressOrder === "provider-first") {
      expect((await ghlWebhook(mf, cancelledProviderEvent)).actions).toContainEqual({
        engine: "reminder", action: "cancel",
        detail: { flowKey: "discovery-call", cancelledSteps: 7 },
      });
    }

    const cancellationSync = await request(mf, "/sync", {
      method: "POST",
      body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(cancellationSync.results.ownedAppointmentLifecycles).toMatchObject({
      status: "succeeded", considered: 1, dispatched: 1,
    });
    expect(await reminderDb.prepare(
      "SELECT status FROM reminder_enrollments WHERE enrollment_id = ?",
    ).bind(enrollmentId).first()).toEqual({ status: "cancelled" });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM reminder_steps WHERE enrollment_id = ? AND status = 'pending'",
    ).bind(enrollmentId).first()).toEqual({ count: 0 });
    expect((await ghlWebhook(mf, cancelledProviderEvent)).actions).toContainEqual({
      engine: "reminder", action: "cancel",
      detail: { flowKey: "discovery-call", cancelledSteps: 0 },
    });
  }, 30_000);

  it("captures Partnership Discovery through the real CRM binding without dispatching the wrong lifecycle", async () => {
    const { mf, crmDb, reminderDb } = await startRuntime();
    const now = Date.now();
    const startAt = new Date(now + 7 * 86_400_000).toISOString();
    const recordedAt = new Date(now).toISOString();
    await crmDb.batch([
      crmDb.prepare(
        `INSERT INTO contacts (id, display_name, created_at, updated_at)
         VALUES (?, 'Synthetic Partnership Discovery', ?, ?)`,
      ).bind(CONTACT_ID, recordedAt, recordedAt),
      crmDb.prepare(
        `INSERT INTO external_records
           (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         VALUES ('synthetic-partnership-contact-crosswalk', 'ghl', 'contact', ?, ?, 'contact', ?, ?)`,
      ).bind(PROVIDER_CONTACT_ID, CONTACT_ID, CONTACT_ID, recordedAt),
    ]);

    const capture = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "schedule",
        contactId: CONTACT_ID,
        serviceId: "partnership-discovery",
        idempotencyKey: "synthetic-partnership-discovery-runtime-proof-v1",
        startTime: startAt,
        timezone: "America/Los_Angeles",
      },
    });
    const commandId = capture.appointment.commandId;
    const appointmentId = capture.appointment.appointmentId;
    await request(mf, "/appointments/commands", {
      method: "POST", body: { action: "claim", commandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "provider-link", commandId, provider: "ghl",
        providerRecordId: "synthetic-partnership-discovery-appointment",
        providerCalendarId: "aVE54Qf4lrbYTB0zFqXy",
        providerStatusRaw: "confirmed",
      },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete", commandId,
        result: {
          action: "schedule", actor: "Garrett", contactId: CONTACT_ID,
          appointmentId,
          providerAppointmentId: "synthetic-partnership-discovery-appointment",
          newStartTime: startAt, appointmentStatus: "confirmed",
          reminderVerification: "pending_event_evidence", authority: "owned",
        },
      },
    });

    expect(await crmDb.prepare(`
      SELECT service_id, provider_calendar_id, authority, provider_sync_state
        FROM appointments WHERE id = ?
    `).bind(appointmentId).first()).toEqual({
      service_id: "partnership-discovery",
      provider_calendar_id: "aVE54Qf4lrbYTB0zFqXy",
      authority: "owned",
      provider_sync_state: "synced",
    });
    expect(await crmDb.prepare(
      "SELECT COUNT(*) AS count FROM appointment_lifecycle_dispatches WHERE command_id = ?",
    ).bind(commandId).first()).toEqual({ count: 0 });
    const sync = await request(mf, "/sync", {
      method: "POST", body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(sync.results.ownedAppointmentLifecycles).toMatchObject({ considered: 0, dispatched: 0 });
    expect(await reminderDb.prepare("SELECT COUNT(*) AS count FROM reminder_enrollments").first())
      .toEqual({ count: 0 });
  }, 30_000);

  it("runs the same owned vertical with a Google calendar checkpoint and no GHL identity or credentials", async () => {
    const { mf, crmDb, reminderDb } = await startRuntime();
    const now = Date.now();
    const startAt = new Date(now + 8 * 86_400_000).toISOString();
    const recordedAt = new Date(now).toISOString();
    const googleEventId = "synthetic-google-appointment";
    const googleCalendarId = "synthetic-garrett@group.calendar.google.com";
    await crmDb.prepare(
      `INSERT INTO contacts (id, display_name, created_at, updated_at)
       VALUES (?, 'Synthetic Partner — Google Authority Proof', ?, ?)`,
    ).bind(CONTACT_ID, recordedAt, recordedAt).run();

    const capture = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "schedule", contactId: CONTACT_ID, serviceId: "partner-initial",
        idempotencyKey: "synthetic-partner-google-runtime-proof-v1",
        startTime: startAt, timezone: "America/Los_Angeles",
      },
    });
    const commandId = capture.appointment.commandId;
    const appointmentId = capture.appointment.appointmentId;
    await request(mf, "/appointments/commands", {
      method: "POST", body: { action: "claim", commandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "provider-link", commandId, provider: "google_calendar",
        providerRecordId: googleEventId, providerCalendarId: googleCalendarId,
        providerStatusRaw: "confirmed",
      },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete", commandId,
        result: {
          action: "schedule", actor: "Garrett", contactId: CONTACT_ID,
          appointmentId, providerAppointmentId: googleEventId,
          newStartTime: startAt, appointmentStatus: "confirmed",
          reminderVerification: "pending_event_evidence", authority: "owned",
        },
      },
    });

    expect(await crmDb.prepare(
      `SELECT provider, provider_contact_id, provider_appointment_id, provider_calendar_id, state
         FROM appointment_lifecycle_dispatches WHERE command_id = ?`,
    ).bind(commandId).first()).toEqual({
      provider: "google_calendar", provider_contact_id: null,
      provider_appointment_id: googleEventId, provider_calendar_id: googleCalendarId,
      state: "pending",
    });

    const sync = await request(mf, "/sync", {
      method: "POST", body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(sync.results.ownedAppointmentLifecycles).toMatchObject({
      status: "succeeded", considered: 1, dispatched: 1, retryable: 0, manualReview: 0,
    });
    expect(await reminderDb.prepare(
      `SELECT flow_key, appointment_id, contact_id, calendar_id, status
         FROM reminder_enrollments WHERE enrollment_id = ?`,
    ).bind(`${PARTNER_FLOW}:${googleEventId}`).first()).toEqual({
      flow_key: PARTNER_FLOW, appointment_id: googleEventId, contact_id: CONTACT_ID,
      calendar_id: googleCalendarId, status: "active",
    });
    expect(await reminderDb.prepare("SELECT COUNT(*) AS count FROM reminder_steps").first())
      .toEqual({ count: 6 });

    const cancellation = await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "manage", manageAction: "cancel", contactId: CONTACT_ID,
        appointmentId, idempotencyKey: "synthetic-partner-google-cancel-runtime-proof-v1",
      },
    });
    const cancellationCommandId = cancellation.command.commandId;
    expect(cancellation.command).toMatchObject({
      provider: "google_calendar", providerRecordId: googleEventId,
      providerCalendarId: googleCalendarId,
    });
    await request(mf, "/appointments/commands", {
      method: "POST", body: { action: "claim", commandId: cancellationCommandId },
    });
    await request(mf, "/appointments/commands", {
      method: "POST",
      body: {
        action: "complete", commandId: cancellationCommandId,
        result: { action: "cancel", contactId: CONTACT_ID, appointmentStatus: "cancelled" },
      },
    });
    expect(await crmDb.prepare(
      `SELECT provider, provider_contact_id, event_type, state
         FROM appointment_lifecycle_dispatches WHERE command_id = ?`,
    ).bind(cancellationCommandId).first()).toEqual({
      provider: "google_calendar", provider_contact_id: null,
      event_type: "cancelled", state: "pending",
    });

    const cancellationSync = await request(mf, "/sync", {
      method: "POST", body: { sources: ["owned-appointment-lifecycles"], limit: 10 },
    });
    expect(cancellationSync.results.ownedAppointmentLifecycles).toMatchObject({
      status: "succeeded", considered: 1, dispatched: 1,
    });
    expect(await reminderDb.prepare(
      "SELECT status FROM reminder_enrollments WHERE enrollment_id = ?",
    ).bind(`${PARTNER_FLOW}:${googleEventId}`).first()).toEqual({ status: "cancelled" });
    expect(await reminderDb.prepare(
      "SELECT COUNT(*) AS count FROM reminder_steps WHERE enrollment_id = ? AND status = 'pending'",
    ).bind(`${PARTNER_FLOW}:${googleEventId}`).first()).toEqual({ count: 0 });
  }, 30_000);
});
