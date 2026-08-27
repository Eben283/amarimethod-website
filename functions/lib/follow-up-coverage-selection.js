// Pure source-only candidate selection. This neither reads nor writes a store,
// authenticates input rows, dispatches, or proves a lifecycle outcome.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { FOLLOW_UP_FAMILY } from "./reliability-contract.js";

export const FOLLOW_UP_COVERAGE_SELECTION_CONTRACT = "follow-up-coverage-selection.v1";
const ID = /^[A-Za-z0-9:_@.\-/]{1,200}$/;
const OBLIGATION_UNRESOLVED = new Set(["pending", "leased", "overdue_exception"]);
const EXCEPTION_UNRESOLVED = new Set(["open", "acknowledged", "investigating", "suppressed_with_expiry"]);
const HARD_MAX_PAGES = 20;
const HARD_MAX_CANDIDATES = 200;
const REASON = new Set(["new_source", "unresolved_lifecycle", "unresolved_obligation", "open_exception", "carry_forward", "late_linked_evidence", "terminal_anomaly", "retention_expired", "missing_parent", "unsupported_terminal_state", "candidate_missing"]);
const KIND = new Set(["source", "lifecycle", "obligation", "exception", "evidence", "anomaly"]);

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} has unsupported property`);
  }
  return value;
}
function keys(value, allowed, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} unsupported`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} required`);
  return value;
}
function id(value, label) { if (typeof value !== "string" || value.length > 240 || !ID.test(value)) throw new TypeError(`${label} invalid`); return value; }
function time(value, label) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} invalid`); return value; }
function list(value, label, max = HARD_MAX_CANDIDATES) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) throw new TypeError(`${label} invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = descriptors[key];
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} has unsupported property`);
  }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(descriptors, String(index))) throw new TypeError(`${label} must be dense data`);
  return value;
}
function state(value, allowed, label) { if (typeof value !== "string" || !allowed.includes(value)) throw new TypeError(`${label} invalid`); }
function row(value, fields, label) { return keys(value, new Set(fields), label); }
function recordUnique(map, key, value, label) { const prior = map.get(key); if (prior) { if (canonicalJson(prior) !== canonicalJson(value)) throw new TypeError(`${label} conflicts`); return false; } map.set(key, value); return true; }

function candidate(kind, identity, reasonCode) {
  if (!KIND.has(kind) || !REASON.has(reasonCode)) throw new TypeError("candidate kind or reason invalid");
  return { candidateId: `${kind}:${identity}`, kind, identity, reasonCode };
}
function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function stable(left, right) { return compare(left.candidateId, right.candidateId) || compare(left.reasonCode, right.reasonCode); }
function failure(reasonCodes, inputPaginationComplete = false) {
  return Object.freeze({ contract: FOLLOW_UP_COVERAGE_SELECTION_CONTRACT, status: "incomplete", candidates: Object.freeze([]), retainedCarryForward: Object.freeze([]), continuationCursor: null, retainPreviousCarryForward: true, replacementAllowed: false, inputDigestSha256: null, reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()), inputPaginationComplete, authoritativeCoverage: false, simulation: true, sourceOnly: true, authority: false, dispatchAllowed: false, outcomeProven: false });
}

/** Candidate planning only; caller must independently authenticate and persist any future input. */
export async function planFollowUpCoverageSelection(input) {
  try {
    keys(input, new Set(["snapshotPages", "previousCarryForward", "cutoff"]), "input");
    const { snapshotPages, previousCarryForward, cutoff } = input;
    keys(cutoff, new Set(["receivedStart", "receivedEnd", "ingestedStart", "ingestedEnd", "plannedAt", "maxPages", "maxCandidates"]), "cutoff");
    for (const name of ["receivedStart", "receivedEnd", "ingestedStart", "ingestedEnd", "plannedAt"]) time(cutoff[name], `cutoff.${name}`);
    if (!(cutoff.receivedStart < cutoff.receivedEnd && cutoff.ingestedStart < cutoff.ingestedEnd && cutoff.receivedEnd <= cutoff.plannedAt && cutoff.ingestedEnd <= cutoff.plannedAt)) throw new TypeError("cutoff chronology invalid");
    if (!Number.isInteger(cutoff.maxPages) || cutoff.maxPages < 1 || cutoff.maxPages > HARD_MAX_PAGES || !Number.isInteger(cutoff.maxCandidates) || cutoff.maxCandidates < 1 || cutoff.maxCandidates > HARD_MAX_CANDIDATES) throw new TypeError("cutoff bounds invalid");
    keys(snapshotPages, new Set(["pages", "traversalComplete"]), "snapshotPages");
    if (typeof snapshotPages.traversalComplete !== "boolean") throw new TypeError("traversalComplete invalid");
    keys(previousCarryForward, new Set(["candidates", "cursor"]), "previousCarryForward");
    if (previousCarryForward.cursor !== null) throw new TypeError("only full-root replay is supported");
    const pages = list(snapshotPages.pages, "snapshotPages.pages");
    const carry = list(previousCarryForward.candidates, "previousCarryForward.candidates");
    if (pages.length > cutoff.maxPages) return failure(["page_limit_exceeded"]);
    const pagesByCursor = new Map(); let traversalValid = true; let snapshotId = null;
    for (const [index, page] of pages.entries()) {
      row(page, ["snapshotId", "receivedStart", "receivedEnd", "ingestedStart", "ingestedEnd", "cursor", "nextCursor", "sources", "lifecycles", "obligations", "exceptions", "evidence", "anomalies"], `page[${index}]`);
      id(page.snapshotId, "page.snapshotId");
      if (snapshotId === null) snapshotId = page.snapshotId;
      if (snapshotId !== page.snapshotId || page.receivedStart !== cutoff.receivedStart || page.receivedEnd !== cutoff.receivedEnd || page.ingestedStart !== cutoff.ingestedStart || page.ingestedEnd !== cutoff.ingestedEnd || (page.cursor !== null && (typeof page.cursor !== "string" || !ID.test(page.cursor))) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !ID.test(page.nextCursor))) || pagesByCursor.has(page.cursor)) traversalValid = false;
      pagesByCursor.set(page.cursor, page);
    }
    const orderedPages = []; const pageSeen = new Set(); let expectedCursor = null;
    const all = { sources: [], lifecycles: [], obligations: [], exceptions: [], evidence: [], anomalies: [] };
    while (traversalValid && pagesByCursor.has(expectedCursor)) {
      const page = pagesByCursor.get(expectedCursor); orderedPages.push(page);
      if (pageSeen.has(expectedCursor)) { traversalValid = false; break; }
      pageSeen.add(expectedCursor);
      if (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 200 || pageSeen.has(page.nextCursor))) traversalValid = false;
      expectedCursor = page.nextCursor;
      for (const name of Object.keys(all)) all[name].push(...list(page[name], `page.${name}`));
      if (expectedCursor === null) break;
    }
    if (orderedPages.length !== pages.length) traversalValid = false;
    if (!traversalValid || pages.length === 0) return failure(["invalid_page_chain"]);
    const inputPaginationComplete = traversalValid && snapshotPages.traversalComplete === true && pages.length > 0 && expectedCursor === null;
    const sources = new Map(); const lifecycles = new Map(); const obligations = new Map(); const exceptions = new Map(); const evidenceRows = new Map(); const anomalies = new Map(); const candidates = [];
    for (const source of all.sources) {
      row(source, ["sourceEventId", "family", "receivedAt"], "source"); id(source.sourceEventId, "sourceEventId"); if (source.family !== FOLLOW_UP_FAMILY) throw new TypeError("source family invalid"); time(source.receivedAt, "source.receivedAt"); if (source.receivedAt > cutoff.plannedAt) throw new TypeError("source received after plannedAt");
      if (!recordUnique(sources, source.sourceEventId, source, "source")) continue;
      if (source.receivedAt >= cutoff.receivedStart && source.receivedAt < cutoff.receivedEnd) candidates.push(candidate("source", source.sourceEventId, "new_source"));
    }
    for (const lifecycle of all.lifecycles) {
      row(lifecycle, ["lifecycleInstanceId", "sourceEventId", "state", "retentionUntil"], "lifecycle"); id(lifecycle.lifecycleInstanceId, "lifecycleInstanceId"); id(lifecycle.sourceEventId, "lifecycle.sourceEventId"); time(lifecycle.retentionUntil, "lifecycle.retentionUntil");
      state(lifecycle.state, ["active", "completed", "cancelled", "superseded", "exception"], "lifecycle.state");
      if (!recordUnique(lifecycles, lifecycle.lifecycleInstanceId, lifecycle, "lifecycle")) continue;
      if (!sources.has(lifecycle.sourceEventId)) candidates.push(candidate("lifecycle", lifecycle.lifecycleInstanceId, "missing_parent"));
      if (lifecycle.state !== "active") candidates.push(candidate("lifecycle", lifecycle.lifecycleInstanceId, "unsupported_terminal_state"));
      if (lifecycle.retentionUntil <= cutoff.plannedAt) candidates.push(candidate("lifecycle", lifecycle.lifecycleInstanceId, "retention_expired"));
      if (lifecycle.state === "active") candidates.push(candidate("lifecycle", lifecycle.lifecycleInstanceId, "unresolved_lifecycle"));
    }
    for (const obligation of all.obligations) {
      row(obligation, ["obligationId", "lifecycleInstanceId", "state", "deadlineAt", "retentionUntil"], "obligation"); id(obligation.obligationId, "obligationId"); id(obligation.lifecycleInstanceId, "obligation.lifecycleInstanceId"); time(obligation.deadlineAt, "obligation.deadlineAt"); time(obligation.retentionUntil, "obligation.retentionUntil");
      state(obligation.state, ["pending", "leased", "overdue_exception", "satisfied", "skipped", "cancelled"], "obligation.state");
      if (!recordUnique(obligations, obligation.obligationId, obligation, "obligation")) continue;
      if (!lifecycles.has(obligation.lifecycleInstanceId)) candidates.push(candidate("obligation", obligation.obligationId, "missing_parent"));
      if (!OBLIGATION_UNRESOLVED.has(obligation.state)) candidates.push(candidate("obligation", obligation.obligationId, "unsupported_terminal_state"));
      if (obligation.retentionUntil <= cutoff.plannedAt) candidates.push(candidate("obligation", obligation.obligationId, "retention_expired"));
      if (OBLIGATION_UNRESOLVED.has(obligation.state)) candidates.push(candidate("obligation", obligation.obligationId, "unresolved_obligation"));
    }
    for (const exception of all.exceptions) {
      row(exception, ["exceptionId", "family", "state", "retentionUntil"], "exception"); id(exception.exceptionId, "exceptionId"); if (exception.family !== FOLLOW_UP_FAMILY) throw new TypeError("exception family invalid"); time(exception.retentionUntil, "exception.retentionUntil");
      state(exception.state, ["open", "acknowledged", "investigating", "suppressed_with_expiry", "resolved"], "exception.state");
      if (!recordUnique(exceptions, exception.exceptionId, exception, "exception")) continue;
      if (exception.retentionUntil <= cutoff.plannedAt) candidates.push(candidate("exception", exception.exceptionId, "retention_expired"));
      if (!EXCEPTION_UNRESOLVED.has(exception.state)) candidates.push(candidate("exception", exception.exceptionId, "unsupported_terminal_state"));
      if (EXCEPTION_UNRESOLVED.has(exception.state)) candidates.push(candidate("exception", exception.exceptionId, "open_exception"));
    }
    for (const evidence of all.evidence) {
      row(evidence, ["evidenceId", "sourceEventId", "lifecycleInstanceId", "obligationId", "ingestedAt", "eventAt"], "evidence"); id(evidence.evidenceId, "evidenceId"); time(evidence.ingestedAt, "evidence.ingestedAt"); time(evidence.eventAt, "evidence.eventAt"); if (evidence.eventAt > evidence.ingestedAt || evidence.ingestedAt > cutoff.plannedAt) throw new TypeError("evidence clocks invalid");
      for (const field of ["sourceEventId", "lifecycleInstanceId", "obligationId"]) id(evidence[field], `evidence.${field}`);
      if (!recordUnique(evidenceRows, evidence.evidenceId, evidence, "evidence")) continue;
      if (!sources.has(evidence.sourceEventId) || !lifecycles.has(evidence.lifecycleInstanceId) || !obligations.has(evidence.obligationId) || lifecycles.get(evidence.lifecycleInstanceId).sourceEventId !== evidence.sourceEventId || obligations.get(evidence.obligationId).lifecycleInstanceId !== evidence.lifecycleInstanceId) candidates.push(candidate("evidence", evidence.evidenceId, "missing_parent"));
      else if (evidence.ingestedAt >= cutoff.ingestedStart && evidence.ingestedAt < cutoff.ingestedEnd) candidates.push(candidate("evidence", evidence.evidenceId, "late_linked_evidence"));
    }
    for (const anomaly of all.anomalies) { row(anomaly, ["family", "entityType", "entityId", "reasonCode"], "anomaly"); if (anomaly.family !== FOLLOW_UP_FAMILY || !REASON.has(anomaly.reasonCode)) throw new TypeError("anomaly invalid"); id(anomaly.entityType, "anomaly.entityType"); id(anomaly.entityId, "anomaly.entityId"); const anomalyKey = `${anomaly.entityType}:${anomaly.entityId}:${anomaly.reasonCode}`; if (!recordUnique(anomalies, anomalyKey, anomaly, "anomaly")) continue; candidates.push(candidate(anomaly.entityType, anomaly.entityId, anomaly.reasonCode)); }
    const inventory = new Set();
    for (const [kind, rows] of [["source", sources], ["lifecycle", lifecycles], ["obligation", obligations], ["exception", exceptions], ["evidence", evidenceRows]]) {
      for (const identity of rows.keys()) inventory.add(`${kind}:${identity}`);
    }
    for (const anomaly of anomalies.values()) inventory.add(`${anomaly.entityType}:${anomaly.entityId}`);
    const normalizedCarry = new Map();
    for (const item of carry) {
      row(item, ["candidateId", "family", "kind", "identity", "reasonCodes", "unresolved"], "carryForward");
      if (item.family !== FOLLOW_UP_FAMILY || !KIND.has(item.kind)) throw new TypeError("carry family or kind invalid");
      id(item.identity, "carry.identity");
      const reasons = list(item.reasonCodes, "carry.reasonCodes", REASON.size);
      if (item.candidateId !== `${item.kind}:${item.identity}` || !reasons.length || item.unresolved !== true) throw new TypeError("carryForward invalid");
      const prior = normalizedCarry.get(item.candidateId) || { ...item, reasonCodes: new Set() };
      for (const code of reasons) {
        if (typeof code !== "string" || !REASON.has(code)) throw new TypeError("carry reason invalid");
        prior.reasonCodes.add(code); candidates.push(candidate(item.kind, item.identity, code));
      }
      normalizedCarry.set(item.candidateId, prior);
      candidates.push(candidate(item.kind, item.identity, "carry_forward"));
      if (!inventory.has(item.candidateId)) candidates.push(candidate(item.kind, item.identity, "candidate_missing"));
    }
    const merged = new Map();
    for (const item of candidates.sort(stable)) {
      const prior = merged.get(item.candidateId) || { candidateId: item.candidateId, kind: item.kind, identity: item.identity, reasonCodes: new Set() };
      prior.reasonCodes.add(item.reasonCode); merged.set(item.candidateId, prior);
    }
    const unique = [...merged.values()].map((item) => Object.freeze({ ...item, family: FOLLOW_UP_FAMILY, reasonCodes: Object.freeze([...item.reasonCodes].sort(compare)), unresolved: true })).sort((left, right) => compare(left.candidateId, right.candidateId));
    if (unique.length > cutoff.maxCandidates) return failure(["candidate_limit_exceeded", "unresolved_candidates_not_truncated"], inputPaginationComplete);
    const normalizeRows = (items) => [...items].sort((left, right) => compare(canonicalJson(left), canonicalJson(right)));
    const normalizedRows = Object.fromEntries([["sources", sources], ["lifecycles", lifecycles], ["obligations", obligations], ["exceptions", exceptions], ["evidence", evidenceRows], ["anomalies", anomalies]].map(([name, rows]) => [name, normalizeRows([...rows.values()])]));
    const digest = await sha256(canonicalJson({ cutoff, snapshotId, traversalComplete: snapshotPages.traversalComplete,
      pageChain: orderedPages.map(({ cursor, nextCursor }) => ({ cursor, nextCursor })), rows: normalizedRows,
      previousCarryForward: normalizeRows([...normalizedCarry.values()].map((item) => ({ ...item, reasonCodes: [...item.reasonCodes].sort(compare) }))) }));
    const continuationCursor = inputPaginationComplete || expectedCursor === null ? null : Object.freeze({
      snapshotId, receivedStart: cutoff.receivedStart, receivedEnd: cutoff.receivedEnd,
      ingestedStart: cutoff.ingestedStart, ingestedEnd: cutoff.ingestedEnd, nextCursor: expectedCursor,
    });
    return Object.freeze({ contract: FOLLOW_UP_COVERAGE_SELECTION_CONTRACT, status: inputPaginationComplete ? "selected" : "incomplete", candidates: Object.freeze(unique), retainedCarryForward: Object.freeze(unique), continuationCursor, retainPreviousCarryForward: true, replacementAllowed: false, inputDigestSha256: digest, reasonCodes: Object.freeze(inputPaginationComplete ? [] : ["input_pagination_incomplete"]), inputPaginationComplete, authoritativeCoverage: false, simulation: true, sourceOnly: true, authority: false, dispatchAllowed: false, outcomeProven: false });
  } catch (error) { return failure([`invalid_or_ambiguous:${String(error?.message || error).slice(0, 160)}`]); }
}
