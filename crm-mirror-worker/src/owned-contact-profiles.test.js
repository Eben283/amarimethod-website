import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { loadCommunicationContact } from "./owned-sender.js";
import { upsertGhlContact } from "./repository.js";
import {
  captureOwnedContactProfile,
  OWNED_CONTACT_PROFILE_SOURCE_MODE,
  ownedContactProfileReleaseReadiness,
} from "./owned-contact-profiles.js";

function migrations() {
  const directory = new URL("../migrations/", import.meta.url);
  return readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
    .map((name) => readFileSync(new URL(name, directory), "utf8"));
}

function migrationEntries() {
  const directory = new URL("../migrations/", import.meta.url);
  return readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, directory), "utf8") }));
}

function d1(sqlite) {
  const statement = (sql, values = []) => ({
    sql,
    values,
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes || 0) } }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((item) => item.all())),
  };
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations()) sqlite.exec(migration);
  return sqlite;
}

function insertContact(sqlite, overrides = {}) {
  sqlite.prepare(
    `INSERT INTO contacts (
       id, first_name, last_name, display_name, email_normalized, phone_e164,
       created_at, updated_at, archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    overrides.id || "contact-1",
    overrides.firstName ?? "Avery",
    overrides.lastName ?? "Example",
    overrides.displayName ?? "Avery Example",
    overrides.email ?? "old@example.test",
    overrides.phone ?? "+14155550100",
    "2026-09-01T00:00:00.000Z",
    "2026-09-01T00:00:00.000Z",
    overrides.archivedAt ?? null,
  );
}

const active = { sourceMode: "active" };
const base = (action, key, overrides = {}) => ({
  action,
  contactId: "contact-1",
  actor: "Garrett",
  idempotencyKey: key,
  expectedRevision: 0,
  ...overrides,
});

describe("owned contact profile authority", () => {
  it("upgrades a populated v30 database without changing contact or consent truth", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    const entries = migrationEntries();
    for (const migration of entries.filter(({ name }) => name < "0031_")) sqlite.exec(migration.sql);
    insertContact(sqlite);
    sqlite.prepare(
      `INSERT INTO consents
       (id,contact_id,channel,state,effective_at,source,evidence_ref,recorded_by)
       VALUES ('existing-consent','contact-1','email','granted','2026-08-01T00:00:00.000Z','ghl','legacy','crm_mirror')`,
    ).run();
    sqlite.exec(entries.find(({ name }) => name.startsWith("0031_"))?.sql || "");
    expect(sqlite.prepare(
      `SELECT first_name,last_name,display_name,email_normalized,phone_e164,
              name_authority,name_revision,email_authority,email_revision,phone_authority,phone_revision
         FROM contacts WHERE id='contact-1'`,
    ).get()).toEqual({
      first_name: "Avery", last_name: "Example", display_name: "Avery Example",
      email_normalized: "old@example.test", phone_e164: "+14155550100",
      name_authority: "provider_mirror", name_revision: 0,
      email_authority: "provider_mirror", email_revision: 0,
      phone_authority: "provider_mirror", phone_revision: 0,
    });
    expect(sqlite.prepare(
      "SELECT state,destination_normalized,destination_sha256 FROM consents WHERE id='existing-consent'",
    ).get()).toEqual({ state: "granted", destination_normalized: null, destination_sha256: null });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("is source-pinned shadow with no provider, delivery, creation, or destructive fallback", async () => {
    expect(OWNED_CONTACT_PROFILE_SOURCE_MODE).toBe("shadow");
    expect(ownedContactProfileReleaseReadiness()).toEqual({
      version: "owned-contact-profile-authority.v1",
      sourceMode: "shadow",
      enabled: false,
      providerFallback: null,
      providerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      appointmentWrite: false,
      contactCreation: false,
      destructiveEvidenceDelete: false,
      destinationConsentRequired: true,
      independentFieldRevisions: true,
    });
    let storageTouches = 0;
    await expect(captureOwnedContactProfile({
      prepare() { storageTouches += 1; throw new Error("shadow must not touch storage"); },
    }, base("revise_name", "profile-shadow-0001", { firstName: "Avery", lastName: "Updated" })))
      .rejects.toMatchObject({ code: "owned_contact_profile_shadow_only", status: 503 });
    expect(storageTouches).toBe(0);
  });

  it("revises name under its own revision and prevents later GHL imports from overwriting it", async () => {
    const sqlite = database();
    insertContact(sqlite);
    sqlite.prepare(
      `INSERT INTO external_records
       (id,provider,object_type,external_id,contact_id,record_type,record_id,last_seen_at)
       VALUES ('external-1','ghl','contact','ghl-1','contact-1','contact','contact-1','2026-09-01T00:00:00.000Z')`,
    ).run();
    const db = d1(sqlite);
    const changed = await captureOwnedContactProfile(db, base("revise_name", "profile-name-0001", {
      firstName: "Avery", lastName: "Owned",
    }), "2026-09-01T17:00:00.000Z", active);
    expect(changed).toMatchObject({
      action: "revise_name", resultState: "applied", resultRevision: 1,
      authority: "owned", displayName: "Avery Owned", deduped: false,
      providerWrite: false, messageWrite: false, contactCreated: false,
    });
    const replay = await captureOwnedContactProfile(db, base("revise_name", "profile-name-0001", {
      firstName: "Avery", lastName: "Owned",
    }), "2026-09-01T17:01:00.000Z", active);
    expect(replay).toMatchObject({ commandId: changed.commandId, deduped: true, resultRevision: 1 });

    await upsertGhlContact(db, {
      externalId: "ghl-1", firstName: "Provider", lastName: "Overwrite",
      displayName: "Provider Overwrite", email: "provider@example.test", phone: "+14155550199",
      referralSourceLabel: null, tags: [], roles: [], attributes: [],
    }, "2026-09-01T18:00:00.000Z");
    expect(sqlite.prepare(
      `SELECT first_name,last_name,display_name,name_authority,name_revision,
              email_normalized,email_authority,phone_e164,phone_authority
         FROM contacts WHERE id='contact-1'`,
    ).get()).toEqual({
      first_name: "Avery", last_name: "Owned", display_name: "Avery Owned",
      name_authority: "owned", name_revision: 1,
      email_normalized: "provider@example.test", email_authority: "provider_mirror",
      phone_e164: "+14155550199", phone_authority: "provider_mirror",
    });
    sqlite.close();
  });

  it("binds a granted email consent to the exact new destination and refuses stale or unsupported reuse", async () => {
    const sqlite = database();
    insertContact(sqlite);
    sqlite.prepare(
      `INSERT INTO consents
       (id,contact_id,channel,state,effective_at,source,evidence_ref,recorded_by)
       VALUES ('legacy-consent','contact-1','email','granted','2026-08-01T00:00:00.000Z','ghl','legacy','crm_mirror')`,
    ).run();
    const db = d1(sqlite);

    await expect(captureOwnedContactProfile(db, base("set_email", "profile-email-invalid", {
      email: "new@example.test", consentState: "granted",
    }), "2026-09-01T17:00:00.000Z", active)).rejects.toMatchObject({ code: "missing_consent_evidence" });

    const changed = await captureOwnedContactProfile(db, base("set_email", "profile-email-0001", {
      email: "New@Example.Test", consentState: "granted", consentEvidenceRef: "signed-intake-42",
    }), "2026-09-01T17:00:00.000Z", active);
    expect(changed).toMatchObject({
      action: "set_email", resultState: "applied", resultRevision: 1,
      channel: "email", destinationMasked: "ne***@example.test", consentState: "granted",
    });
    const contact = sqlite.prepare(
      "SELECT email_normalized,email_authority,email_revision FROM contacts WHERE id='contact-1'",
    ).get();
    expect(contact).toEqual({ email_normalized: "new@example.test", email_authority: "owned", email_revision: 1 });
    const evidence = sqlite.prepare(
      `SELECT channel,state,source,evidence_ref,destination_normalized,destination_sha256
         FROM consents WHERE source='owned:staff_destination'`,
    ).get();
    expect(evidence).toMatchObject({
      channel: "email", state: "granted", source: "owned:staff_destination",
      evidence_ref: "signed-intake-42", destination_normalized: "new@example.test",
    });
    expect(evidence.destination_sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(loadCommunicationContact(db, "contact-1")).resolves.toMatchObject({
      email_normalized: "new@example.test", email_authority: "owned", email_consent_state: "granted",
    });

    await expect(captureOwnedContactProfile(db, base("set_email", "profile-email-stale", {
      email: "third@example.test", consentState: "unknown",
    }), "2026-09-01T17:01:00.000Z", active)).rejects.toMatchObject({ code: "stale_profile_revision" });
    await expect(captureOwnedContactProfile(db, base("set_email", "profile-email-0001", {
      email: "different@example.test", consentState: "unknown",
    }), "2026-09-01T17:01:00.000Z", active)).rejects.toMatchObject({ code: "idempotency_conflict" });
    sqlite.close();
  });

  it("treats unknown consent for a new owned phone as current and does not inherit an older grant", async () => {
    const sqlite = database();
    insertContact(sqlite);
    sqlite.prepare(
      `INSERT INTO consents
       (id,contact_id,channel,state,effective_at,source,evidence_ref,recorded_by)
       VALUES ('legacy-sms','contact-1','sms','granted','2026-08-01T00:00:00.000Z','ghl','legacy','crm_mirror')`,
    ).run();
    const db = d1(sqlite);
    await captureOwnedContactProfile(db, base("set_phone", "profile-phone-0001", {
      phone: "415-555-0199", consentState: "unknown",
    }), "2026-09-01T17:00:00.000Z", active);
    await expect(loadCommunicationContact(db, "contact-1")).resolves.toMatchObject({
      phone_e164: "+14155550199", phone_authority: "owned", sms_consent_state: "unknown",
    });
    const current = await captureOwnedContactProfile(db, base("set_phone", "profile-phone-0002", {
      expectedRevision: 1, phone: "+14155550199", consentState: "unknown",
    }), "2026-09-01T17:01:00.000Z", active);
    expect(current).toMatchObject({ resultState: "already_current", resultRevision: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM consents").get()).toEqual({ count: 2 });
    sqlite.close();
  });

  it("rejects archived contacts and database-level revision/result/evidence forgery", async () => {
    const sqlite = database();
    insertContact(sqlite, { archivedAt: "2026-09-01T16:00:00.000Z" });
    const db = d1(sqlite);
    await expect(captureOwnedContactProfile(db, base("revise_name", "profile-archived-1", {
      firstName: "Archived", lastName: "Person",
    }), "2026-09-01T17:00:00.000Z", active)).rejects.toMatchObject({ code: "contact_unavailable" });

    sqlite.prepare("UPDATE contacts SET archived_at=NULL WHERE id='contact-1'").run();
    expect(() => sqlite.prepare(
      `INSERT INTO owned_contact_profile_commands (
         id,contact_id,actor,idempotency_key,action,expected_revision,result_revision,
         previous_authority,previous_first_name,previous_last_name,previous_display_name,
         next_first_name,next_last_name,next_display_name,command_sha256,capture_nonce,result_state,recorded_at
       ) VALUES ('forged','contact-1','Garrett','profile-forged-1','revise_name',0,0,
                 'provider_mirror','Avery','Example','Avery Example','Forged','Name','Forged Name',
                 ?,?,'already_current','2026-09-01T17:00:00.000Z')`,
    ).run("a".repeat(64), "b".repeat(32))).toThrow(/result mismatch/i);
    expect(() => sqlite.prepare(
      `INSERT INTO consents
       (id,contact_id,channel,state,effective_at,source,evidence_ref,recorded_by,
        destination_normalized,destination_sha256)
       VALUES ('bad','contact-1','sms','granted','2026-09-01T17:00:00.000Z','owned','bad','Garrett',
               '+1notdigits',?)`,
    ).run("c".repeat(64))).toThrow(/destination identity invalid/i);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_contact_profile_commands").get()).toEqual({ count: 0 });
    sqlite.close();
  });

  it("changes only the selected contact field, bound consent, and immutable command evidence", async () => {
    const sqlite = database();
    insertContact(sqlite);
    const db = d1(sqlite);
    const tables = [
      "appointments", "external_records", "client_notes", "client_tasks", "owned_note_versions",
      "owned_task_versions", "owned_communication_commands", "outbound_delivery_attempts",
      "appointment_payment_records", "appointment_payment_events", "session_ledger_entries", "purchases",
    ];
    await captureOwnedContactProfile(db, base("set_phone", "profile-zero-effect-1", {
      phone: "+14155550188", consentState: "revoked", consentEvidenceRef: "staff-confirmed-revocation",
    }), "2026-09-01T17:00:00.000Z", active);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_contact_profile_commands").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM consents WHERE source='owned:staff_destination'").get()).toEqual({ count: 1 });
    for (const table of tables) expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    expect(() => sqlite.exec("UPDATE owned_contact_profile_commands SET actor='Eben'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM owned_contact_profile_commands")).toThrow(/append-only/i);
    expect(() => sqlite.exec("UPDATE consents SET state='granted' WHERE source='owned:staff_destination'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM consents WHERE source='owned:staff_destination'"))
      .toThrow(/append-only/i);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
});
