import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AUTH = "synthetic-runtime-proof-secret";
const CONTACT_ID = "synthetic-partner-contact";
const PROVIDER_CONTACT_ID = "synthetic-ghl-contact";
const PROVIDER_APPOINTMENT_ID = "synthetic-ghl-appointment";
const PARTNER_CALENDAR_ID = "lfsnaiGiLNL2z12pLKDP";
const PARTNER_FLOW = "partner-initial-in-person";
const instances = new Set();
let scripts;
let egress = 0;

const BRIDGE = `export default { fetch(request, env) { return env.CRM.fetch(request); } };`;

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
  expect(names.at(-1)).toBe("0020_owned_appointment_lifecycle_dispatch.sql");
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
          bindings: { WORKER_AUTH_SECRET: AUTH, GHL_LOCATION_ID: "synthetic-location" },
          d1Databases: ["CRM_DB", "AUTOMATION_DB"],
          kvNamespaces: ["PORTAL_KV"],
          serviceBindings: { REMINDER: "reminder" },
        },
        {
          ...base,
          name: "reminder",
          script: scripts.reminder,
          bindings: { WORKER_AUTH_SECRET: AUTH },
          d1Databases: ["REMINDER_DB"],
          kvNamespaces: ["PORTAL_KV"],
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
      definition_version: 1,
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
});
