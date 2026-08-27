import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OBSERVED_PROMOTION_FIXTURE_SHA256,
  validateCheckedInObservedPromotionEvidence,
  validateObservedPromotionEvidence,
} from "../scripts/check-reliability-v2-production-lineage-promotion-evidence.mjs";

const fixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json",
  import.meta.url,
);
const physicalFixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-observed-primary.v1.json",
  import.meta.url,
);
const promotionSqlUrl = new URL(
  "../reliability-spine-v2-production-lineage-promote.local.sql",
  import.meta.url,
);
const fixtureSource = readFileSync(fixtureUrl, "utf8");
const physicalFixtureSource = readFileSync(physicalFixtureUrl, "utf8");
const promotionSqlSource = readFileSync(promotionSqlUrl, "utf8");

function mutated(change) {
  const value = JSON.parse(fixtureSource);
  change(value);
  return JSON.stringify(value, null, 2) + "\n";
}

function validateMutation(change) {
  return () => validateObservedPromotionEvidence({
    fixtureSource: mutated(change),
    physicalFixtureSource,
    promotionSqlSource,
    requireFixtureFileHash: false,
  });
}

describe("observed production-lineage v2 authority evidence", () => {
  it("pins the exact immutable primary evidence and its deliberately limited claim", () => {
    expect(createHash("sha256").update(fixtureSource).digest("hex"))
      .toBe(OBSERVED_PROMOTION_FIXTURE_SHA256);
    expect(validateCheckedInObservedPromotionEvidence()).toEqual({
      status: "exact_observed_phase_b_authority",
      authority: true,
      schemaVersion: 2,
      migrationId: "reliability-spine-v2-production-lineage-8c7245ae",
      appliedAt: 1787803363000,
      objectCount: 69,
      structureSha256: "8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62",
      healthTruth: "Degraded",
      healthReason: "coverage_missing",
      providerApplyReceiptParsed: false,
      processAttempts: 1,
    });
  });

  it("rejects marker, contract, catalog, or timestamp drift", () => {
    expect(validateMutation((value) => { value.rawPrimaryRows.schemaVersions[1].applied_at += 1; }))
      .toThrow(/raw marker/);
    expect(validateMutation((value) => { value.rawPrimaryRows.schemaContracts[0].applied_at += 1; }))
      .toThrow(/contract bytes/);
    expect(validateMutation((value) => {
      const objects = JSON.parse(value.rawPrimaryRows.schemaContracts[0].expected_objects_json);
      value.rawPrimaryRows.schemaContracts[0].expected_objects_json = JSON.stringify(objects.slice(1));
    })).toThrow(/contract bytes/);
    expect(validateMutation((value) => { value.structureSha256 = "0".repeat(64); }))
      .toThrow(/authority identity/);
  });

  it("rejects non-primary, writeful, or incomplete coverage evidence", () => {
    expect(validateMutation((value) => { value.readEvidence.servedByPrimary = false; }))
      .toThrow(/read provenance/);
    expect(validateMutation((value) => { value.readEvidence.rowsWritten = 1; }))
      .toThrow(/read provenance/);
    expect(validateMutation((value) => { value.primaryCounts.reconciliation_runs = 1; }))
      .toThrow(/zero-count/);
    expect(validateMutation((value) => { value.staffHealth.truth = "Known"; }))
      .toThrow(/coverage truth/);
  });

  it("rejects an unanchored observation window or substituted readback query", () => {
    expect(validateMutation((value) => { value.evidenceCapturedAtUtc = value.readEvidence.trustedD1AppliedAtUtc; }))
      .toThrow(/authority identity/);
    expect(validateMutation((value) => { value.readEvidence.captureStartedAtUtc = "2026-08-27T04:27:32Z"; }))
      .toThrow(/read provenance/);
    expect(validateMutation((value) => { value.readEvidence.countsQuery += " "; }))
      .toThrow(/read provenance/);
    expect(validateMutation((value) => { value.workerEvidence.observedWithinCaptureWindow = false; }))
      .toThrow(/non-deployment/);
  });

  it("preserves the one-attempt ambiguous-output and no-deployment boundary", () => {
    expect(validateMutation((value) => { value.promotionEvidence.processAttempts = 2; }))
      .toThrow(/execution provenance/);
    expect(validateMutation((value) => { value.promotionEvidence.stdoutWasJson = true; }))
      .toThrow(/execution provenance/);
    expect(validateMutation((value) => { value.promotionEvidence.providerApplyReceiptParsed = true; }))
      .toThrow(/execution provenance/);
    expect(validateMutation((value) => { value.workerEvidence.deploymentUnchanged = false; }))
      .toThrow(/non-deployment/);
  });

  it("does not register the evidence checker or promotion artifact as runtime/schema work", () => {
    const rootPackage = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const workerPackage = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
    for (const source of [rootPackage, workerPackage, wrangler, schema]) {
      expect(source).not.toContain("promotion-observed-evidence");
      expect(source).not.toContain("production-lineage-promotion-observed-primary");
    }
  });
});
