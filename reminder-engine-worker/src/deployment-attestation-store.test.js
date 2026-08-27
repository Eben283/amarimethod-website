import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAttestedReleaseManifest, createDeploymentAttestationPayload, signDeploymentAttestationEnvelope,
} from "../../functions/lib/automation-truth-phase-d.js";
import {
  DeploymentAttestationRefusal, prepareSourceRuntimeProvenanceInsert, recordVerifiedDeploymentAttestation,
} from "../../functions/lib/reliability-deployment-attestation-store.js";
import { RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY } from "../../functions/lib/reliability-schema-authority.js";

const productionV1Fixture = JSON.parse(readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json",
  import.meta.url,
), "utf8"));
const liveLineageInstall = readFileSync(new URL(
  "../reliability-spine-v2-production-lineage-install.local.sql",
  import.meta.url,
), "utf8");
const liveLineagePromotion = readFileSync(new URL(
  "../reliability-spine-v2-production-lineage-promote.local.sql",
  import.meta.url,
), "utf8");
const D = (character) => character.repeat(64);
const G = (character) => character.repeat(40);
const APPROVED_SHA256 = "2687f86ed6784b8a5fca36e6c468e12aa44dc3c7e8137e3160d1a95079bdcd02";
const CREATED_AT = "2026-08-26T20:55:00.000Z";
const OBSERVED_AT = "2026-08-26T20:59:00.000Z";
const ATTESTED_AT = "2026-08-26T21:00:00.000Z";
const EXPIRES_AT = "2026-08-26T21:15:00.000Z";
const RETENTION = Date.parse("2026-09-26T21:15:00.000Z");
const WORKER_VERSION = "follow-up-reminder-engine.v3";
const textSha256 = (value) => createHash("sha256").update(value).digest("hex");
const BUILD_COVERAGE = [
  "bundle", "compiled_plan", "compiler_artifact", "handler_registry", "lockfile", "message_catalog",
  "modules", "release_manifest", "repository", "runtime_identity", "schema_source", "source_revision", "source_tree", "spec",
];

function d1FromSqlite(raw) {
  const statement = (sql) => ({
    sql, values: [], bind(...values) { this.values = values; return this; },
    first() { return raw.prepare(this.sql).get(...this.values) || null; },
    all() { return { results: raw.prepare(this.sql).all(...this.values) }; },
    run() { const result = raw.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; },
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

function structureDigest() {
  return RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.structureSha256;
}

const bindingsFor = (sourceRevision = G("a"), workerVersion = WORKER_VERSION) => [
  { name: "REMINDER_DB", kind: "d1", resourceId: "reminder-db-fixture" },
  { name: "FOLLOW_UP_DELIVERY_RELEASE", kind: "plain", valueSha256: APPROVED_SHA256 },
  { name: "FOLLOW_UP_ASSIGNED_USER_DELIVERY", kind: "plain", valueSha256: APPROVED_SHA256 },
  { name: "SOURCE_REVISION", kind: "plain", valueSha256: textSha256(sourceRevision) },
  { name: "WORKER_VERSION", kind: "plain", valueSha256: textSha256(workerVersion) },
  { name: "CF_VERSION_METADATA", kind: "version_metadata" },
  { name: "GHL_WEBHOOK_SECRET", kind: "secret", present: true },
];

const releaseInput = (patch = {}) => {
  const source = patch.source || { repository: "Eben283/amarimethod-website", revision: G("a"), tree: G("b"), lockfile: { path: "package-lock.json", sha256: D("c") } };
  const runtimeIdentity = patch.runtimeIdentity || { workerVersion: WORKER_VERSION, runtimeVersion: `${source.revision}@${WORKER_VERSION}` };
  return ({
  source,
  runtimeIdentity,
  workflow: { workflowId: "follow-up-session-reminders", version: 3, state: "published", documentSha256: D("d") },
  compiledPlan: {
    compilerId: "amari-automation-truth-compiler.v1", compilerArtifactSha256: D("e"), specDigest: D("f"),
    compiledPlanDigest: D("1"), handlerRegistryDigest: D("2"), messageCatalogDigest: D("3"),
  },
  artifacts: {
    bundle: { format: "cloudflare-worker-modules", sha256: D("4") },
    modules: [{ path: "follow-up-workflow.js", sha256: D("5") }, { path: "index.js", sha256: D("6") }],
    moduleCatalog: { algorithm: "esbuild-metafile-inputs.v1", complete: true },
  },
  expectedBindings: patch.expectedBindings || bindingsFor(source.revision, runtimeIdentity.workerVersion),
  requiredSchema: {
    databaseId: "reminder-db-fixture",
    migrationId: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.migrationId,
    version: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.version,
    sourceSha256: D("6"), structureSha256: structureDigest(),
  },
  deliveryGuards: { followUpDeliveryRelease: "approved", followUpAssignedUserDelivery: "approved" },
  effectOwner: { system: "Amari", mode: "live", effectful: true },
  canonicalization: "amari-canonical-json.v1",
  createdAt: CREATED_AT,
  ...patch,
  });
};

function observation(manifest, patch = {}) {
  return {
    platform: "cloudflare", service: "reminder-engine", environment: "production",
    deploymentId: "deployment-fixture", versionId: "version-fixture", trafficPercent: 100,
    source: { revision: manifest.source.revision, tree: manifest.source.tree }, artifacts: manifest.artifacts,
    bindings: manifest.expectedBindings, schema: manifest.requiredSchema, workflow: manifest.workflow,
    deliveryGuards: manifest.deliveryGuards,
    versionMetadata: { binding: "CF_VERSION_METADATA", versionId: "version-fixture" },
    authorityEvidence: {
      build: { authority: "github-actions-build-provenance", reference: "github://Eben283/amarimethod-website/actions/runs/fixture", sha256: D("6"), coverage: BUILD_COVERAGE },
      cloudflare: { authority: "cloudflare-control-plane-api", reference: "cloudflare://workers/reminder-engine/deployments/fixture", sha256: D("7"), coverage: ["deployment", "version", "traffic", "bindings"] },
      d1Schema: { authority: "remote-d1-schema-readback", reference: "d1://reminder-db-fixture/schema/v2", sha256: D("8"), coverage: ["migration", "schema_hash", "tables"] },
      d1Workflow: { authority: "remote-d1-workflow-readback", reference: "d1://reminder-db-fixture/workflows/follow-up-session-reminders/v3", sha256: D("9"), coverage: ["document", "published_state", "version"] },
    },
    ...patch,
  };
}

let keys;
let raw;
let db;
beforeAll(async () => { keys = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]); });
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const type of ["table", "index", "trigger"]) {
    for (const row of productionV1Fixture.projection.filter((item) => item.type === type)) raw.exec(row.sql);
  }
  const marker = productionV1Fixture.marker[0];
  raw.prepare(`INSERT INTO reliability_schema_versions
    (version,applied_at,migration_id,description) VALUES (?,?,?,?)`).run(
    marker.version, marker.applied_at, marker.migration_id, marker.description,
  );
  for (const sql of [liveLineageInstall, liveLineagePromotion]) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      raw.exec(sql);
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }
  db = d1FromSqlite(raw);
});

const keyring = () => [{
  keyId: "attestor-test", publicKey: keys.publicKey,
  validFrom: "2026-08-26T00:00:00.000Z", validUntil: "2026-09-26T00:00:00.000Z",
}];

async function authority({ releasePatch = {}, observationPatch = {}, observedAt = OBSERVED_AT, attestedAt = ATTESTED_AT, expiresAt = EXPIRES_AT } = {}) {
  const manifest = await createAttestedReleaseManifest(releaseInput(releasePatch));
  const payload = await createDeploymentAttestationPayload({
    releaseManifest: manifest, observed: observation(manifest, observationPatch), observedAt, attestedAt, expiresAt,
  });
  const envelope = await signDeploymentAttestationEnvelope(payload, { keyId: "attestor-test", privateKey: keys.privateKey });
  return { manifest, envelope };
}

describe("source-only verified deployment-attestation store", () => {
  it("persists only verified canonical rows and makes exact replay idempotent", async () => {
    const { manifest, envelope } = await authority();
    const first = await recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    });
    const replay = await recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:06:00.000Z", retentionUntil: RETENTION,
    });
    expect(first).toMatchObject({ created: true, replayed: false });
    expect(replay).toMatchObject({ created: false, replayed: true });
    expect(raw.prepare("SELECT count(*) count FROM automation_release_manifests").get()).toEqual({ count: 1 });
    expect(raw.prepare("SELECT count(*) count FROM automation_deployment_attestations").get()).toEqual({ count: 1 });
    expect(JSON.parse(first.manifest.canonical_json)).toMatchObject({ workflow: { version: 3 } });
    expect(JSON.parse(first.attestation.canonical_json)).not.toHaveProperty("contactId");
  });

  it("fails closed with typed collisions when only one conflicting authority row exists", async () => {
    const { manifest, envelope } = await authority();
    const overlay = ({ manifestRow = null, attestationRow = null }) => ({
      prepare(sql) {
        if (sql.includes("FROM automation_release_manifests WHERE release_manifest_id")) {
          return { bind() { return this; }, first() { return manifestRow; } };
        }
        if (sql.includes("FROM automation_deployment_attestations WHERE payload_sha256")) {
          return { bind() { return this; }, first() { return attestationRow; } };
        }
        return db.prepare(sql);
      },
      async batch() { throw new Error("collision must be refused before persistence"); },
    });

    await expect(recordVerifiedDeploymentAttestation(overlay({
      manifestRow: { canonical_json: "{}" },
    }), {
      releaseManifest: manifest, envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    })).rejects.toMatchObject({
      name: "DeploymentAttestationRefusal", status: "Broken",
      reasonCodes: ["release_manifest_content_collision"],
    });

    await expect(recordVerifiedDeploymentAttestation(overlay({
      attestationRow: { canonical_json: "{}", deployment_attestation_id: "conflicting-id" },
    }), {
      releaseManifest: manifest, envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    })).rejects.toMatchObject({
      name: "DeploymentAttestationRefusal", status: "Broken",
      reasonCodes: ["deployment_attestation_content_collision"],
    });
  });

  it("allows renewed proof for the unchanged version but refuses overlapping conflicting identity", async () => {
    const first = await authority();
    await recordVerifiedDeploymentAttestation(db, { releaseManifest: first.manifest, envelope: first.envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION });
    const renewal = await authority({ observedAt: "2026-08-26T21:04:00.000Z", attestedAt: "2026-08-26T21:05:00.000Z", expiresAt: "2026-08-26T21:20:00.000Z" });
    await expect(recordVerifiedDeploymentAttestation(db, { releaseManifest: renewal.manifest, envelope: renewal.envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:06:00.000Z", retentionUntil: RETENTION }))
      .resolves.toMatchObject({ created: true });

    const conflicting = await authority({
      releasePatch: { workflow: { ...releaseInput().workflow, documentSha256: D("e") } },
      observedAt: "2026-08-26T21:14:59.000Z", attestedAt: "2026-08-26T21:16:00.000Z",
      expiresAt: "2026-08-26T21:30:00.000Z",
    });
    await expect(recordVerifiedDeploymentAttestation(db, { releaseManifest: conflicting.manifest, envelope: conflicting.envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:17:00.000Z", retentionUntil: RETENTION }))
      .rejects.toMatchObject({ name: "DeploymentAttestationRefusal", status: "Broken", reasonCodes: ["overlapping_deployment_authority_conflict"] });
  });

  it("refuses overlapping 100-percent observations of two versions for one deployment", async () => {
    const first = await authority();
    await recordVerifiedDeploymentAttestation(db, {
      releaseManifest: first.manifest, envelope: first.envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    });
    const secondVersion = await authority({
      observationPatch: {
        versionId: "version-other",
        versionMetadata: { binding: "CF_VERSION_METADATA", versionId: "version-other" },
      },
      observedAt: "2026-08-26T21:04:00.000Z", attestedAt: "2026-08-26T21:05:00.000Z",
      expiresAt: "2026-08-26T21:20:00.000Z",
    });
    await expect(recordVerifiedDeploymentAttestation(db, {
      releaseManifest: secondVersion.manifest, envelope: secondVersion.envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:06:00.000Z", retentionUntil: RETENTION,
    })).rejects.toMatchObject({
      status: "Broken", reasonCodes: ["overlapping_deployment_authority_conflict"],
    });
  });

  it("refuses a non-overlapping rewrite of immutable Cloudflare version identity with a typed Broken result", async () => {
    const first = await authority();
    await recordVerifiedDeploymentAttestation(db, {
      releaseManifest: first.manifest, envelope: first.envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    });
    const conflicting = await authority({
      releasePatch: { source: { ...releaseInput().source, revision: G("c") } },
      observedAt: "2026-08-26T21:16:00.000Z", attestedAt: "2026-08-26T21:17:00.000Z",
      expiresAt: "2026-08-26T21:30:00.000Z",
    });
    await expect(recordVerifiedDeploymentAttestation(db, {
      releaseManifest: conflicting.manifest, envelope: conflicting.envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:18:00.000Z", retentionUntil: RETENTION,
    })).rejects.toMatchObject({
      name: "DeploymentAttestationRefusal", status: "Broken",
      reasonCodes: ["immutable_cloudflare_version_identity_conflict"],
    });
  });

  it("returns replay when an exact concurrent recorder wins before the batch", async () => {
    const { manifest, envelope } = await authority();
    let won = false;
    const racingDb = {
      prepare: db.prepare,
      async batch(statements) {
        if (!won) {
          won = true;
          await db.batch(statements);
          return statements.map(() => ({ meta: { changes: 0 } }));
        }
        return db.batch(statements);
      },
    };
    await expect(recordVerifiedDeploymentAttestation(racingDb, {
      releaseManifest: manifest, envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    })).resolves.toMatchObject({ created: false, replayed: true });
    expect(raw.prepare("SELECT count(*) count FROM automation_deployment_attestations").get()).toEqual({ count: 1 });
  });

  it("maps unavailable schema authority to Unknown and bounds recorder retention", async () => {
    const { manifest, envelope } = await authority();
    const unavailableDb = { prepare() { throw new Error("D1 unavailable"); } };
    await expect(recordVerifiedDeploymentAttestation(unavailableDb, {
      releaseManifest: manifest, envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    })).rejects.toMatchObject({ status: "Unknown", reasonCodes: ["schema_structure_authority_unavailable"] });
    await expect(recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(),
      trustedClock: () => "2026-08-26T21:05:00.000Z",
      retentionUntil: Date.parse(ATTESTED_AT) + (401 * 24 * 60 * 60 * 1000),
    })).rejects.toThrow(/400-day/);
  });

  it("refuses expired or authenticated-mismatch evidence without creating trusted rows", async () => {
    const expired = await authority();
    await expect(recordVerifiedDeploymentAttestation(db, { releaseManifest: expired.manifest, envelope: expired.envelope, keyring: keyring(), trustedClock: () => EXPIRES_AT, retentionUntil: RETENTION }))
      .rejects.toMatchObject({ name: "DeploymentAttestationRefusal", status: "Unknown", reasonCodes: ["attestation_expired"] });
    expect(raw.prepare("SELECT count(*) count FROM automation_deployment_attestations").get()).toEqual({ count: 0 });

    const mismatch = await authority({ observationPatch: { source: { revision: G("c"), tree: G("b") } } });
    await expect(recordVerifiedDeploymentAttestation(db, { releaseManifest: mismatch.manifest, envelope: mismatch.envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION }))
      .rejects.toBeInstanceOf(DeploymentAttestationRefusal);
    expect(raw.prepare("SELECT count(*) count FROM automation_deployment_attestations").get()).toEqual({ count: 0 });
  });

  it("records the recorder-owned clock and cannot be tricked by a stale caller time or an expiry-edge race", async () => {
    const { manifest, envelope } = await authority();
    await expect(recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(), now: "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    })).rejects.toMatchObject({ status: "Unknown", reasonCodes: ["attestation_expired"] });

    const readings = ["2026-08-26T21:14:59.999Z", EXPIRES_AT];
    await expect(recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(), trustedClock: () => readings.shift(), retentionUntil: RETENTION,
    })).rejects.toMatchObject({ status: "Unknown", reasonCodes: ["attestation_expired_before_recording"] });
    expect(raw.prepare("SELECT count(*) count FROM automation_deployment_attestations").get()).toEqual({ count: 0 });

    const stored = await recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    });
    expect(stored.attestation.recorded_at).toBe(Date.parse("2026-08-26T21:05:00.000Z"));
  });

  it("makes provenance one statement in the source/lifecycle/obligation acceptance batch and rolls all of it back on mismatch", async () => {
    const { manifest, envelope } = await authority();
    const stored = await recordVerifiedDeploymentAttestation(db, {
      releaseManifest: manifest, envelope, keyring: keyring(), trustedClock: () => "2026-08-26T21:05:00.000Z", retentionUntil: RETENTION,
    });
    const boundAt = Date.parse("2026-08-26T21:06:00.000Z");
    const acceptance = (suffix, cloudflareVersionId = envelope.payload.observed.versionId) => {
      const sourceId = `source-${suffix}`;
      const lifecycleId = `lifecycle-${suffix}`;
      const runtimeVersion = manifest.runtimeIdentity.runtimeVersion;
      return [
        db.prepare(`INSERT INTO source_events
          (source_event_id,provider,family,provider_event_id,identity_version,identity_key,payload_sha256,
           normalized_retention_until,occurred_at,received_at,authentication_result,normalization_state,state,
           source_version,runtime_version,accepted_at,created_at)
          VALUES (?,'ghl','follow-up-session-reminders',?,1,?,?, ?,?,?,'authenticated','normalized','accepted','source-v1',?,?,?)`)
          .bind(sourceId, `provider-${suffix}`, `identity-${suffix}`, D("a"), RETENTION, boundAt - 10, boundAt - 10, runtimeVersion, boundAt, boundAt),
        db.prepare(`INSERT INTO lifecycle_instances
          (lifecycle_instance_id,source_event_id,family,scope,person_id,appointment_id,definition_version,
           runtime_version,state,retention_until,created_at,updated_at)
          VALUES (?,?,'follow-up-session-reminders','follow-up','person','appointment',3,?,'active',?,?,?)`)
          .bind(lifecycleId, sourceId, runtimeVersion, RETENTION, boundAt, boundAt),
        db.prepare(`INSERT INTO lifecycle_obligations
          (obligation_id,lifecycle_instance_id,obligation_key,kind,family,deadline_at,owner_role,closer,state,
           retention_until,created_at,updated_at)
          VALUES (?,?, 'confirmation','email','follow-up-session-reminders',?,'system','provider_receipt','pending',?,?,?)`)
          .bind(`obligation-${suffix}`, lifecycleId, boundAt + 1_000, RETENTION, boundAt, boundAt),
        prepareSourceRuntimeProvenanceInsert(db, {
          sourceEventId: sourceId, lifecycleInstanceId: lifecycleId, invocationId: `invocation-${suffix}`,
          deploymentAttestationId: stored.attestation.deployment_attestation_id, cloudflareVersionId,
          workflowDocumentSha256: manifest.workflow.documentSha256,
          schemaStructureSha256: manifest.requiredSchema.structureSha256,
          followUpDeliveryRelease: "approved", followUpAssignedUserDelivery: "approved", boundAt, retentionUntil: RETENTION,
        }),
      ];
    };
    await db.batch(acceptance("ok"));
    expect(raw.prepare("SELECT count(*) count FROM source_event_runtime_provenance").get()).toEqual({ count: 1 });
    await expect(db.batch(acceptance("bad", "wrong-version"))).rejects.toThrow(/stale authorities/);
    expect(raw.prepare("SELECT count(*) count FROM source_events WHERE source_event_id='source-bad'").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT count(*) count FROM lifecycle_instances WHERE lifecycle_instance_id='lifecycle-bad'").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT count(*) count FROM lifecycle_obligations WHERE obligation_id='obligation-bad'").get()).toEqual({ count: 0 });
  });
});
