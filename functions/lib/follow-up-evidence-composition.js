// Inert source-only read composition. This is not a common historical snapshot,
// provider coverage proof, durable checkpoint, carry replacement, or dispatch path.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { FOLLOW_UP_FAMILY } from "./reliability-contract.js";
import { observeFollowUpCurrentInventory } from "./follow-up-current-inventory.js";
import { FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, readFollowUpEffectEvidenceJournal } from "./follow-up-effect-evidence-store.js";

export const FOLLOW_UP_EVIDENCE_COMPOSITION_CONTRACT = "follow-up-evidence-composition.v1";
const SCOPE = "separate_inventory_read_and_fixed_journal_boundary";
const FLAGS = Object.freeze({ simulation: true, sourceOnly: true, retainPreviousCarryForward: true,
  authority: false, authoritativeCoverage: false, producerAdopted: false, dispatchAllowed: false,
  outcomeProven: false, replacementAllowed: false, watermarkAdvanceAllowed: false });
const LIMITATIONS = ["provider_coverage_unproven", "separate_observation_scopes", "stored_structural_links_only"];
const INVENTORY_FLAGS = { simulation: true, sourceOnly: true, authority: false, dispatchAllowed: false,
  outcomeProven: false, replacementAllowed: false, retainPreviousCarryForward: true };
const JOURNAL_FLAGS = { simulation: true, sourceOnly: true, authority: false, dispatchAllowed: false,
  outcomeProven: false, replacementAllowed: false, watermarkAdvanceAllowed: false, provenanceScope: "stored_structural_links_only" };
const LEGACY_REASONS = new Set(["new_source", "unresolved_lifecycle", "unresolved_obligation", "open_exception", "carry_forward",
  "late_linked_evidence", "terminal_anomaly", "retention_expired", "missing_parent", "unsupported_terminal_state", "candidate_missing"]);
const REASONS = new Set([...LEGACY_REASONS, "sequenced_evidence", "journal_linked_parent", "conflicting_receipt_evidence"]);
const KINDS = new Set(["source", "lifecycle", "obligation", "exception", "evidence", "anomaly"]);
const INVENTORY_KINDS = new Set(["source", "lifecycle", "obligation", "exception"]);
const REQUIRED_FAILURES = new Set(["retention_expired", "missing_parent", "candidate_missing"]);
const SAFE_FAILURES = new Set(["invalid_input", "invalid_carry", "inventory_unavailable", "malformed_inventory",
  "required_inventory_evidence_unavailable", "journal_unavailable", "malformed_journal", "invalid_journal_chain",
  "journal_identity_conflict", "journal_page_limit_exceeded", "candidate_limit_exceeded", "composition_unavailable"]);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^id_[a-f0-9]{64}$/;
const CANDIDATE_FIELDS = ["candidateId", "family", "kind", "identity", "reasonCodes", "unresolved"];
const CUTOFF_FIELDS = ["receivedStart", "receivedEnd", "ingestedStart", "ingestedEnd", "plannedAt", "maxPages", "maxCandidates"];
const ROW_FIELDS = ["sequence", "previousSequence", "eventId", "commandAttemptId", "sourceEventId", "lifecycleInstanceId", "obligationId",
  "family", "eventType", "eventDigestSha256", "stateBefore", "stateAfter", "occurrenceAt", "observedAt", "ingestedAt",
  "provider", "providerReferenceSha256", "proofLevel", "evidenceSha256", "detailSha256", "conflict", "retentionUntil"];
const TRANSITIONS = { prepared: ["submitted", "ambiguous", "failed_retryable", "failed_terminal"],
  submitted: ["ambiguous", "failed_retryable", "failed_terminal"], failed_retryable: ["ambiguous", "failed_terminal"], ambiguous: ["failed_terminal"] };

function stop(code) { throw new Error(code); }
function exact(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...fields].sort().join()) stop(code);
}
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) stop(code);
}
function hash(value, code) { if (typeof value !== "string" || !HASH.test(value)) stop(code); }
function ownedId(value, code) { if (typeof value !== "string" || !ID.test(value)) stop(code); }
function matches(value, expected, code) {
  for (const [key, item] of Object.entries(expected)) if (value[key] !== item) stop(code);
}
function freeze(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

// Clone data descriptors, never caller getters. The clone is complete before any
// await, including nested carry/reason lists. Reader envelopes get the same guard.
function snapshot(value, code, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 25000 || depth > 12) stop(code);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) stop(code); return value; }
  if (typeof value === "string") { if (value.length > 512) stop(code); return value; }
  if (!value || typeof value !== "object") stop(code);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) stop(code);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const length = array ? descriptors.length.value : null;
  if ((array && length > 1000) || (!array && keys.length > 100)) stop(code);
  const pairs = [];
  for (const key of keys) {
    if (array && key === "length") continue;
    const d = descriptors[key];
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
      || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) stop(code);
    pairs.push([key, snapshot(d.value, code, depth + 1, budget)]);
  }
  if (!array) return Object.fromEntries(pairs);
  if (pairs.length !== length) stop(code);
  const copied = new Array(length);
  for (const [key, item] of pairs) copied[Number(key)] = item;
  return copied;
}
function candidates(value, reasons, code) {
  if (!Array.isArray(value) || value.length > 200) stop(code);
  for (const item of value) {
    exact(item, CANDIDATE_FIELDS, code); ownedId(item.identity, code);
    if (item.family !== FOLLOW_UP_FAMILY || !KINDS.has(item.kind) || item.candidateId !== `${item.kind}:${item.identity}`
      || item.unresolved !== true || !Array.isArray(item.reasonCodes) || !item.reasonCodes.length || item.reasonCodes.length > reasons.size) stop(code);
    for (const reason of item.reasonCodes) if (!reasons.has(reason)) stop(code);
  }
}
function carry(value) {
  exact(value, ["candidates", "cursor"], "invalid_carry");
  if (value.cursor !== null) stop("invalid_carry");
  candidates(value.candidates, REASONS, "invalid_carry");
  return freeze(value);
}
function add(merged, kind, identity, reasons, maximum = 200) {
  const candidateId = `${kind}:${identity}`;
  if (!merged.has(candidateId)) merged.set(candidateId, { candidateId, family: FOLLOW_UP_FAMILY, kind, identity, reasonCodes: new Set(), unresolved: true });
  for (const reason of reasons) merged.get(candidateId).reasonCodes.add(reason);
  if (merged.size > maximum) stop("candidate_limit_exceeded");
}
function normalized(merged) {
  return [...merged.values()].map((item) => ({ ...item, reasonCodes: [...item.reasonCodes].sort() }))
    .sort((a, b) => a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0);
}
function normalizeCarry(value) {
  const merged = new Map();
  for (const item of value.candidates) add(merged, item.kind, item.identity, item.reasonCodes);
  return { candidates: normalized(merged), cursor: null };
}
function optionsSnapshot(options, previous) {
  const input = snapshot(options, "invalid_input");
  exact(input, ["inventoryOptions", "previousCarryForward", "journalPageSize", "maxJournalPages", "maxCandidates"], "invalid_input");
  if (!previous) stop("invalid_carry");
  // The separately validated original carry remains the one retained on failure.
  if (canonicalJson(input.previousCarryForward) !== canonicalJson(previous)) stop("invalid_carry");
  exact(input.inventoryOptions, ["readAt", "limit", "cutoff"], "invalid_input");
  const { readAt, limit, cutoff } = input.inventoryOptions;
  exact(cutoff, CUTOFF_FIELDS, "invalid_input");
  for (const name of CUTOFF_FIELDS.slice(0, 5)) integer(cutoff[name], 0, Number.MAX_SAFE_INTEGER, "invalid_input");
  if (readAt !== cutoff.plannedAt || !(cutoff.receivedStart < cutoff.receivedEnd && cutoff.ingestedStart < cutoff.ingestedEnd
    && cutoff.receivedEnd <= readAt && cutoff.ingestedEnd <= readAt)) stop("invalid_input");
  for (const n of [limit, cutoff.maxCandidates, input.maxCandidates, input.journalPageSize]) integer(n, 1, 200, "invalid_input");
  for (const n of [cutoff.maxPages, input.maxJournalPages]) integer(n, 1, 20, "invalid_input");
  return freeze(input);
}
function inventoryResult(value, input) {
  const r = snapshot(value, "malformed_inventory");
  if (r?.status !== "observed") stop("inventory_unavailable");
  exact(r, ["contract", ...Object.keys(INVENTORY_FLAGS), "status", "readAt", "stateTimeScope", "schemaCapability", "inventoryComplete",
    "carryIdentityDomain", "lateEvidenceProjection", "reasonCodes", "snapshotDigest", "selection"], "malformed_inventory");
  matches(r, { ...INVENTORY_FLAGS, contract: "follow-up-current-inventory.v1", readAt: input.inventoryOptions.readAt,
    stateTimeScope: "current_at_read_not_historical", schemaCapability: "required_columns_present_not_schema_authority",
    inventoryComplete: true, carryIdentityDomain: "id_sha256_owned_identity.v1", lateEvidenceProjection: "unavailable" }, "malformed_inventory");
  hash(r.snapshotDigest, "malformed_inventory");
  if (!Array.isArray(r.reasonCodes) || !r.reasonCodes.includes("late_evidence_ingestion_and_linkage_unavailable")
    || r.reasonCodes.some((x) => !["late_evidence_ingestion_and_linkage_unavailable", "family_level_exception_has_no_entity_link"].includes(x))) stop("malformed_inventory");
  const s = r.selection;
  exact(s, ["contract", "status", "candidates", "retainedCarryForward", "continuationCursor", ...Object.keys(INVENTORY_FLAGS),
    "inputDigestSha256", "reasonCodes", "inputPaginationComplete", "authoritativeCoverage"], "malformed_inventory");
  matches(s, { ...INVENTORY_FLAGS, contract: "follow-up-coverage-selection.v1", status: "selected", continuationCursor: null,
    inputPaginationComplete: true, authoritativeCoverage: false }, "malformed_inventory");
  hash(s.inputDigestSha256, "malformed_inventory"); candidates(s.candidates, LEGACY_REASONS, "malformed_inventory");
  candidates(s.retainedCarryForward, LEGACY_REASONS, "malformed_inventory");
  if (!Array.isArray(s.reasonCodes) || s.reasonCodes.length || canonicalJson(s.retainedCarryForward) !== canonicalJson(s.candidates)
    || s.candidates.some((c) => !INVENTORY_KINDS.has(c.kind))) stop("malformed_inventory");
  return r;
}
function boundary(value) {
  exact(value, ["contract", "throughSequence", "eventIdSha256", "eventDigestSha256"], "malformed_journal");
  if (value.contract !== FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT) stop("malformed_journal");
  integer(value.throughSequence, 0, Number.MAX_SAFE_INTEGER, "malformed_journal");
  if (value.throughSequence === 0) {
    if (value.eventIdSha256 !== null || value.eventDigestSha256 !== null) stop("malformed_journal");
  } else { hash(value.eventIdSha256, "malformed_journal"); hash(value.eventDigestSha256, "malformed_journal"); }
}
function journalRow(row) {
  exact(row, ROW_FIELDS, "malformed_journal");
  for (const key of ["eventId", "commandAttemptId", "sourceEventId", "lifecycleInstanceId", "obligationId"]) ownedId(row[key], "malformed_journal");
  for (const key of ["eventDigestSha256", "detailSha256"]) hash(row[key], "malformed_journal");
  for (const key of ["providerReferenceSha256", "evidenceSha256"]) if (row[key] !== null) hash(row[key], "malformed_journal");
  integer(row.sequence, 1, Number.MAX_SAFE_INTEGER, "malformed_journal");
  for (const key of ["previousSequence", "occurrenceAt", "ingestedAt", "retentionUntil"]) integer(row[key], 0, Number.MAX_SAFE_INTEGER, "malformed_journal");
  if (row.observedAt !== null) integer(row.observedAt, 0, Number.MAX_SAFE_INTEGER, "malformed_journal");
  if (row.family !== FOLLOW_UP_FAMILY || typeof row.conflict !== "boolean" || row.previousSequence >= row.sequence
    || row.occurrenceAt > row.ingestedAt || row.retentionUntil <= row.ingestedAt || row.retentionUntil > row.ingestedAt + 34560000000) stop("malformed_journal");
  if (row.eventType === "prepared") {
    if (row.previousSequence !== 0 || row.stateBefore !== null || row.stateAfter !== "prepared" || row.conflict
      || [row.observedAt, row.provider, row.providerReferenceSha256, row.proofLevel, row.evidenceSha256].some((v) => v !== null)) stop("malformed_journal");
  } else if (row.eventType === "observation") {
    if (row.previousSequence === 0 || typeof row.stateBefore !== "string" || !Object.hasOwn(TRANSITIONS, row.stateBefore)
      || !TRANSITIONS[row.stateBefore].includes(row.stateAfter) || row.conflict
      || [row.observedAt, row.provider, row.proofLevel, row.evidenceSha256].some((v) => v !== null)) stop("malformed_journal");
  } else if (row.eventType === "receipt") {
    if (row.previousSequence === 0 || row.stateBefore !== null || row.stateAfter !== null || row.observedAt !== row.occurrenceAt
      || !["gmail", "ghl"].includes(row.provider) || !["accepted", "delivered", "failed", "bounced", "unknown"].includes(row.proofLevel)
      || row.providerReferenceSha256 === null || row.evidenceSha256 === null) stop("malformed_journal");
  } else stop("malformed_journal");
}
function journalPage(value, requested, pageSize, frozenBoundary) {
  const p = snapshot(value, "malformed_journal");
  if (p?.status !== "observed") stop("journal_unavailable");
  exact(p, ["contract", ...Object.keys(JOURNAL_FLAGS), "status", "durable", "scope", "afterSequence", "throughSequence", "boundary", "rows",
    "nextSequence", "hasMore", "traversalComplete", "continuation", "reasonCodes"], "malformed_journal");
  matches(p, { ...JOURNAL_FLAGS, contract: FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, durable: false, scope: "journal_sequence_traversal_only",
    afterSequence: requested.afterSequence }, "malformed_journal");
  boundary(p.boundary);
  if (p.throughSequence !== p.boundary.throughSequence || (frozenBoundary !== null && canonicalJson(p.boundary) !== canonicalJson(frozenBoundary))
    || !Array.isArray(p.rows) || p.rows.length > pageSize || typeof p.hasMore !== "boolean" || p.traversalComplete !== !p.hasMore
    || !Array.isArray(p.reasonCodes) || p.reasonCodes.length) stop("invalid_journal_chain");
  let last = requested.afterSequence;
  for (const row of p.rows) {
    journalRow(row);
    if (row.sequence <= last || row.sequence > p.throughSequence) stop("invalid_journal_chain");
    last = row.sequence;
  }
  if (p.nextSequence !== last) stop("invalid_journal_chain");
  if (p.hasMore) {
    if (p.rows.length !== pageSize || last >= p.throughSequence) stop("invalid_journal_chain");
    exact(p.continuation, ["afterSequence", "throughSequence", "boundary"], "invalid_journal_chain");
    if (p.continuation.afterSequence !== last || p.continuation.throughSequence !== p.throughSequence
      || canonicalJson(p.continuation.boundary) !== canonicalJson(p.boundary)) stop("invalid_journal_chain");
  } else if (p.continuation !== null || last !== p.throughSequence) stop("invalid_journal_chain");
  if (last === p.throughSequence && last > 0) {
    const head = p.rows.at(-1);
    if (!head || head.eventId !== `id_${p.boundary.eventIdSha256}` || head.eventDigestSha256 !== p.boundary.eventDigestSha256) stop("invalid_journal_chain");
  }
  return freeze(p);
}
function linkEvent(row, attempts, events, parents, receiptOwners) {
  if (events.has(row.eventId)) stop("journal_identity_conflict");
  events.add(row.eventId);
  // Parent links are identities, not membership in the inventory *selection*.
  for (const [key, parent] of [[`lifecycle:${row.lifecycleInstanceId}`, row.sourceEventId], [`obligation:${row.obligationId}`, row.lifecycleInstanceId]]) {
    if (parents.has(key) && parents.get(key) !== parent) stop("journal_identity_conflict");
    parents.set(key, parent);
  }
  let prior = attempts.get(row.commandAttemptId);
  if (!prior) {
    if (row.eventType !== "prepared" || row.previousSequence !== 0) stop("invalid_journal_chain");
    prior = { source: row.sourceEventId, lifecycle: row.lifecycleInstanceId, obligation: row.obligationId, sequence: 0,
      state: "prepared", reference: null, submittedReference: null, provider: null, retentionUntil: row.retentionUntil };
    attempts.set(row.commandAttemptId, prior);
  } else if (row.eventType === "prepared" || row.sourceEventId !== prior.source || row.lifecycleInstanceId !== prior.lifecycle
    || row.obligationId !== prior.obligation || row.retentionUntil !== prior.retentionUntil) stop("journal_identity_conflict");
  // previousSequence belongs to this attempt. Global committed allocation gaps
  // and interleaved attempts are valid and are never interpreted as missing rows.
  if (row.previousSequence !== prior.sequence) stop("invalid_journal_chain");
  if (row.eventType === "observation") {
    if (row.stateBefore !== prior.state || (row.providerReferenceSha256 !== null && prior.reference !== null
      && row.providerReferenceSha256 !== prior.reference)) stop("invalid_journal_chain");
    prior.state = row.stateAfter;
    if (row.providerReferenceSha256 !== null) prior.reference = row.providerReferenceSha256;
    if (row.stateAfter === "submitted") prior.submittedReference = row.providerReferenceSha256;
  } else if (row.eventType === "receipt") {
    if (prior.submittedReference === null || row.providerReferenceSha256 !== prior.submittedReference
      || (prior.provider !== null && row.provider !== prior.provider)) stop("invalid_journal_chain");
    const receiptKey = `${row.provider}:${row.providerReferenceSha256}`;
    const owner = receiptOwners.get(receiptKey) || { commandAttemptId: row.commandAttemptId, proofs: new Map() };
    if (owner.commandAttemptId !== row.commandAttemptId) stop("journal_identity_conflict");
    // Mirror the frozen writer's per-receipt conflict predicate. A prior conflict
    // does not make every later row conflicting, and extra canonical receipts
    // outside this journal may explain a true flag without an earlier journal row.
    const contradicts = [...owner.proofs].some(([proof, digests]) =>
      (proof === row.proofLevel && [...digests].some((d) => d !== row.evidenceSha256))
      || (proof === "delivered" && ["failed", "bounced"].includes(row.proofLevel))
      || (row.proofLevel === "delivered" && ["failed", "bounced"].includes(proof)));
    if (contradicts && !row.conflict) stop("invalid_journal_chain");
    if (!owner.proofs.has(row.proofLevel)) owner.proofs.set(row.proofLevel, new Set());
    owner.proofs.get(row.proofLevel).add(row.evidenceSha256);
    receiptOwners.set(receiptKey, owner);
    prior.provider = row.provider;
  }
  prior.sequence = row.sequence;
}
function safeFailure(error, fallback) {
  try {
    const message = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
    if (SAFE_FAILURES.has(message)) return message;
  } catch { /* Untrusted exceptions are not output data. */ }
  return fallback;
}

/** Full-root, bounded, SELECT-only candidate union. No caller completion claims. */
export async function observeFollowUpEvidenceComposition(db, options) {
  let previous = null, inventorySnapshotDigest = null, journalBoundary = null, journalTraversalComplete = false, journalPagesRead = 0;
  let failureStage = "invalid_input";
  const envelope = () => ({ contract: FOLLOW_UP_EVIDENCE_COMPOSITION_CONTRACT, ...FLAGS, family: FOLLOW_UP_FAMILY, observationScope: SCOPE,
    inventorySnapshotDigest, journalBoundary, journalTraversalComplete, journalPagesRead,
    retainedPriorCarryForward: previous, previousCarryForwardValidated: previous !== null });
  try {
    // Preserve valid carry even if some unrelated input option is invalid. No
    // malformed carry payload is echoed; retainPreviousCarryForward stays true.
    const d = options && typeof options === "object" ? Object.getOwnPropertyDescriptor(options, "previousCarryForward") : null;
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) stop("invalid_carry");
    previous = carry(snapshot(d.value, "invalid_carry"));
    const input = optionsSnapshot(options, previous), normalizedPrevious = normalizeCarry(previous), merged = new Map();
    for (const item of normalizedPrevious.candidates) add(merged, item.kind, item.identity, [...item.reasonCodes, "carry_forward"], input.maxCandidates);
    const inventoryCarry = { candidates: normalizedPrevious.candidates.filter((c) => INVENTORY_KINDS.has(c.kind))
      .map((c) => ({ ...c, reasonCodes: ["carry_forward"] })), cursor: null };
    failureStage = "inventory_unavailable";
    const inventory = inventoryResult(await observeFollowUpCurrentInventory(db, { ...input.inventoryOptions, previousCarryForward: inventoryCarry }), input);
    inventorySnapshotDigest = inventory.snapshotDigest;
    // Only fresh inventory findings imply missing/expired required evidence.
    // Historical carry reasons are retained but are not relabeled as fresh facts.
    if (inventory.selection.candidates.some((c) => c.reasonCodes.some((r) => REQUIRED_FAILURES.has(r)))) stop("required_inventory_evidence_unavailable");
    for (const item of inventory.selection.candidates) add(merged, item.kind, item.identity, item.reasonCodes, input.maxCandidates);

    failureStage = "journal_unavailable";
    const journalEvidence = [], pageChain = [], attempts = new Map(), events = new Set(), parents = new Map(), receiptOwners = new Map();
    let requested = { afterSequence: 0, throughSequence: null, limit: input.journalPageSize, boundary: null };
    while (journalPagesRead < input.maxJournalPages) {
      const page = journalPage(await readFollowUpEffectEvidenceJournal(db, requested), requested, input.journalPageSize, journalBoundary);
      journalPagesRead += 1; journalBoundary = page.boundary;
      pageChain.push({ afterSequence: page.afterSequence, nextSequence: page.nextSequence, hasMore: page.hasMore });
      for (const row of page.rows) {
        linkEvent(row, attempts, events, parents, receiptOwners);
        add(merged, "evidence", row.eventId, ["sequenced_evidence", ...(row.conflict ? ["conflicting_receipt_evidence"] : [])], input.maxCandidates);
        for (const [kind, id] of [["source", row.sourceEventId], ["lifecycle", row.lifecycleInstanceId], ["obligation", row.obligationId]]) {
          add(merged, kind, id, ["journal_linked_parent", ...(row.conflict && kind === "obligation" ? ["conflicting_receipt_evidence"] : [])], input.maxCandidates);
        }
        journalEvidence.push(row);
      }
      if (!page.hasMore) { journalTraversalComplete = true; break; }
      requested = { ...page.continuation, limit: input.journalPageSize };
    }
    if (!journalTraversalComplete) stop("journal_page_limit_exceeded");
    const union = normalized(merged);
    failureStage = "composition_unavailable";
    const inputDigestSha256 = await sha256(canonicalJson({ contract: FOLLOW_UP_EVIDENCE_COMPOSITION_CONTRACT, family: FOLLOW_UP_FAMILY,
      inventoryOptions: input.inventoryOptions, previousCarryForward: normalizedPrevious, journalPageSize: input.journalPageSize,
      maxJournalPages: input.maxJournalPages, maxCandidates: input.maxCandidates, inventorySnapshotDigest,
      inventorySelectionDigestSha256: inventory.selection.inputDigestSha256, journalBoundary, pageChain, journalEvidence, candidates: union }));
    return freeze({ ...envelope(), status: "composed", journalEvidence, candidates: union, proposedCarryForward: { candidates: union, cursor: null },
      inputDigestSha256, reasonCodes: [...LIMITATIONS, ...inventory.reasonCodes.filter((r) => r === "family_level_exception_has_no_entity_link")].sort() });
  } catch (error) {
    return freeze({ ...envelope(), status: "incomplete", journalEvidence: [], candidates: [], proposedCarryForward: null, inputDigestSha256: null,
      reasonCodes: [...LIMITATIONS, safeFailure(error, failureStage)].sort() });
  }
}
