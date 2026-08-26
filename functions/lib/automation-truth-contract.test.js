import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { calculateBusinessMetric, deriveHealth, validateAssertion, validateEffectOwnership, validateTruthEnvelope, validateWorkflowSpec } from "./automation-truth-contract.js";

const schema = JSON.parse(readFileSync(new URL("../../docs/automation-truth/truth-envelope.schema.json", import.meta.url)));
const ownershipRegistry = new Set(JSON.parse(readFileSync(new URL("../../docs/automation-truth/effect-ownership.v1.json", import.meta.url))).responsibilities.map((item) => item.id));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);
const exactEnvelope = Object.freeze({
  assertionId: "runtime-attestation", claim: "Live", authority: "DeploymentRecord", authorityKind: "system", authorityPresent: true,
  proofLevel: "exact", valueKind: "known", value: true, sourceRefs: [{ kind: "deployment", id: "dep_1", digest: "abc" }],
  window: { start: "2026-08-26T00:00:00.000Z", end: "2026-08-26T01:00:00.000Z", timezone: "America/Los_Angeles" }, asOf: "2026-08-26T01:00:00.000Z", watermark: "2026-08-26T01:00:00.000Z",
  coverage: { expected: 1, observed: 1, missing: 0, paginationComplete: true, sampleRate: 1 }, freshness: { checkedAt: "2026-08-26T01:00:00.000Z", maxAgeMs: 60000, state: "fresh" }, ambiguity: "none", status: "Healthy", safetyViolation: false,
  onMissing: "Unknown", onStale: "Degraded", reasonCodes: [], limitations: [],
});
const workflowSpec = () => ({
  workflowId: "initial", version: "1", handlers: ["send"], entryNodeIds: ["entry"], exitNodeIds: ["exit"],
  nodes: [{ id: "entry", kind: "entry" }, { id: "gate", kind: "decision", branchCoverage: "complete" }, { id: "send", kind: "effect", handler: "send", responsibility: "source_receipt_and_exception_evidence", messageRef: "message.confirmation", expectedEvidence: [{ id: "command-attempt", authority: "ExecutionLedger" }] }, { id: "exit", kind: "exit" }],
  edges: [{ id: "a", from: "entry", to: "gate", condition: "always", priority: 0 }, { id: "b", from: "gate", to: "send", condition: "confirmed", priority: 0 }, { id: "c", from: "gate", to: "exit", condition: "else", priority: 1 }, { id: "d", from: "send", to: "exit", condition: "always", priority: 0 }],
});

describe("automation truth Phase A contract", () => {
  it("canonicalizes schema and JS validation in both directions", () => {
    expect(validateSchema(exactEnvelope), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateTruthEnvelope(exactEnvelope)).toMatchObject(exactEnvelope);
    const unknown = { ...exactEnvelope, claim: "Runtime availability", proofLevel: "unknown", valueKind: "unknown", value: null, status: "Unknown", authorityPresent: false, ambiguity: "unknown", reasonCodes: ["authority_missing"] };
    expect(validateSchema(unknown), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateAssertion(unknown)).toMatchObject(unknown);
    for (const invalid of [{ ...exactEnvelope, authority: ["DeploymentRecord"] }, { ...exactEnvelope, watermark: null }, { ...exactEnvelope, asOf: "2026-08-26" }, { ...exactEnvelope, watermark: "Tue, 26 Aug 2026 01:00:00 GMT" }, { ...exactEnvelope, coverage: { ...exactEnvelope.coverage, observed: null } }, { ...exactEnvelope, claim: "Healthy", authorityKind: "ai" }]) {
      expect(validateSchema(invalid)).toBe(false);
      expect(() => validateTruthEnvelope(invalid)).toThrow();
    }
  });

  it("fails health closed on missing metadata, absent authority, non-exact proof, ambiguity, stale, and incomplete evidence", () => {
    expect(deriveHealth([{ ...exactEnvelope, watermark: null }])).toBe("Unknown");
    expect(deriveHealth([{ ...exactEnvelope, authorityPresent: false }])).toBe("Unknown");
    expect(deriveHealth([{ ...exactEnvelope, proofLevel: "estimated" }])).toBe("Unknown");
    expect(deriveHealth([{ ...exactEnvelope, ambiguity: "present" }])).toBe("Unknown");
    expect(deriveHealth([{ ...exactEnvelope, freshness: { ...exactEnvelope.freshness, state: "stale" } }])).toBe("Degraded");
    expect(deriveHealth([{ ...exactEnvelope, coverage: { ...exactEnvelope.coverage, observed: 0, missing: 1 } }])).toBe("Degraded");
  });

  it("keeps Broken precedence over Unknown, Degraded, and Healthy", () => {
    expect(deriveHealth([{ ...exactEnvelope, safetyViolation: true, status: "Broken" }, { ...exactEnvelope, watermark: null }, { ...exactEnvelope, freshness: { ...exactEnvelope.freshness, state: "stale" } }])).toBe("Broken");
    expect(deriveHealth([{ ...exactEnvelope, watermark: null }, exactEnvelope])).toBe("Unknown");
  });

  it("honors per-envelope missing and stale policies while retaining global precedence", () => {
    expect(deriveHealth([{ ...exactEnvelope, authorityPresent: false, onMissing: "Degraded" }])).toBe("Degraded");
    expect(deriveHealth([{ ...exactEnvelope, authorityPresent: false, onMissing: "Broken" }])).toBe("Broken");
    expect(deriveHealth([{ ...exactEnvelope, freshness: { ...exactEnvelope.freshness, state: "stale" }, onStale: "Broken" }])).toBe("Broken");
    expect(deriveHealth([{ ...exactEnvelope, freshness: { ...exactEnvelope.freshness, state: "stale" }, onStale: "Unknown" }])).toBe("Unknown");
    expect(deriveHealth([{ ...exactEnvelope, safetyViolation: true, status: "Broken" }, { ...exactEnvelope, authorityPresent: false, onMissing: "Degraded" }])).toBe("Broken");
  });

  it("refuses unsafe business metrics including null, sampled, stale, incomplete, ambiguous, and zero-denominator inputs", () => {
    const metric = { numerator: 2, denominator: 4, envelope: exactEnvelope };
    expect(calculateBusinessMetric(metric)).toBe(0.5);
    for (const envelope of [{ ...exactEnvelope, coverage: { ...exactEnvelope.coverage, sampleRate: 0.5 } }, { ...exactEnvelope, coverage: { ...exactEnvelope.coverage, paginationComplete: false } }, { ...exactEnvelope, coverage: { ...exactEnvelope.coverage, missing: 1 } }, { ...exactEnvelope, freshness: { ...exactEnvelope.freshness, state: "stale" } }, { ...exactEnvelope, ambiguity: "present" }, { ...exactEnvelope, authorityPresent: false }, { ...exactEnvelope, proofLevel: "estimated" }]) expect(() => calculateBusinessMetric({ ...metric, envelope })).toThrow();
    expect(() => calculateBusinessMetric({ ...metric, numerator: null })).toThrow();
    expect(() => calculateBusinessMetric({ ...metric, denominator: 0 })).toThrow();
  });

  it("requires structured effect ownership and permits distinct responsibilities", () => {
    const sender = { responsibility: "send", owner: "GHL", mode: "live", effectful: true, observer: false };
    expect(validateEffectOwnership([sender, { responsibility: "receipt", owner: "Amari", mode: "live", effectful: true, observer: false }])).toHaveLength(2);
    expect(() => validateEffectOwnership([sender, { ...sender, owner: "Amari" }])).toThrow(/overlapping/);
    expect(() => validateEffectOwnership([{ owner: "GHL", mode: "live", effectful: true, observer: false }])).toThrow(/responsibility/);
    expect(() => validateEffectOwnership([{ ...sender, mode: "active" }])).toThrow(/effect mode/);
    expect(() => validateEffectOwnership([{ ...sender, effectful: "yes" }])).toThrow(/boolean/);
    expect(() => validateEffectOwnership([{ ...sender, observer: true }])).toThrow(/non-effectful/);
  });

  it("rejects manual or AI authority for Live and Healthy", () => {
    expect(() => validateTruthEnvelope({ ...exactEnvelope, authorityKind: "human" })).toThrow(/cannot authorize/);
    expect(() => validateTruthEnvelope({ ...exactEnvelope, authorityKind: "ai", claim: "Healthy" })).toThrow(/cannot authorize/);
  });

  it("validates a closed WorkflowSpec and rejects semantic and external-fact violations", () => {
    const validateSpec = (spec) => validateWorkflowSpec(spec, { allowedResponsibilities: ownershipRegistry });
    expect(validateSpec(workflowSpec())).toMatchObject({ workflowId: "initial" });
    expect(() => validateSpec({ ...workflowSpec(), externalObservations: [] })).toThrow(/not allowed/);
    expect(() => validateSpec({ ...workflowSpec(), nodes: [...workflowSpec().nodes, { id: "entry", kind: "entry" }] })).toThrow(/duplicate/);
    expect(() => validateSpec({ ...workflowSpec(), edges: [{ ...workflowSpec().edges[0], to: "missing" }] })).toThrow(/dangling/);
    expect(() => validateSpec({ ...workflowSpec(), nodes: [...workflowSpec().nodes, { id: "orphan", kind: "exit" }] })).toThrow(/unreachable/);
    expect(() => validateSpec({ ...workflowSpec(), nodes: workflowSpec().nodes.map((node) => node.id === "gate" ? { ...node, branchCoverage: "partial" } : node) })).toThrow(/branchCoverage/);
    expect(() => validateSpec({ ...workflowSpec(), edges: workflowSpec().edges.map((edge) => edge.id === "c" ? { ...edge, condition: "cancelled" } : edge) })).toThrow(/coverage/);
    expect(() => validateSpec({ ...workflowSpec(), nodes: workflowSpec().nodes.map((node) => node.id === "send" ? { ...node, handler: "unknown" } : node) })).toThrow(/unregistered/);
    expect(() => validateSpec({ ...workflowSpec(), nodes: workflowSpec().nodes.map((node) => node.id === "send" ? { ...node, responsibility: "not-owned" } : node) })).toThrow(/responsibility/);
    expect(() => validateSpec({ ...workflowSpec(), nodes: workflowSpec().nodes.map((node) => node.id === "send" ? { ...node, expectedEvidence: [{ id: "provider", authority: "ExternalObservation", value: "embedded-fact" }] } : node) })).toThrow(/not allowed/);
  });
});
