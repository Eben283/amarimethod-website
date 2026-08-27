import {
  FOLLOW_UP_FAMILY, FOLLOW_UP_RELIABILITY_ROUTE, NORMALIZED_RETENTION_MS, sha256Hex,
} from "./reliability-contract.js";
import {
  RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY,
  readReliabilitySchemaAuthority,
} from "./reliability-schema-authority.js";

export const FOLLOW_UP_RECONCILIATION_CONTRACT_VERSION = "follow-up-reconciliation.v1";
export const FOLLOW_UP_RECONCILIATION_RUN_KIND = "follow_up_source_only_simulation";
export const FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE = "self_reported_integrity_only";
export const FOLLOW_UP_RECONCILIATION_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
export const FOLLOW_UP_RECONCILIATION_MAX_COMPLETION_LAG_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_RECONCILIATION_MAX_RUN_MS = 15 * 60 * 1000;
export const FOLLOW_UP_RECONCILIATION_MAX_DETAIL_BYTES = 64 * 1024;
export const FOLLOW_UP_RECONCILIATION_MAX_ID_ARRAY_ITEMS = 128;

const RECONCILIATION_SOURCE_VERSION_RE = /^ghl:appointment-events-webhook:v[1-9][0-9]*$/;
const RECONCILIATION_RUNTIME_VERSION_RE = /^[a-f0-9]{40}@follow-up-reminder-engine\.v[1-9][0-9]*$/;
const RELEASE_MANIFEST_ID_RE = /^relm_[a-f0-9]{64}$/;
const DEPLOYMENT_ATTESTATION_ID_RE = /^depatt_[a-f0-9]{64}$/;
const GHL_APPOINTMENT_EVENTS_WORKFLOW_ID = "d03cf500-5fcf-4f7d-8a26-affb06eec97b";
const GHL_SOURCE_LIMITATION = "appointment_events_webhook_source_execution_only_no_sender_ownership";

const RECONCILIATION_COMPONENT_KEYS = Object.freeze([
  "schema", "ownedLedger", "runtimeProvenance", "ghlAppointmentEventSourceCoverage", "providerReceipts",
]);
const DETAIL_KEYS = Object.freeze([
  "contractVersion", "runKind", "family", "sourceVersion", "runtimeVersion", "startedAt", "checkedAt", "simulation",
  "authority", "producerAdopted", "evidenceScope", "window", "components", "overall", "detailDigestSha256",
]);
const WINDOW_KEYS = Object.freeze([
  "expectedStart", "expectedEnd", "coverageStart", "coverageEnd", "paginationComplete",
  "sampleRate", "activationWatermark", "continuityStart",
]);
const COMPONENT_KEYS = Object.freeze({
  schema: ["truth", "reason", "readStatus", "version", "variantId", "migrationId", "migrationState", "structureSha256"],
  ownedLedger: [
    "truth", "reason", "readStatus", "queryVersion", "identityDigest", "obligationSetDigest",
    "sourceEvents", "sourceTransitions", "acceptedSourceEvents", "rejectedSourceEvents",
    "lifecycleInstances", "obligations", "expectedObligations", "missingObligations",
    "unexpectedObligations", "commandAttempts", "openExceptions", "globalOrphanSourceTransitions",
    "globalOrphanLifecycles", "globalOrphanObligations", "globalOrphanCommandAttempts", "invariantViolations",
  ],
  runtimeProvenance: [
    "truth", "reason", "readStatus", "releaseManifestIds", "deploymentAttestationIds",
    "currentDeploymentAttestationId", "attestationExpiresAt", "attestationFresh", "sourceBindings",
    "distinctRuntimeVersions", "unboundAcceptedSources", "bindingMismatches", "runtimeVersionMatch", "identityDigest",
  ],
  ghlAppointmentEventSourceCoverage: [
    "truth", "reason", "readStatus", "source", "workflowName", "workflowId", "workflowVersion",
    "pagesRead", "cursorExhausted", "expectedExecutions", "observedExecutions", "joinedExecutions",
    "unjoinedExecutions", "identityDigest", "lookupErrors", "accountableOwner", "cadence",
    "freshnessMs", "observedAt", "coverageStart", "coverageEnd", "limitation",
  ],
  providerReceipts: [
    "truth", "reason", "readStatus", "expectedReceiptObligations", "coveredObligations",
    "acceptedObligations", "deliveredObligations", "failedObligations", "bouncedObligations",
    "unknownObligations", "zeroDenominatorProven", "lookupErrors", "cursorExhausted",
    "identityDigest", "obligationSetDigest", "coverageStart", "coverageEnd",
  ],
});

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) {
    throw new TypeError(`${label} keys are not exact`);
  }
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plainObject(value)) throw new TypeError("reconciliation detail must be JSON-compatible");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalReconciliationJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative integer`);
  return value;
}

function nullableInteger(value, label) {
  if (value === null) return null;
  return nonnegativeInteger(value, label);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value;
}

function boundedVersionText(value, label) {
  const text = requiredText(value, label);
  const pattern = label.includes("sourceVersion")
    ? RECONCILIATION_SOURCE_VERSION_RE : RECONCILIATION_RUNTIME_VERSION_RE;
  if (text.length > 160 || text !== text.trim() || !pattern.test(text)) {
    throw new TypeError(`${label} is not a bounded canonical version identity`);
  }
  return text;
}

function exactPatternId(value, pattern, label) {
  const text = requiredText(value, label);
  if (!pattern.test(text)) throw new TypeError(`${label} is not a canonical identifier`);
  return text;
}

function requiredDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(requiredText(value, label))) throw new TypeError(`${label} must be a SHA-256 digest`);
  return value;
}

function readFailure(component, prefix) {
  if (component.readStatus === "query_error") return { truth: "Unknown", reason: `${prefix}_query_failed` };
  if (component.readStatus === "permission_error") return { truth: "Unknown", reason: `${prefix}_permission_denied` };
  if (component.readStatus === "timeout") return { truth: "Unknown", reason: `${prefix}_timeout` };
  if (!new Set(["complete", "missing"]).has(component.readStatus)) throw new TypeError(`${prefix} readStatus is unsupported`);
  return null;
}

function declaredComponent(truth, reason, values) {
  return { truth, reason, ...values };
}

function expectedSchemaComponent(component) {
  const failure = readFailure(component, "schema_authority");
  if (failure || component.readStatus === "missing") {
    for (const key of ["version", "variantId", "migrationId", "migrationState", "structureSha256"]) {
      if (component[key] !== null) throw new TypeError(`components.schema.${key} must be null when authority was not read`);
    }
    return declaredComponent(failure?.truth || "Degraded", failure?.reason || "schema_authority_missing_or_unproven", {
      readStatus: component.readStatus,
      version: null,
      variantId: null,
      migrationId: null,
      migrationState: null,
      structureSha256: null,
    });
  }
  nonnegativeInteger(component.version, "components.schema.version");
  if (component.migrationState !== "current_v2") throw new TypeError("components.schema.migrationState is unsupported");
  requiredDigest(component.structureSha256, "components.schema.structureSha256");
  const exact = component.version === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.version
    && component.variantId === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.variantId
    && component.migrationId === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.migrationId
    && component.migrationState === "current_v2"
    && component.structureSha256 === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.structureSha256;
  if (!exact) throw new TypeError("complete schema component must equal exact v2 production authority");
  const truth = "Degraded";
  const reason = exact ? "schema_authority_self_reported_unverified" : "schema_authority_missing_or_unproven";
  return declaredComponent(truth, reason, {
    readStatus: component.readStatus,
    version: component.version,
    variantId: component.variantId,
    migrationId: component.migrationId,
    migrationState: component.migrationState,
    structureSha256: component.structureSha256,
  });
}

function expectedOwnedLedgerComponent(component) {
  const failure = readFailure(component, "owned_ledger");
  if (component.queryVersion !== "follow-up-owned-ledger.v1") throw new TypeError("owned ledger query version mismatch");
  if (failure) {
    for (const key of COMPONENT_KEYS.ownedLedger.slice(4)) {
      if (component[key] !== null) throw new TypeError(`components.ownedLedger.${key} must be null after a failed read`);
    }
    return declaredComponent(failure.truth, failure.reason, Object.fromEntries(
      COMPONENT_KEYS.ownedLedger.slice(2).map((key) => [key, component[key]]),
    ));
  }
  requiredDigest(component.identityDigest, "components.ownedLedger.identityDigest");
  requiredDigest(component.obligationSetDigest, "components.ownedLedger.obligationSetDigest");
  const countFields = COMPONENT_KEYS.ownedLedger.slice(6);
  for (const key of countFields) nonnegativeInteger(component[key], `components.ownedLedger.${key}`);
  const consistent = !failure && component.readStatus === "complete"
    && component.acceptedSourceEvents + component.rejectedSourceEvents === component.sourceEvents
    && component.lifecycleInstances === component.acceptedSourceEvents
    && component.sourceTransitions >= component.sourceEvents
    && component.obligations === component.expectedObligations
    && component.missingObligations === 0
    && component.unexpectedObligations === 0
    && component.globalOrphanSourceTransitions === 0
    && component.globalOrphanLifecycles === 0
    && component.globalOrphanObligations === 0
    && component.globalOrphanCommandAttempts === 0
    && component.invariantViolations === 0;
  const truth = "Degraded";
  const reason = consistent ? "owned_ledger_self_reported_unverified" : "owned_ledger_incomplete";
  return declaredComponent(truth, reason, Object.fromEntries(COMPONENT_KEYS.ownedLedger.slice(2).map((key) => [key, component[key]])));
}

function sortedUniqueIds(value, pattern, label) {
  if (!Array.isArray(value) || value.length > FOLLOW_UP_RECONCILIATION_MAX_ID_ARRAY_ITEMS) {
    throw new TypeError(`${label} must be a bounded identifier array`);
  }
  value.forEach((item, index) => exactPatternId(item, pattern, `${label}[${index}]`));
  const sorted = [...new Set(value)].sort();
  if (canonicalReconciliationJson(value) !== canonicalReconciliationJson(sorted)) throw new TypeError(`${label} must be sorted and unique`);
  return value;
}

function expectedRuntimeProvenanceComponent(component, checkedAt) {
  const failure = readFailure(component, "runtime_provenance");
  if (failure) {
    for (const key of COMPONENT_KEYS.runtimeProvenance.slice(3)) {
      if (component[key] !== null) throw new TypeError(`components.runtimeProvenance.${key} must be null after a failed read`);
    }
    return declaredComponent(failure.truth, failure.reason, Object.fromEntries(
      COMPONENT_KEYS.runtimeProvenance.slice(2).map((key) => [key, component[key]]),
    ));
  }
  sortedUniqueIds(component.releaseManifestIds, RELEASE_MANIFEST_ID_RE,
    "components.runtimeProvenance.releaseManifestIds");
  sortedUniqueIds(component.deploymentAttestationIds, DEPLOYMENT_ATTESTATION_ID_RE,
    "components.runtimeProvenance.deploymentAttestationIds");
  nullableInteger(component.attestationExpiresAt, "components.runtimeProvenance.attestationExpiresAt");
  for (const key of ["sourceBindings", "distinctRuntimeVersions", "unboundAcceptedSources", "bindingMismatches"]) {
    nonnegativeInteger(component[key], `components.runtimeProvenance.${key}`);
  }
  if (component.currentDeploymentAttestationId !== null) {
    exactPatternId(component.currentDeploymentAttestationId, DEPLOYMENT_ATTESTATION_ID_RE,
      "current deployment attestation id");
  }
  if (typeof component.attestationFresh !== "boolean" || typeof component.runtimeVersionMatch !== "boolean") {
    throw new TypeError("runtime provenance truth flags must be boolean");
  }
  requiredDigest(component.identityDigest, "components.runtimeProvenance.identityDigest");
  const complete = !failure && component.readStatus === "complete"
    && component.releaseManifestIds.length > 0
    && component.deploymentAttestationIds.length > 0
    && component.currentDeploymentAttestationId !== null
    && component.deploymentAttestationIds.includes(component.currentDeploymentAttestationId)
    && component.attestationExpiresAt !== null && component.attestationExpiresAt > checkedAt
    && component.attestationFresh
    && component.unboundAcceptedSources === 0
    && component.bindingMismatches === 0
    && component.runtimeVersionMatch;
  const missing = component.readStatus === "missing" || (component.releaseManifestIds.length === 0
    && component.deploymentAttestationIds.length === 0 && component.sourceBindings === 0);
  const truth = "Degraded";
  const reason = complete ? "runtime_provenance_self_reported_unverified" : missing ? "runtime_provenance_missing" : "runtime_provenance_incomplete";
  return declaredComponent(truth, reason,
    Object.fromEntries(COMPONENT_KEYS.runtimeProvenance.slice(2).map((key) => [key, component[key]])));
}

function expectedGhlCoverageComponent(component, window, checkedAt) {
  const failure = readFailure(component, "ghl_appointment_event_source_coverage");
  if (failure) {
    for (const key of COMPONENT_KEYS.ghlAppointmentEventSourceCoverage.slice(3)) {
      if (component[key] !== null) throw new TypeError(`components.ghlAppointmentEventSourceCoverage.${key} must be null after a failed read`);
    }
    return declaredComponent(failure.truth, failure.reason, Object.fromEntries(
      COMPONENT_KEYS.ghlAppointmentEventSourceCoverage.slice(2).map((key) => [key, component[key]]),
    ));
  }
  if (component.source !== null && component.source !== "ghl_execution_readback") {
    throw new TypeError("components.ghlAppointmentEventSourceCoverage.source is unsupported");
  }
  for (const key of ["workflowVersion", "pagesRead", "expectedExecutions", "observedExecutions", "joinedExecutions", "unjoinedExecutions", "lookupErrors", "freshnessMs"]) {
    nullableInteger(component[key], `components.ghlAppointmentEventSourceCoverage.${key}`);
  }
  if (component.workflowName !== null && component.workflowName !== "Appointment Events Webhook") {
    throw new TypeError("components.ghlAppointmentEventSourceCoverage.workflowName is unsupported");
  }
  if (component.workflowId !== null && component.workflowId !== GHL_APPOINTMENT_EVENTS_WORKFLOW_ID) {
    throw new TypeError("components.ghlAppointmentEventSourceCoverage.workflowId is unsupported");
  }
  if (component.accountableOwner !== null && component.accountableOwner !== "Eben") {
    throw new TypeError("components.ghlAppointmentEventSourceCoverage.accountableOwner is unsupported");
  }
  if (component.cadence !== null && component.cadence !== "weekly") {
    throw new TypeError("components.ghlAppointmentEventSourceCoverage.cadence is unsupported");
  }
  if (component.limitation !== null && component.limitation !== GHL_SOURCE_LIMITATION) {
    throw new TypeError("components.ghlAppointmentEventSourceCoverage.limitation is unsupported");
  }
  if (component.identityDigest !== null) requiredDigest(component.identityDigest, "components.ghlAppointmentEventSourceCoverage.identityDigest");
  nullableInteger(component.observedAt, "components.ghlAppointmentEventSourceCoverage.observedAt");
  nullableInteger(component.coverageStart, "components.ghlAppointmentEventSourceCoverage.coverageStart");
  nullableInteger(component.coverageEnd, "components.ghlAppointmentEventSourceCoverage.coverageEnd");
  if (typeof component.cursorExhausted !== "boolean") throw new TypeError("components.ghlAppointmentEventSourceCoverage.cursorExhausted must be boolean");
  if (component.readStatus === "missing") {
    for (const key of COMPONENT_KEYS.ghlAppointmentEventSourceCoverage.slice(3)) {
      if (key === "cursorExhausted") {
        if (component[key] !== false) throw new TypeError("missing GHL source coverage cannot exhaust a cursor");
      } else if (component[key] !== null) {
        throw new TypeError(`components.ghlAppointmentEventSourceCoverage.${key} must be null when readback is missing`);
      }
    }
  }
  const complete = !failure && component.readStatus === "complete"
    && component.source === "ghl_execution_readback"
    && component.workflowName === "Appointment Events Webhook"
    && component.workflowId !== null && component.workflowVersion !== null
    && component.pagesRead > 0 && component.cursorExhausted
    && component.expectedExecutions === component.observedExecutions
    && component.joinedExecutions === component.observedExecutions
    && component.unjoinedExecutions === 0
    && component.lookupErrors === 0
    && component.identityDigest !== null
    && component.accountableOwner !== null && component.cadence !== null && component.limitation !== null
    && component.freshnessMs > 0 && component.observedAt !== null
    && component.observedAt <= checkedAt
    && checkedAt - component.observedAt <= component.freshnessMs
    && component.coverageStart !== null && component.coverageEnd !== null
    && component.coverageStart <= window.expectedStart
    && component.coverageEnd >= window.expectedEnd;
  const missing = component.readStatus === "missing";
  const truth = "Degraded";
  const reason = complete
    ? "ghl_appointment_event_source_coverage_self_reported_unverified"
    : missing ? "ghl_appointment_event_source_coverage_missing" : "ghl_appointment_event_source_coverage_incomplete";
  return declaredComponent(truth, reason,
    Object.fromEntries(COMPONENT_KEYS.ghlAppointmentEventSourceCoverage.slice(2).map((key) => [key, component[key]])));
}

function expectedProviderReceiptComponent(component, window, owned, ghl) {
  const failure = readFailure(component, "provider_receipt_coverage");
  if (failure) {
    for (const key of COMPONENT_KEYS.providerReceipts.slice(3)) {
      if (component[key] !== null) throw new TypeError(`components.providerReceipts.${key} must be null after a failed read`);
    }
    return declaredComponent(failure.truth, failure.reason, Object.fromEntries(
      COMPONENT_KEYS.providerReceipts.slice(2).map((key) => [key, component[key]]),
    ));
  }
  const countKeys = [
    "expectedReceiptObligations", "coveredObligations", "acceptedObligations",
    "deliveredObligations", "failedObligations", "bouncedObligations",
    "unknownObligations", "lookupErrors",
  ];
  for (const key of countKeys) nonnegativeInteger(component[key], `components.providerReceipts.${key}`);
  if (typeof component.zeroDenominatorProven !== "boolean" || typeof component.cursorExhausted !== "boolean") {
    throw new TypeError("provider receipt truth flags must be boolean");
  }
  if (component.readStatus === "missing"
    && (component.cursorExhausted !== false || component.zeroDenominatorProven !== false)) {
    throw new TypeError("missing provider readback cannot prove a cursor or zero denominator");
  }
  requiredDigest(component.identityDigest, "components.providerReceipts.identityDigest");
  requiredDigest(component.obligationSetDigest, "components.providerReceipts.obligationSetDigest");
  nullableInteger(component.coverageStart, "components.providerReceipts.coverageStart");
  nullableInteger(component.coverageEnd, "components.providerReceipts.coverageEnd");
  const classified = component.acceptedObligations + component.deliveredObligations
    + component.failedObligations + component.bouncedObligations + component.unknownObligations;
  if (component.coveredObligations > component.expectedReceiptObligations
    || classified !== component.coveredObligations) {
    throw new TypeError("provider receipt counts are internally inconsistent");
  }
  const denominatorProven = component.expectedReceiptObligations > 0
    || (component.zeroDenominatorProven
      && owned.reason === "owned_ledger_self_reported_unverified"
      && ghl.reason === "ghl_appointment_event_source_coverage_self_reported_unverified");
  const complete = !failure && component.readStatus === "complete" && component.cursorExhausted
    && component.coveredObligations === component.expectedReceiptObligations
    && classified === component.coveredObligations
    && component.unknownObligations === 0
    && component.lookupErrors === 0
    && component.obligationSetDigest === owned.obligationSetDigest
    && denominatorProven
    && component.coverageStart !== null && component.coverageEnd !== null
    && component.coverageStart <= window.expectedStart
    && component.coverageEnd >= window.expectedEnd;
  const missing = component.readStatus === "missing" || (component.expectedReceiptObligations > 0
    && component.coveredObligations === 0 && component.lookupErrors === 0);
  const truth = "Degraded";
  const reason = complete ? "provider_receipt_coverage_self_reported_unverified" : missing ? "provider_receipt_coverage_missing" : "provider_receipt_coverage_incomplete";
  return declaredComponent(truth, reason,
    Object.fromEntries(COMPONENT_KEYS.providerReceipts.slice(2).map((key) => [key, component[key]])));
}

function expectedComponents(components, window, checkedAt) {
  const schema = expectedSchemaComponent(components.schema);
  const ownedLedger = expectedOwnedLedgerComponent(components.ownedLedger);
  const runtimeProvenance = expectedRuntimeProvenanceComponent(components.runtimeProvenance, checkedAt);
  const ghlAppointmentEventSourceCoverage = expectedGhlCoverageComponent(
    components.ghlAppointmentEventSourceCoverage, window, checkedAt,
  );
  const providerReceipts = expectedProviderReceiptComponent(
    components.providerReceipts, window, ownedLedger, ghlAppointmentEventSourceCoverage,
  );
  return { schema, ownedLedger, runtimeProvenance, ghlAppointmentEventSourceCoverage, providerReceipts };
}

function expectedOverall(detail, components) {
  const reasons = RECONCILIATION_COMPONENT_KEYS
    .filter((key) => components[key].truth !== "Known")
    .map((key) => components[key].reason);
  if (detail.simulation) reasons.push("simulation_only");
  if (!detail.authority) reasons.push("authority_false");
  if (!detail.producerAdopted) reasons.push("reconciliation_runtime_not_adopted");
  const exactReasons = [...new Set(reasons)].sort();
  // Contract v1 is intentionally source-only. Its digest proves canonical byte
  // integrity, not the provenance of any claimed external evidence. A future,
  // separately versioned contract may lift this cap only after an adopted live
  // producer and authenticated external evidence exist.
  return {
    truth: RECONCILIATION_COMPONENT_KEYS.some((key) => components[key].truth === "Unknown")
      ? "Unknown"
      : "Degraded",
    reasons: exactReasons,
  };
}

export function followUpReconciliationRunId(detailDigestSha256) {
  return `recon_${requiredDigest(detailDigestSha256, "reconciliation detail digest")}`;
}

export async function addFollowUpReconciliationDigest(unsignedDetail) {
  if (!plainObject(unsignedDetail) || Object.hasOwn(unsignedDetail, "detailDigestSha256")) {
    throw new TypeError("unsigned reconciliation detail is required");
  }
  const canonicalUnsigned = canonicalReconciliationJson(unsignedDetail);
  if (new TextEncoder().encode(canonicalUnsigned).byteLength > FOLLOW_UP_RECONCILIATION_MAX_DETAIL_BYTES) {
    throw new TypeError("unsigned reconciliation detail exceeds the byte limit");
  }
  return {
    ...unsignedDetail,
    detailDigestSha256: await sha256Hex(canonicalUnsigned),
  };
}

export async function validateFollowUpReconciliationDetail(detailJson, row = null) {
  try {
    requiredText(detailJson, "reconciliation detail_json");
    if (new TextEncoder().encode(detailJson).byteLength > FOLLOW_UP_RECONCILIATION_MAX_DETAIL_BYTES) {
      throw new TypeError("reconciliation detail_json exceeds the byte limit");
    }
    const detail = JSON.parse(detailJson);
    exactKeys(detail, DETAIL_KEYS, "reconciliation detail");
    exactKeys(detail.window, WINDOW_KEYS, "reconciliation detail window");
    exactKeys(detail.components, RECONCILIATION_COMPONENT_KEYS, "reconciliation detail components");
    exactKeys(detail.overall, ["truth", "reasons"], "reconciliation detail overall");
    for (const key of RECONCILIATION_COMPONENT_KEYS) exactKeys(detail.components[key], COMPONENT_KEYS[key], `components.${key}`);
    if (detail.contractVersion !== FOLLOW_UP_RECONCILIATION_CONTRACT_VERSION) throw new TypeError("reconciliation contract version mismatch");
    if (detail.runKind !== FOLLOW_UP_RECONCILIATION_RUN_KIND) throw new TypeError("reconciliation run kind mismatch");
    if (detail.family !== FOLLOW_UP_FAMILY) throw new TypeError("reconciliation family mismatch");
    boundedVersionText(detail.sourceVersion, "reconciliation detail sourceVersion");
    boundedVersionText(detail.runtimeVersion, "reconciliation detail runtimeVersion");
    nonnegativeInteger(detail.startedAt, "reconciliation detail startedAt");
    nonnegativeInteger(detail.checkedAt, "reconciliation detail checkedAt");
    if (detail.startedAt > detail.checkedAt
      || detail.window?.expectedEnd > detail.startedAt
      || detail.checkedAt - detail.startedAt > FOLLOW_UP_RECONCILIATION_MAX_RUN_MS) {
      throw new TypeError("reconciliation chronology is invalid");
    }
    if (typeof detail.simulation !== "boolean" || typeof detail.authority !== "boolean") throw new TypeError("reconciliation truth flags must be boolean");
    if (detail.simulation !== true || detail.authority !== false || detail.producerAdopted !== false) {
      throw new TypeError("reconciliation v1 must remain source-only, simulated, and non-authoritative");
    }
    if (detail.evidenceScope !== FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE) {
      throw new TypeError("reconciliation evidence scope mismatch");
    }
    for (const key of ["expectedStart", "expectedEnd", "coverageStart", "coverageEnd", "activationWatermark", "continuityStart"]) {
      nonnegativeInteger(detail.window[key], `reconciliation detail window.${key}`);
    }
    if (detail.window.sampleRate !== 1) throw new TypeError("reconciliation sampleRate must be exactly 1");
    if (typeof detail.window.paginationComplete !== "boolean") {
      throw new TypeError("reconciliation paginationComplete must be boolean");
    }
    if (detail.window.expectedStart >= detail.window.expectedEnd
      || detail.window.expectedEnd - detail.window.expectedStart > FOLLOW_UP_RECONCILIATION_MAX_WINDOW_MS
      || detail.checkedAt - detail.window.expectedEnd > FOLLOW_UP_RECONCILIATION_MAX_COMPLETION_LAG_MS
      || detail.window.expectedEnd > detail.checkedAt
      || detail.window.coverageEnd > detail.checkedAt
      || detail.window.activationWatermark > detail.window.expectedStart
      || detail.window.continuityStart > detail.window.expectedStart) throw new TypeError("reconciliation detail window is invalid");
    const expected = expectedComponents(detail.components, detail.window, detail.checkedAt);
    const localKeys = ["ownedLedger", "runtimeProvenance", "providerReceipts"];
    const localReadFailed = localKeys.map((key) => (
      expected[key].truth === "Unknown"
      && new Set(["query_error", "permission_error", "timeout"]).has(expected[key].readStatus)
    ));
    if (detail.window.paginationComplete) {
      if (localReadFailed.some(Boolean)
        || detail.window.coverageStart > detail.window.expectedStart
        || detail.window.coverageEnd < detail.window.expectedEnd) {
        throw new TypeError("complete local pagination requires complete local snapshot coverage");
      }
    } else if (!localReadFailed.every(Boolean)
      || detail.window.coverageStart !== detail.window.expectedStart
      || detail.window.coverageEnd !== detail.window.expectedStart) {
      throw new TypeError("incomplete local pagination requires the canonical failed-snapshot shape");
    }
    if (canonicalReconciliationJson(detail.components) !== canonicalReconciliationJson(expected)) {
      throw new TypeError("reconciliation component truth is optimistic or inconsistent");
    }
    const overall = expectedOverall(detail, expected);
    if (canonicalReconciliationJson(detail.overall) !== canonicalReconciliationJson(overall)) {
      throw new TypeError("reconciliation overall truth is optimistic or inconsistent");
    }
    if (detail.overall.truth === "Known" && !detail.window.paginationComplete) {
      throw new TypeError("known reconciliation requires exhausted pagination");
    }
    const { detailDigestSha256, ...unsigned } = detail;
    if (!/^[a-f0-9]{64}$/.test(detailDigestSha256)
      || detailDigestSha256 !== await sha256Hex(canonicalReconciliationJson(unsigned))) {
      throw new TypeError("reconciliation detail digest mismatch");
    }
    if (detailJson !== canonicalReconciliationJson(detail)) throw new TypeError("reconciliation detail JSON is not canonical");
    if (row) {
      if (row.family !== detail.family
        || row.detail_json !== detailJson
        || row.source_version !== detail.sourceVersion
        || row.runtime_version !== detail.runtimeVersion
        || Number(row.started_at) !== detail.startedAt
        || Number(row.completed_at) !== detail.checkedAt
        || Number(row.expected_start) !== detail.window.expectedStart
        || Number(row.expected_end) !== detail.window.expectedEnd
        || Number(row.coverage_start) !== detail.window.coverageStart
        || Number(row.coverage_end) !== detail.window.coverageEnd
        || Number(row.pagination_complete) !== Number(detail.window.paginationComplete)) {
        throw new TypeError("reconciliation row/detail identity mismatch");
      }
      const deterministicId = followUpReconciliationRunId(detail.detailDigestSha256);
      if (row.reconciliation_run_id !== deterministicId
        || Number(row.started_at) > Number(row.completed_at)
        || Number(row.retention_until) !== Number(row.started_at) + NORMALIZED_RETENTION_MS
        || row.state !== "degraded"
        || row.authority !== "SOURCE_ONLY_SELF_REPORTED") {
        throw new TypeError("reconciliation row truth is optimistic or unsupported");
      }
    }
    return { valid: true, detail, components: expected, overall };
  } catch (error) {
    return { valid: false, reason: String(error?.message || error) };
  }
}

function changesOf(result) {
  return Number(result?.meta?.changes || 0);
}

async function sourceByIdentity(db, identityKey) {
  return db.prepare("SELECT * FROM source_events WHERE identity_key = ?").bind(identityKey).first();
}

async function transitionStatement(db, sourceEventId, transition, occurredAt, retentionUntil, detail = null, explicitSequence = null) {
  if (explicitSequence === null) {
    return db.prepare(`INSERT INTO source_event_transitions
      (source_transition_id, source_event_id, sequence, transition, occurred_at, detail_json, retention_until)
      SELECT 'srct_' || lower(hex(randomblob(32))), ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?, ?
      FROM source_event_transitions WHERE source_event_id = ?`).bind(
      sourceEventId, transition, occurredAt, detail ? JSON.stringify(detail) : null, retentionUntil, sourceEventId,
    );
  }
  const id = `srct_${await sha256Hex(`${sourceEventId}\u0000${transition}\u0000${occurredAt}\u0000${explicitSequence}`)}`;
  return db.prepare(`INSERT INTO source_event_transitions
    (source_transition_id, source_event_id, sequence, transition, occurred_at, detail_json, retention_until)
    VALUES (?,?,?,?,?,?,?)`).bind(
    id, sourceEventId, explicitSequence, transition, occurredAt, detail ? JSON.stringify(detail) : null, retentionUntil,
  );
}

async function sourceStateTransitions(db, source, finalTransition, nowMs) {
  const transitions = finalTransition === "accepted"
    ? FOLLOW_UP_RELIABILITY_ROUTE.accepted.slice(0, -1).map((stage) => stage.transition)
    : ["received",
      ...(source.authenticationResult === "authenticated" ? ["authenticated"] : []),
      ...(source.normalizationState === "normalized" ? ["normalized"] : []),
      finalTransition];
  return Promise.all(transitions.map((transition, index) => transitionStatement(
    db, source.sourceEventId, transition,
    transition === "received" ? source.receivedAt : nowMs,
    source.normalizedRetentionUntil,
    transition === finalTransition ? { sourceVersion: source.sourceVersion, runtimeVersion: source.runtimeVersion } : null,
    index + 1,
  )));
}

async function readAcceptance(db, sourceEventId) {
  const sourceEvent = await db.prepare("SELECT * FROM source_events WHERE source_event_id = ?").bind(sourceEventId).first();
  const lifecycle = await db.prepare("SELECT * FROM lifecycle_instances WHERE source_event_id = ?").bind(sourceEventId).first();
  const obligations = lifecycle ? (await db.prepare(
    "SELECT * FROM lifecycle_obligations WHERE lifecycle_instance_id = ? ORDER BY obligation_key",
  ).bind(lifecycle.lifecycle_instance_id).all()).results || [] : [];
  return { sourceEvent, lifecycle, obligations };
}

async function returnAcceptedReplay(db, existing, record, nowMs) {
  if (existing.payload_sha256 !== record.sourceEvent.payloadSha256) {
    throw new Error("source identity collision: payload hash differs");
  }
  if (existing.state !== "accepted" || existing.family !== record.sourceEvent.family) {
    throw new Error("existing source identity is not the same accepted lifecycle family");
  }
  const owned = await readAcceptance(db, existing.source_event_id);
  // The first durable acceptance is authoritative. A replay can arrive later or under a newer
  // runtime, so recomputed immediate deadlines and definition metadata are not expected to
  // equal the immutable first record. Verify identity/person/appointment and that the atomic
  // transaction is complete, then return the stored lifecycle unchanged.
  const lifecycleMatches = owned.lifecycle
    && owned.lifecycle.lifecycle_instance_id === record.lifecycle.lifecycleInstanceId
    && owned.lifecycle.family === record.lifecycle.family
    && owned.lifecycle.scope === record.lifecycle.scope
    && owned.lifecycle.person_id === record.lifecycle.personId
    && owned.lifecycle.appointment_id === record.lifecycle.appointmentId;
  if (!lifecycleMatches || owned.obligations.length === 0) throw new Error("existing source event is incomplete");
  await (await transitionStatement(
    db, existing.source_event_id, "deduplicated", nowMs,
    Number(existing.normalized_retention_until), { identityKey: record.sourceEvent.identityKey },
  )).run();
  return { created: false, deduplicated: true, ...owned };
}

export async function acceptLifecycle(db, record, nowMs) {
  if (!db) throw new Error("reliability database unavailable");
  const existing = await sourceByIdentity(db, record.sourceEvent.identityKey);
  if (existing && existing.payload_sha256 !== record.sourceEvent.payloadSha256) {
    throw new Error("source identity collision: payload hash differs");
  }
  if (existing) return returnAcceptedReplay(db, existing, record, nowMs);

  const source = record.sourceEvent;
  const lifecycle = record.lifecycle;
  const sourceInsert = db.prepare(`INSERT INTO source_events
    (source_event_id, provider, family, provider_event_id, identity_version, identity_key, payload_sha256,
     payload_reference, raw_retention_until, normalized_retention_until, occurred_at, received_at, authentication_result,
     normalization_state, normalized_json, rejection_reason, state, source_version, runtime_version,
     accepted_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'accepted',?,?,?,?)`).bind(
    source.sourceEventId, source.provider, source.family, source.providerEventId, source.identityVersion, source.identityKey,
    source.payloadSha256, source.payloadReference, source.rawRetentionUntil, source.normalizedRetentionUntil,
    source.occurredAt, source.receivedAt,
    source.authenticationResult, source.normalizationState, source.normalizedJson, source.sourceVersion,
    source.runtimeVersion, nowMs, nowMs,
  );
  const lifecycleInsert = db.prepare(`INSERT INTO lifecycle_instances
    (lifecycle_instance_id, source_event_id, family, scope, person_id, appointment_id,
     definition_version, runtime_version, state, retention_until, created_at, updated_at)
    SELECT ?,?,?,?,?,?,?,?,'active',?,?,?
    WHERE EXISTS (SELECT 1 FROM source_events WHERE source_event_id = ? AND payload_sha256 = ?)
    ON CONFLICT(lifecycle_instance_id) DO NOTHING`).bind(
    lifecycle.lifecycleInstanceId, source.sourceEventId, lifecycle.family, lifecycle.scope,
    lifecycle.personId, lifecycle.appointmentId, lifecycle.definitionVersion, lifecycle.runtimeVersion,
    lifecycle.retentionUntil,
    nowMs, nowMs, source.sourceEventId, source.payloadSha256,
  );
  const obligationInserts = record.obligations.map((obligation) => db.prepare(`INSERT INTO lifecycle_obligations
    (obligation_id, lifecycle_instance_id, obligation_key, kind, family, deadline_at, owner_role, closer,
     state, retention_until, created_at, updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM lifecycle_instances l JOIN source_events s ON s.source_event_id = l.source_event_id
      WHERE l.lifecycle_instance_id = ? AND s.payload_sha256 = ?
    )
    `).bind(
      obligation.obligationId, lifecycle.lifecycleInstanceId, obligation.obligationKey, obligation.kind,
      lifecycle.family,
    obligation.deadlineAt, obligation.ownerRole, obligation.closer, obligation.initialState,
    obligation.retentionUntil, nowMs, nowMs,
    lifecycle.lifecycleInstanceId, source.payloadSha256,
  ));

  const transitions = await sourceStateTransitions(db, source, "accepted", nowMs);
  let results;
  try {
    results = await db.batch([sourceInsert, ...transitions, lifecycleInsert, ...obligationInserts]);
  } catch (error) {
    const raced = await sourceByIdentity(db, source.identityKey);
    if (!raced) throw error;
    return returnAcceptedReplay(db, raced, record, nowMs);
  }
  const owned = await readAcceptance(db, source.sourceEventId);
  if (!owned.sourceEvent || !owned.lifecycle || owned.obligations.length !== record.obligations.length) {
    throw new Error("durable acceptance did not create the complete lifecycle transaction");
  }
  return { created: changesOf(results[0]) === 1, deduplicated: false, ...owned };
}

export async function markSourceDispatched(db, { sourceEventId, occurredAt }) {
  if (!db || !sourceEventId || !Number.isInteger(occurredAt)) {
    throw new TypeError("database, sourceEventId, and occurredAt are required");
  }
  const source = await db.prepare(
    "SELECT state, normalized_retention_until FROM source_events WHERE source_event_id = ?",
  ).bind(sourceEventId).first();
  if (!source || source.state !== "accepted") throw new Error("only an accepted source event can be dispatched");
  const statement = db.prepare(`INSERT INTO source_event_transitions
    (source_transition_id, source_event_id, sequence, transition, occurred_at, detail_json, retention_until)
    SELECT 'srct_' || lower(hex(randomblob(32))), ?,
      COALESCE((SELECT MAX(sequence) FROM source_event_transitions WHERE source_event_id = ?), 0) + 1,
      'dispatched', ?, NULL, ?
    WHERE EXISTS (
      SELECT 1 FROM lifecycle_instances l
      JOIN lifecycle_obligations o ON o.lifecycle_instance_id = l.lifecycle_instance_id
      WHERE l.source_event_id = ?
    ) AND NOT EXISTS (
      SELECT 1 FROM source_event_transitions WHERE source_event_id = ? AND transition = 'dispatched'
    )`).bind(
    sourceEventId, sourceEventId, occurredAt, Number(source.normalized_retention_until), sourceEventId, sourceEventId,
  );
  const result = await statement.run();
  const dispatched = await db.prepare(
    "SELECT source_transition_id FROM source_event_transitions WHERE source_event_id = ? AND transition = 'dispatched'",
  ).bind(sourceEventId).first();
  if (!dispatched) throw new Error("accepted source event was not durably dispatched");
  return { created: changesOf(result) === 1, sourceEventId, transitionId: dispatched.source_transition_id };
}

async function returnRejectedReplay(db, existing, record, nowMs) {
  const source = record.sourceEvent;
  const exception = record.exception;
  if (existing.payload_sha256 !== source.payloadSha256) throw new Error("source identity collision: payload hash differs");
  if (existing.state !== "rejected" || existing.family !== source.family) {
    throw new Error("existing source identity is not the same rejected lifecycle family");
  }
  const storedException = await db.prepare(
    "SELECT * FROM lifecycle_exceptions WHERE exception_id = ? AND source_event_id = ? AND family = ?",
  ).bind(exception.exceptionId, existing.source_event_id, source.family).first();
  const opened = storedException ? await db.prepare(
    "SELECT * FROM exception_events WHERE exception_id = ? AND event_type = 'opened'",
  ).bind(exception.exceptionId).first() : null;
  if (!storedException || !opened) throw new Error("existing rejected source event is incomplete");
  await (await transitionStatement(
    db, existing.source_event_id, "deduplicated", nowMs,
    Number(existing.normalized_retention_until), { identityKey: source.identityKey },
  )).run();
  return { created: false, deduplicated: true, sourceEventId: existing.source_event_id, exceptionId: exception.exceptionId };
}

export async function rejectSourceEvent(db, record, nowMs) {
  if (!db) throw new Error("reliability database unavailable");
  const source = record.sourceEvent;
  const exception = record.exception;
  const existing = await sourceByIdentity(db, source.identityKey);
  if (existing) return returnRejectedReplay(db, existing, record, nowMs);
  const eventId = `exevt_${await sha256Hex(`${exception.exceptionId}\u0000opened`)}`;
  const sourceInsert = db.prepare(`INSERT INTO source_events
      (source_event_id, provider, family, provider_event_id, identity_version, identity_key, payload_sha256,
       payload_reference, raw_retention_until, normalized_retention_until, occurred_at, received_at, authentication_result,
       normalization_state, normalized_json, rejection_reason, state, source_version, runtime_version,
       accepted_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rejected',?,?,NULL,?)`).bind(
      source.sourceEventId, source.provider, source.family, source.providerEventId, source.identityVersion, source.identityKey,
      source.payloadSha256, source.payloadReference, source.rawRetentionUntil, source.normalizedRetentionUntil,
      source.occurredAt, source.receivedAt,
      source.authenticationResult, source.normalizationState, source.normalizedJson, source.rejectionReason,
      source.sourceVersion, source.runtimeVersion, nowMs,
    );
  const transitions = await sourceStateTransitions(db, source, "rejected", nowMs);
  const statements = [sourceInsert, ...transitions,
    db.prepare(`INSERT INTO lifecycle_exceptions
      (exception_id, family, source_event_id, kind, severity, accountable_owner, next_safe_action, state, retention_until, opened_at, updated_at)
      SELECT ?,?,?,?,?,?,?,'open',?,?,? WHERE EXISTS (
        SELECT 1 FROM source_events WHERE source_event_id = ? AND state = 'rejected'
      )`).bind(
      exception.exceptionId, exception.family, source.sourceEventId, exception.kind, exception.severity,
      exception.accountableOwner, exception.nextSafeAction, exception.retentionUntil, nowMs, nowMs, source.sourceEventId,
    ),
    db.prepare(`INSERT INTO exception_events
      (exception_event_id, exception_id, event_type, actor, occurred_at, evidence_sha256, detail_json, retention_until)
      SELECT ?,?,'opened','system',?,?,?,? WHERE EXISTS (
        SELECT 1 FROM lifecycle_exceptions WHERE exception_id = ?
      )`).bind(
      eventId, exception.exceptionId, nowMs, source.payloadSha256,
      JSON.stringify({ reason: source.rejectionReason }), exception.retentionUntil, exception.exceptionId,
    ),
  ];
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    const raced = await sourceByIdentity(db, source.identityKey);
    if (!raced) throw error;
    return returnRejectedReplay(db, raced, record, nowMs);
  }
  const stored = await sourceByIdentity(db, source.identityKey);
  if (!stored) throw new Error("rejected source event was not durably recorded");
  if (stored.payload_sha256 !== source.payloadSha256) throw new Error("source identity collision: payload hash differs");
  const storedException = await db.prepare(
    "SELECT * FROM lifecycle_exceptions WHERE exception_id = ? AND source_event_id = ?",
  ).bind(exception.exceptionId, stored.source_event_id).first();
  const opened = await db.prepare(
    "SELECT * FROM exception_events WHERE exception_id = ? AND event_type = 'opened'",
  ).bind(exception.exceptionId).first();
  if (!storedException || !opened) throw new Error("rejected source event exception was not durably recorded");
  return { created: changesOf(results[0]) === 1, deduplicated: false, sourceEventId: stored.source_event_id, exceptionId: exception.exceptionId };
}

export async function leaseObligation(db, { obligationId, owner, nowMs, leaseMs }) {
  if (!owner || !Number.isInteger(nowMs) || !Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError("valid owner, nowMs, and leaseMs are required");
  }
  const current = await db.prepare(
    "SELECT * FROM lifecycle_obligations WHERE obligation_id = ?",
  ).bind(obligationId).first();
  if (!current || (current.state !== "pending" && !(current.state === "leased" && Number(current.lease_expires_at) < nowMs))) {
    return { acquired: false };
  }
  const expiresAt = nowMs + leaseMs;
  const eventType = current.state === "leased" ? "taken_over" : "acquired";
  const eventId = `lease_${await sha256Hex(`${obligationId}\u0000${eventType}\u0000${nowMs}\u0000${owner}`)}`;
  const update = db.prepare(`UPDATE lifecycle_obligations
    SET state = 'leased', lease_owner = ?, lease_acquired_at = ?, lease_expires_at = ?, updated_at = ?
    WHERE obligation_id = ? AND (
      state = 'pending' OR (state = 'leased' AND lease_expires_at < ?)
    )`).bind(owner, nowMs, expiresAt, nowMs, obligationId, nowMs);
  const event = db.prepare(`INSERT INTO obligation_lease_events
    (lease_event_id, obligation_id, event_type, previous_owner, new_owner, lease_acquired_at, lease_expires_at, retention_until)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM lifecycle_obligations WHERE obligation_id = ? AND state = 'leased' AND lease_owner = ? AND lease_acquired_at = ?
    )`).bind(
    eventId, obligationId, eventType, current.lease_owner || null, owner, nowMs, expiresAt,
    Number(current.retention_until), obligationId, owner, nowMs,
  );
  const results = await db.batch([update, event]);
  if (changesOf(results[0]) !== 1 || changesOf(results[1]) !== 1) {
    throw new Error("obligation lease changed or its immutable acquisition event was not recorded");
  }
  return { acquired: true, obligation: await db.prepare(
    "SELECT * FROM lifecycle_obligations WHERE obligation_id = ?",
  ).bind(obligationId).first() };
}

export async function readReliabilityHealth(db, options) {
  const authority = { schemaProven: false };
  const result = await readReliabilityHealthResult(db, options, authority);
  return { ...result, schemaProven: authority.schemaProven };
}

async function readReliabilityHealthResult(db, { family, nowMs, maxAgeMs }, authority) {
  if (!db) return { truth: "Unknown", reason: "authority_unavailable", checkedAt: nowMs };
  try {
    const schema = await readReliabilitySchemaAuthority(db);
    authority.schemaProven = schema.proven === true;
    if (family !== FOLLOW_UP_FAMILY) {
      return schema.proven
        ? { truth: "Degraded", reason: "coverage_contract_unsupported", checkedAt: nowMs }
        : { truth: "Degraded", reason: "schema_unproven", schemaReason: schema.reason, checkedAt: nowMs };
    }
    const coverageResult = await db.prepare(`SELECT * FROM reconciliation_runs
      WHERE family = ? ORDER BY started_at DESC, completed_at DESC, reconciliation_run_id DESC LIMIT 2`).bind(family).all();
    const coverageRows = coverageResult?.results || [];
    const coverage = coverageRows[0] || null;
    if (!coverage) {
      return schema.proven
        ? { truth: "Degraded", reason: "coverage_missing", checkedAt: nowMs, schemaVersion: schema.version }
        : {
          truth: "Degraded", reason: "schema_unproven", schemaReason: schema.reason,
          checkedAt: nowMs, schemaVersion: schema.version,
        };
    }
    if (coverageRows[1] && Number(coverageRows[1].started_at) === Number(coverage.started_at)) {
      return { truth: "Degraded", reason: "coverage_ambiguous", checkedAt: nowMs, schemaVersion: schema.version };
    }
    if (!new Set(["complete", "degraded"]).has(coverage.state) || !coverage.completed_at) {
      return { truth: "Degraded", reason: "coverage_incomplete", checkedAt: nowMs, schemaVersion: schema.version };
    }
    const contract = await validateFollowUpReconciliationDetail(coverage.detail_json, coverage);
    if (!contract.valid) {
      if (!schema.proven) {
        return {
          truth: "Degraded", reason: "schema_unproven", schemaReason: schema.reason,
          reasons: ["coverage_contract_invalid", "schema_unproven"], contractReason: contract.reason,
          checkedAt: nowMs, schemaVersion: schema.version,
        };
      }
      return {
        truth: "Degraded", reason: "coverage_contract_invalid", contractReason: contract.reason,
        checkedAt: nowMs, schemaVersion: schema.version,
      };
    }
    if (Number(coverage.completed_at) > nowMs || Number(coverage.coverage_end) > nowMs) {
      return {
        truth: "Degraded", reason: "coverage_clock_invalid", checkedAt: nowMs,
        detailCheckedAt: contract.detail.checkedAt, schemaVersion: schema.version,
      };
    }
    const schemaMatchesDetail = schema.proven
      && schema.version === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.version
      && schema.variantId === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.variantId
      && schema.migrationState === "current_v2"
      && schema.structure?.digest === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.structureSha256
      && schema.version === contract.components.schema.version
      && schema.variantId === contract.components.schema.variantId
      && schema.migrationState === contract.components.schema.migrationState
      && schema.structure?.digest === contract.components.schema.structureSha256;
    const componentTruth = Object.fromEntries(RECONCILIATION_COMPONENT_KEYS.map((key) => [key, {
      truth: contract.components[key].truth,
      reason: contract.components[key].reason,
      evidenceScope: contract.detail.evidenceScope,
    }]));
    const stale = nowMs - Number(coverage.coverage_end) > maxAgeMs
      || nowMs - Number(coverage.completed_at) > maxAgeMs;
    const annotations = [
      ...(!schema.proven ? ["schema_unproven"] : []),
      ...(!schemaMatchesDetail ? ["coverage_schema_mismatch"] : []),
      ...(stale ? ["coverage_stale"] : []),
    ];
    if (contract.overall.truth === "Unknown") {
      return {
        truth: "Unknown", reason: "coverage_unknown",
        reasons: [...new Set([...contract.overall.reasons, ...annotations])].sort(),
        stale, schemaMismatch: !schemaMatchesDetail, checkedAt: nowMs, detailCheckedAt: contract.detail.checkedAt,
        schemaVersion: schema.version, coveredAt: coverage.coverage_end, componentTruth,
      };
    }
    if (stale) {
      return {
        truth: "Degraded", reason: "coverage_stale",
        reasons: [...new Set([...contract.overall.reasons, ...annotations])].sort(),
        stale: true, schemaMismatch: !schemaMatchesDetail, checkedAt: nowMs,
        detailCheckedAt: contract.detail.checkedAt, schemaVersion: schema.version,
        coveredAt: coverage.coverage_end, componentTruth,
      };
    }
    if (!schemaMatchesDetail) {
      return {
        truth: "Degraded", reason: schema.proven ? "coverage_schema_mismatch" : "schema_unproven",
        reasons: [...new Set([...contract.overall.reasons, ...annotations])].sort(),
        stale: false, schemaMismatch: true, checkedAt: nowMs,
        detailCheckedAt: contract.detail.checkedAt, schemaVersion: schema.version,
        schemaReason: schema.proven ? undefined : schema.reason,
        coveredAt: coverage.coverage_end, componentTruth,
      };
    }
    // Contract v1 is structurally source-only and cannot make Staff Known.
    // There is deliberately no reachable Known branch here.
    return {
      truth: "Degraded", reason: "coverage_degraded", reasons: contract.overall.reasons,
      checkedAt: nowMs, detailCheckedAt: contract.detail.checkedAt,
      schemaVersion: schema.version, coveredAt: coverage.coverage_end, componentTruth,
    };
  } catch (error) {
    return { truth: "Unknown", reason: "authority_read_failed", checkedAt: nowMs, error: String(error?.message || error) };
  }
}

export async function readSourceEventDetail(db, sourceEventId, { family } = {}) {
  const source = await db.prepare(
    "SELECT * FROM source_events WHERE source_event_id = ? AND (? IS NULL OR family = ?)",
  ).bind(sourceEventId, family || null, family || null).first();
  if (!source) return null;
  const accepted = await readAcceptance(db, sourceEventId);
  const exceptions = (await db.prepare(
    "SELECT * FROM lifecycle_exceptions WHERE source_event_id = ? ORDER BY opened_at",
  ).bind(sourceEventId).all()).results || [];
  const transitions = (await db.prepare(
    "SELECT * FROM source_event_transitions WHERE source_event_id = ? ORDER BY sequence",
  ).bind(sourceEventId).all()).results || [];
  return { ...accepted, transitions, exceptions };
}

const EXCEPTION_TRANSITIONS = {
  open: new Set(["acknowledged", "suppressed_with_expiry"]),
  acknowledged: new Set(["investigating", "resolved", "suppressed_with_expiry"]),
  investigating: new Set(["resolved", "suppressed_with_expiry"]),
  suppressed_with_expiry: new Set(["open"]),
  resolved: new Set(),
};

const EVENT_FOR_STATE = {
  acknowledged: "acknowledged",
  investigating: "investigating",
  resolved: "resolved",
  suppressed_with_expiry: "suppressed",
  open: "reopened",
};

export async function transitionException(db, {
  exceptionId, fromState, toState, actor, occurredAt, transitionId, evidenceSha256 = null,
  detail = null, suppressionExpiresAt = null,
}) {
  if (!EXCEPTION_TRANSITIONS[fromState]?.has(toState)) {
    throw new TypeError(`invalid exception transition: ${fromState} -> ${toState}`);
  }
  if (!actor || !transitionId || !Number.isInteger(occurredAt)) {
    throw new TypeError("actor, transitionId, and occurredAt are required");
  }
  if (detail !== null && !plainObject(detail)) {
    throw new TypeError("exception transition detail must be a plain object or null");
  }
  if (evidenceSha256 !== null && !/^[a-f0-9]{64}$/.test(evidenceSha256)) {
    throw new TypeError("exception transition evidenceSha256 must be a SHA-256 digest");
  }
  if (toState === "resolved" && evidenceSha256 === null) {
    throw new TypeError("resolved exception transition requires evidenceSha256");
  }
  if (toState === "suppressed_with_expiry"
    && (!Number.isInteger(suppressionExpiresAt) || suppressionExpiresAt <= occurredAt)) {
    throw new TypeError("suppression expiry is required");
  }
  if (toState === "suppressed_with_expiry"
    && Object.hasOwn(detail || {}, "suppressionExpiresAt")
    && detail.suppressionExpiresAt !== suppressionExpiresAt) {
    throw new TypeError("suppression detail conflicts with suppressionExpiresAt");
  }
  const eventDetail = toState === "suppressed_with_expiry"
    ? { ...(detail || {}), suppressionExpiresAt }
    : detail;
  const event = db.prepare(`INSERT INTO exception_events
    (exception_event_id, exception_id, event_type, actor, occurred_at, evidence_sha256, detail_json, retention_until)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM lifecycle_exceptions
      WHERE exception_id = ? AND state = ? AND ? >= updated_at AND ? >= opened_at
    )`).bind(
    transitionId, exceptionId, EVENT_FOR_STATE[toState], actor, occurredAt, evidenceSha256,
    eventDetail ? canonicalReconciliationJson(eventDetail) : null, occurredAt + NORMALIZED_RETENTION_MS,
    exceptionId, fromState, occurredAt, occurredAt,
  );
  const update = db.prepare(`UPDATE lifecycle_exceptions
    SET state = ?, suppression_expires_at = ?, updated_at = ?
    WHERE exception_id = ? AND state = ? AND ? >= updated_at AND ? >= opened_at AND EXISTS (
      SELECT 1 FROM exception_events
      WHERE exception_event_id = ? AND exception_id = ? AND event_type = ? AND actor = ? AND occurred_at = ?
    )`).bind(
    toState, toState === "suppressed_with_expiry" ? suppressionExpiresAt : null,
    occurredAt, exceptionId, fromState, occurredAt, occurredAt,
    transitionId, exceptionId, EVENT_FOR_STATE[toState], actor, occurredAt,
  );
  const results = await db.batch([event, update]);
  if (changesOf(results[0]) !== 1 || changesOf(results[1]) !== 1) {
    throw new Error("exception changed during transition or transition was already recorded");
  }
  return db.prepare("SELECT * FROM lifecycle_exceptions WHERE exception_id = ?").bind(exceptionId).first();
}

export async function readExceptionQueue(db, { family, limit = 100 } = {}) {
  const rows = await db.prepare(`SELECT * FROM lifecycle_exceptions
    WHERE state <> 'resolved' AND (? IS NULL OR family = ?) ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      opened_at ASC LIMIT ?`).bind(family || null, family || null, limit).all();
  return rows.results || [];
}

export async function readRecentSourceEvents(db, { family, limit = 50 } = {}) {
  const rows = await db.prepare(`SELECT
      s.source_event_id, s.provider, s.provider_event_id, s.identity_version, s.payload_sha256,
      s.occurred_at, s.received_at, s.authentication_result, s.normalization_state, s.rejection_reason,
      s.state, s.source_version, s.runtime_version,
      l.lifecycle_instance_id, l.family, l.scope, l.state AS lifecycle_state,
      (SELECT COUNT(*) FROM lifecycle_obligations o WHERE o.lifecycle_instance_id = l.lifecycle_instance_id) AS obligation_count,
      (SELECT COUNT(*) FROM lifecycle_exceptions x WHERE x.source_event_id = s.source_event_id AND x.state <> 'resolved') AS open_exception_count
    FROM source_events s
    LEFT JOIN lifecycle_instances l ON l.source_event_id = s.source_event_id
    WHERE (? IS NULL OR s.family = ?)
    ORDER BY s.received_at DESC LIMIT ?`).bind(family || null, family || null, limit).all();
  return rows.results || [];
}

export async function readReliabilityCounts(db, { family, accountableOwner } = {}) {
  const source = await db.prepare(
    "SELECT COUNT(*) AS count FROM source_events WHERE (? IS NULL OR family = ?)",
  ).bind(family || null, family || null).first();
  const exceptions = await db.prepare(
    `SELECT COUNT(*) AS count FROM lifecycle_exceptions
     WHERE state <> 'resolved' AND (? IS NULL OR family = ?) AND (? IS NULL OR lower(accountable_owner) = lower(?))`,
  ).bind(family || null, family || null, accountableOwner || null, accountableOwner || null).first();
  return { sourceEventTotal: Number(source?.count || 0), exceptionTotal: Number(exceptions?.count || 0) };
}

export async function recordEvidenceAccess(db, { actor, family, action, sourceEventId = null, occurredAt }) {
  if (!actor || !family || !["view_summary", "view_source", "export"].includes(action) || !Number.isInteger(occurredAt)) {
    throw new TypeError("actor, family, action, and occurredAt are required for evidence access");
  }
  const nonce = crypto.randomUUID();
  const accessEventId = `access_${await sha256Hex(`${actor}\u0000${family}\u0000${action}\u0000${sourceEventId || ""}\u0000${occurredAt}\u0000${nonce}`)}`;
  const result = await db.prepare(`INSERT INTO evidence_access_events
    (access_event_id, actor, family, action, source_event_id, occurred_at, retention_until)
    VALUES (?,?,?,?,?,?,?)`).bind(
    accessEventId, actor, family, action, sourceEventId, occurredAt, occurredAt + NORMALIZED_RETENTION_MS,
  ).run();
  if (changesOf(result) !== 1) throw new Error("evidence access was not durably audited");
  return accessEventId;
}
