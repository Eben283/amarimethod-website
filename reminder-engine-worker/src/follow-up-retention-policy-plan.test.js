import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import {
  FOLLOW_UP_RETENTION_BASIS as BASIS, FOLLOW_UP_RETENTION_RECORD_KINDS as KINDS,
  FOLLOW_UP_RETENTION_INVENTORY_CONTRACT as INVENTORY, FOLLOW_UP_RETENTION_EPOCH_CONTRACT as EPOCH,
  FOLLOW_UP_RETENTION_POLICY_CONTRACT as CONTRACT, FOLLOW_UP_RETENTION_LIMITS as LIMITS,
  planFollowUpRetentionDeadline as deadline, planFollowUpRetentionMaintenance as maintenance,
  classifyFollowUpRetentionEpoch as epoch,
} from "../../functions/lib/follow-up-retention-policy-plan.js";

// Synthetic identity metadata ONLY. Nothing in these fixtures is a provider
// read, an authenticated approval, a durable witness, or an executable purge.
const DAY = 86400000, NOW = Date.UTC(2026, 7, 27, 16), sha = (v) => createHash("sha256").update(typeof v === "string" ? v : canonicalJson(v)).digest("hex");
const id = (v) => `id_${sha(String(v))}`, clone = (v) => structuredClone(v), sorted = (v) => [...v].sort();
const originKinds = { effect: "binding_created", inventory: "source_received", diagnostic: "diagnostic_created", recovery_manifest: "manifest_created", privacy_request: "request_closed", suppression: "deletion_recorded" };
function identity(name, dataClass = "inventory", at = NOW - DAY, subject = "A", originName = `${name}:origin`) {
  const origin = { id: id(originName), kind: originKinds[dataClass], at };
  origin.commitmentSha256 = sha({ contract: "follow-up-retention-origin.v1", basis: BASIS, originId: origin.id, kind: origin.kind, originalAt: at });
  return { id: id(name), subjectId: subject === null ? null : id(`subject:${subject}`), dataClass, origin, parentDeadlines: [], inheritedDeadlineAt: null, deletionDueAt: null };
}
function route(name = "backup", throughAt = NOW + DAY, verifiedAt = NOW) {
  const r = { id: id(`route:${name}`), kind: name, throughAt, verifiedAt };
  return { ...r, commitmentSha256: sha({ contract: "follow-up-retention-horizon.v1", basis: BASIS, ...r }) };
}
const horizons = (routes = [], complete = true) => ({ complete, routes });
const deadlineInput = (i = identity("effect", "effect"), asOf = NOW, h = horizons()) => ({ basis: clone(BASIS), asOf, identity: i, horizons: h });
function record(name, kind, identities, parents = {}, proofIds = [], eventKind = null, unresolved = false) {
  return { id: id(name), kind, identityIds: identities.map((x) => typeof x === "string" ? id(x) : x.id),
    parents: Object.entries(parents).map(([role, value]) => ({ role, id: id(value) })), proofIds: proofIds.map(id), eventKind, unresolved };
}
function sealInventory(input) {
  const inv = input.inventory ?? input;
  inv.sections = KINDS.map((kind) => ({ kind, complete: true, recordIds: sorted(inv.records.filter((r) => r.kind === kind).map((r) => r.id)) })).sort((a, b) => a.kind < b.kind ? -1 : 1);
  const normalized = { contract: inv.contract, scopeId: inv.scopeId, capturedAt: inv.capturedAt, complete: inv.complete,
    sections: inv.sections, identities: inv.identities.map((i) => ({ ...i, parentDeadlines: [...i.parentDeadlines].sort((a, b) => a.id < b.id ? -1 : 1) })).sort((a, b) => a.id < b.id ? -1 : 1),
    records: inv.records.map((r) => ({ ...r, identityIds: sorted(r.identityIds), parents: [...r.parents].sort((a, b) => a.role < b.role ? -1 : 1), proofIds: sorted(r.proofIds) })).sort((a, b) => a.id < b.id ? -1 : 1) };
  inv.digestSha256 = sha({ basis: input.basis ?? BASIS, inventory: normalized }); return input;
}
function maintenanceInput(identities, records) {
  return sealInventory({ basis: clone(BASIS), asOf: NOW, inventory: { contract: INVENTORY, scopeId: id("scope"), capturedAt: NOW,
    complete: true, identities, records, sections: [], digestSha256: sha("pending") }, deletion: null, holds: [], replacements: [], horizons: horizons() });
}
function simple(at = NOW - DAY, dataClass = "inventory") {
  const i = identity("simple", dataClass, at), kind = { inventory: "source", diagnostic: "diagnostic", recovery_manifest: "recovery_manifest", privacy_request: "privacy_request", suppression: "suppression_key" }[dataClass];
  return maintenanceInput([i], [record("simple:origin", kind, [i])]);
}
function graph() {
  const shared = identity("release", "recovery_manifest", NOW - DAY, null, "manifest"), identities = [shared], records = [record("manifest", "release_manifest", [shared]), record("attestation", "deployment_attestation", [shared], { manifest: "manifest" })];
  for (const who of ["A", "B"]) {
    const i = identity(`inventory${who}`, "inventory", NOW - 4 * DAY, who, `source${who}`), e = identity(`effect${who}`, "effect", NOW - DAY, who, `binding${who}`); identities.push(i, e);
    records.push(record(`source${who}`, "source", [i]), record(`life${who}`, "lifecycle", [i], { source: `source${who}` }),
      record(`obligation${who}`, "obligation", [i], { lifecycle: `life${who}` }), record(`command${who}`, "command_attempt", [i], { obligation: `obligation${who}` }),
      record(`receipt${who}`, "provider_receipt", [i], { command: `command${who}` }), record(`lease${who}`, "lease_event", [i], { obligation: `obligation${who}` }),
      record(`transition${who}`, "source_transition", [i], { source: `source${who}` }), record(`exception${who}`, "exception", [i], { source: `source${who}`, lifecycle: `life${who}`, obligation: `obligation${who}` }),
      record(`exceptionEvent${who}`, "exception_event", [i], { exception: `exception${who}` }), record(`provenance${who}`, "provenance", [i], { source: `source${who}`, lifecycle: `life${who}`, attestation: "attestation" }),
      record(`binding${who}`, "effect_binding", [e], { command: `command${who}`, source: `source${who}`, lifecycle: `life${who}`, obligation: `obligation${who}`, lease: `lease${who}`, acceptance_attestation: "attestation", acceptance_manifest: "manifest", executor_attestation: "attestation", executor_manifest: "manifest" }),
      record(`prepared${who}`, "effect_event", [e], { binding: `binding${who}` }, [], "prepared", true),
      record(`event${who}`, "effect_event", [e], { binding: `binding${who}` }, [`receipt${who}`], "receipt", true));
  }
  records.push(record("checkpoint", "consumer_checkpoint", ["effectA", "effectB"], {}, ["eventA", "eventB"], null, true),
    record("memberA", "retained_reason", ["effectA"], { checkpoint: "checkpoint" }, ["eventA"], null, true),
    record("memberB", "retained_reason", ["effectB"], { checkpoint: "checkpoint" }, ["eventB"], null, true));
  return maintenanceInput(identities, records);
}
const row = (x, name) => x.inventory.records.find((r) => r.id === id(name));
const ident = (x, name) => x.inventory.identities.find((r) => r.id === id(name));
function deletion(who = "A", patch = {}) { return { ticketId: id("ticket"), subjectIds: [id(`subject:${who}`)], receivedAt: NOW - DAY, verifiedAt: NOW - 5000, approvedAt: NOW - 4000, dueAt: NOW + 10 * DAY, approvedBy: "Eben", commitmentSha256: sha("synthetic approval commitment"), ...patch }; }
function hold(i, patch = {}) { return { id: id("hold"), identityIds: [i.id], basisCode: "legal_hold", approvedBy: "Eben", approvedAt: NOW - DAY, nextReviewAt: NOW + DAY, releasedAt: null, signatureCommitmentSha256: sha("synthetic signature commitment"), ...patch }; }
function addReplacement(x, { names = ["A", "B"], verifiedAt = NOW - DAY } = {}) {
  x.inventory.records.push(record("replacement", "consumer_checkpoint", names.map((s) => `effect${s}`), {}, names.map((s) => `event${s}`)));
  for (const s of names) x.inventory.records.push(record(`newMember${s}`, "retained_reason", [`effect${s}`], { checkpoint: "replacement" }, [`event${s}`]));
  const r = { recordId: id("checkpoint"), replacementId: id("replacement"), verifiedAt };
  r.commitmentSha256 = sha({ contract: "follow-up-retention-replacement.v1", basis: BASIS, ...r, retainedIdentityIds: sorted(names.map((s) => id(`effect${s}`))) });
  x.replacements = [r]; return sealInventory(x);
}
function sealState(s) { const { stateCommitmentSha256: _, ...body } = s; s.stateCommitmentSha256 = sha({ contract: EPOCH, basis: BASIS, ...body }); return s; }
function epochInput({ completed = 4, h = horizons(), statePatch = {}, asOf = NOW } = {}) {
  const state = sealState({ epochId: id("epoch1"), predecessorEpochId: null, predecessorCommitmentSha256: null, journalAfterSequence: 0, journalThroughSequence: 17,
    journalBoundaryCommitmentSha256: sha("fixedH-event"), checkpointCommitmentSha256: sha("retained checkpoint"), maintenanceCommitmentSha256: sha("conditional plan"),
    horizonsDigestSha256: sha({ ...h, routes: [...h.routes].sort((a, b) => a.id < b.id ? -1 : 1) }), createdAt: NOW - 60000, expiresAt: NOW + DAY, evidenceGap: false, ...statePatch });
  const x = { basis: clone(BASIS), asOf, state, cursor: null, predecessor: null, replacementAnchor: null, horizons: h };
  ["intent", "d1Commit", "externalAck", "readerVerification"].forEach((stage, i) => { x[stage] = i < completed ? { stage, basis: clone(BASIS), state: clone(state), at: state.createdAt + (i + 1) * 1000,
    storage: ["external_private", "target_d1", "external_private", "reader"][i], acknowledgementId: i === 2 ? id("external ack") : null } : null; }); return x;
}
function withPredecessor({ replacement = true, routes = [route()] } = {}) {
  const p = { epochId: id("epoch0"), stateCommitmentSha256: sha("old structurally committed state"), createdAt: NOW - 3 * DAY, expiresAt: NOW - DAY };
  const x = epochInput({ h: horizons(routes), statePatch: { predecessorEpochId: p.epochId, predecessorCommitmentSha256: p.stateCommitmentSha256 } }); x.predecessor = p;
  if (replacement) { const r = { anchorId: id("anchor"), predecessorEpochId: p.epochId, predecessorCommitmentSha256: p.stateCommitmentSha256, createdAt: NOW - 2 * DAY,
    verifiedAt: NOW - 2 * DAY + 1000, expiresAt: NOW + 10 * DAY, coverage: routes.map((q) => ({ routeId: q.id, throughAt: q.throughAt })), acknowledgementId: id("replacement ack") };
    x.replacementAnchor = { ...r, commitmentSha256: sha({ contract: "follow-up-retention-replacement-anchor.v1", basis: BASIS, ...r }) }; } return x;
}
function nonAuthority(r) {
  expect(r).toMatchObject({ contract: CONTRACT, sourceOnly: true, simulation: true, structuralOnly: true, authenticated: false,
    productionReadAuthorized: false, executionAuthorized: false, installationAuthorized: false, adoptionAllowed: false, authority: false,
    authoritativeCoverage: false, producerAdopted: false, dispatchAllowed: false, outcomeProven: false, replacementAllowed: false,
    watermarkAdvanceAllowed: false, automaticRetryAllowed: false, restoreAuthorized: false, coherentRollbackDetectable: false });
  expect(Object.isFrozen(r)).toBe(true);
}
afterEach(() => vi.restoreAllMocks());

describe("immutable original-clock retention", () => {
  it.each(["effect", "inventory", "recovery_manifest"])("caps %s at exactly original +90d, never a read-time renewal", async (kind) => {
    const i = identity(kind, kind, NOW - 10 * DAY), x = deadlineInput(i), first = await deadline(x); expect(first.status).toBe("planned");
    expect(first.deadline.deadlineAt).toBe(i.origin.at + 90 * DAY); x.asOf += DAY;
    expect((await deadline(x)).deadline.deadlineAt).toBe(first.deadline.deadlineAt); nonAuthority(first);
  });
  it("keeps shorter inherited, parent, and deletion horizons even before preparation", async () => {
    const i = identity("effect", "effect"); i.parentDeadlines = [{ id: id("parent"), deadlineAt: NOW + 2 * DAY }]; i.inheritedDeadlineAt = NOW + DAY; i.deletionDueAt = NOW - 1;
    expect((await deadline(deadlineInput(i))).deadline).toMatchObject({ deadlineAt: NOW - 1, validity: "expired", expiryEligible: true });
    i.deletionDueAt = i.origin.at - 1; expect((await deadline(deadlineInput(i))).deadline.validity).toBe("unusable_at_origin");
  });
  it("expires exactly at90d; latest observation and receipt timestamps are not accepted fields", async () => {
    const i = identity("effect", "effect", NOW - 90 * DAY); expect((await deadline(deadlineInput(i))).deadline.expiryEligible).toBe(true);
    for (const field of ["readAt", "observedAt", "lateReceiptAt", "renewedAt"]) expect((await deadline({ ...deadlineInput(i), [field]: NOW })).status).toBe("refused");
  });
  it("caps diagnostic metadata at7d", async () => { const i = identity("log", "diagnostic", NOW - 7 * DAY); expect((await deadline(deadlineInput(i))).deadline).toMatchObject({ deadlineAt: NOW, expiryEligible: true }); });
  it("uses24 calendar months for minimal request audit, including leap-day clamping", async () => {
    const at = Date.UTC(2024, 1, 29, 7), i = identity("ticket", "privacy_request", at); const r = await deadline(deadlineInput(i, at + DAY));
    expect(r.deadline.deadlineAt).toBe(Date.UTC(2026, 1, 28, 7));
  });
  it.each(["parentDeadlines", "inheritedDeadlineAt", "deletionDueAt"])("refuses an implicit audit-retention override through %s", async (field) => {
    const i = identity("ticket", "privacy_request"); i[field] = field === "parentDeadlines" ? [{ id: id("profile"), deadlineAt: NOW }] : NOW;
    expect((await deadline(deadlineInput(i))).reasonCodes).toEqual(["invalid_origin"]);
  });
  it.each([horizons([], false), horizons([route("backup", null)]), horizons([route("backup", NOW, NOW - 600001)])])("never expires suppression with unknown/incomplete/stale replay coverage", async (h) => {
    const r = await deadline(deadlineInput(identity("suppression", "suppression", NOW - 100 * DAY), NOW, h));
    expect(r).toMatchObject({ status: "pending", deadline: { deadlineAt: null, expiryEligible: false, reviewRequired: true } }); nonAuthority(r);
  });
  it("suppression spans ALL actual replay routes plus7d, not a guessed backup period", async () => {
    const h = horizons([route("backup", NOW + DAY), route("provider_replay", NOW + 100 * DAY)]), i = identity("s", "suppression");
    expect((await deadline(deadlineInput(i, NOW, h))).deadline.deadlineAt).toBe(NOW + 107 * DAY);
    i.deletionDueAt = NOW; expect((await deadline(deadlineInput(i, NOW, h))).status).toBe("refused");
  });
  it.each(["origin", "digest", "future"])("rejects %s clock evidence corruption", async (change) => {
    const x = deadlineInput(); if (change === "origin") x.identity.origin.kind = "diagnostic_created";
    if (change === "digest") x.identity.origin.commitmentSha256 = sha("wrong"); if (change === "future") x.identity.origin.at = NOW + 1;
    expect((await deadline(x)).status).toBe("refused");
  });
});

describe("complete structural graph and scoped conditional retirement", () => {
  it("accepts the complete synthetic canonical graph, without authorizing or changing anything", async () => {
    const x = graph(), before = clone(x), r = await maintenance(x); expect(r.status).toBe("planned"); expect(r.purgeOrder).toEqual([]); expect(r.rebase).toEqual([]);
    expect(x).toEqual(before); expect(r.preservedRecordIds).toHaveLength(x.inventory.records.length); nonAuthority(r);
    expect(r.deadlines.find((d) => d.identity === id("effectA")).deadlineAt).toBe(NOW + 86 * DAY); // older source parent wins without caller-declared shortcut
  });
  it("plans child-first scoped deletion and preserves another subject in shared checkpoints", async () => {
    const x = graph(); x.deletion = deletion(); const r = await maintenance(x); expect(r.status).toBe("planned"); nonAuthority(r);
    const order = r.purgeOrder.map((p) => p.recordId), positions = new Map(order.map((key, index) => [key, index]));
    for (const rec of x.inventory.records.filter((rec) => positions.has(rec.id))) for (const p of [...rec.parents.map((p) => p.id), ...rec.proofIds])
      if (positions.has(p)) expect(positions.get(rec.id)).toBeLessThan(positions.get(p));
    expect(order).toContain(id("sourceA")); expect(order).not.toContain(id("sourceB")); expect(order).not.toContain(id("manifest"));
    const cp = r.rebase.find((p) => p.recordId === id("checkpoint")); expect(cp.retainedIdentityIds).toEqual([id("effectB")]); expect(cp.retainedProofIds).toEqual([id("eventB")]);
    expect(cp.originalDeadlines[0].deadlineAt).toBe(NOW + 86 * DAY); expect(cp.requiredStage).toBe("reader_verified_new_epoch_before_old_proof_purge");
    expect(r).toMatchObject({ evidenceGap: true, unresolvedOutcomePreserved: true, originalClocksRenewed: false }); expect(r.unresolvedGapCount).toBeGreaterThan(0);
    expect(r.purgeOrder.every((p) => p.closesObligation === false)).toBe(true);
  });
  it("does not delete or shorten the separate minimal privacy-request audit with its subject", async () => {
    const x = graph(), audit = identity("audit", "privacy_request", NOW - DAY, "A"); x.inventory.identities.push(audit); x.inventory.records.push(record("audit:origin", "privacy_request", [audit]));
    x.deletion = deletion(); sealInventory(x); const r = await maintenance(x);
    expect(r.status).toBe("planned"); expect(r.purgeOrder.map((p) => p.recordId)).not.toContain(audit.origin.id); expect(r.separatelyRetainedAuditIdentityIds).toEqual([audit.id]);
    expect(r.deadlines.find((d) => d.identity === audit.id).deadlineAt).toBe(Date.UTC(2028, 7, 26, 16));
  });
  it("retires minimal audit only at its own24-month boundary", async () => {
    const r = await maintenance(simple(Date.UTC(2024, 7, 27, 16), "privacy_request")); expect(r.purgeOrder).toHaveLength(1); expect(r.separatelyRetainedAuditIdentityIds).toEqual([]);
  });
  it("keeps overdue held evidence unusable and pins all required parents without widening deletion", async () => {
    const x = graph(); x.deletion = deletion("A", { dueAt: NOW - 1 }); x.holds = [hold(ident(x, "effectA"), { approvedAt: NOW - 3 * DAY, nextReviewAt: NOW - DAY })];
    const r = await maintenance(x); expect(r.status).toBe("partial"); expect(r.overdueHoldReviewIds).toEqual([id("hold")]);
    expect(r.deadlines.find((d) => d.identity === id("effectA"))).toMatchObject({ deadlineAt: NOW - 1, expiryEligible: true });
    expect(r.blocked).toContainEqual({ recordId: id("bindingA"), reasonCode: "hold_blocks_physical_deletion_not_validity" }); expect(r.preservedRecordIds).toContain(id("sourceA"));
    expect(r.purgeOrder.map((p) => p.recordId)).not.toContain(id("sourceB"));
  });
  it("a released hold no longer blocks; an overdue hold is not implicitly released", async () => {
    const x = simple(NOW - 100 * DAY); x.holds = [hold(x.inventory.identities[0], { releasedAt: NOW - 1 })]; expect((await maintenance(x)).purgeOrder).toHaveLength(1);
    x.holds[0].releasedAt = null; expect((await maintenance(x)).purgeOrder).toHaveLength(0);
  });
  it("an unrelated retained dependent prevents parent deletion and requests explicit review", async () => {
    const x = simple(NOW - 100 * DAY), b = identity("B", "inventory", NOW - 1, "B"); x.inventory.identities.push(b);
    x.inventory.records.push(record("B:origin", "source", [b]), record("B:cache", "cache", [b], {}, ["simple:origin"])); sealInventory(x);
    const r = await maintenance(x); expect(r.status).toBe("partial"); expect(r.purgeOrder).toEqual([]); expect(r.blocked[0].reasonCode).toBe("retained_dependent_pins_record");
  });
  it("a verified independent replacement makes superseded proof due by24h without renewing identities", async () => {
    const x = addReplacement(graph()); const r = await maintenance(x); expect(r.purgeOrder.map((p) => p.recordId)).toContain(id("checkpoint"));
    expect(r.preservedRecordIds).toContain(id("replacement")); expect(r.deadlines.find((d) => d.identity === id("effectB")).deadlineAt).toBe(NOW + 86 * DAY);
    const notYet = addReplacement(graph(), { verifiedAt: NOW - DAY + 1 }); expect((await maintenance(notYet)).purgeOrder).toEqual([]);
  });
  it("original expiry beats24h grace and replacement may never still depend on predecessor", async () => {
    const x = addReplacement(graph(), { names: ["B"], verifiedAt: NOW - 1 }); x.deletion = deletion(); expect((await maintenance(x)).purgeOrder.map((p) => p.recordId)).toContain(id("checkpoint"));
    row(x, "replacement").parents.push({ role: "previous", id: id("checkpoint") }); sealInventory(x);
    expect((await maintenance(x)).reasonCodes).toEqual(["invalid_replacement"]);
  });
  it.each(["lifecycle", "obligation", "command_attempt", "provider_receipt", "source_transition", "lease_event", "effect_binding", "effect_event", "exception_event"])("refuses cross-subject %s lineage", async (kind) => {
    const x = graph(), r = x.inventory.records.find((r) => r.kind === kind && r.identityIds.some((k) => ident(x, "inventoryA")?.id === k || ident(x, "effectA")?.id === k));
    r.identityIds = [kind.startsWith("effect_") ? id("effectB") : id("inventoryB")]; sealInventory(x); expect((await maintenance(x)).status).toBe("refused");
  });
  it.each(["exception", "provenance"])("refuses same-subject but different-source %s multilinks", async (kind) => {
    const x = graph(); x.inventory.records.push(record("otherSource", "source", ["inventoryA"]));
    row(x, `${kind}A`).parents.find((p) => p.role === "source").id = id("otherSource"); sealInventory(x);
    expect((await maintenance(x)).reasonCodes).toEqual(["dependency_mismatch"]);
  });
  it("accepts genuinely shared release provenance without inventing person ownership", async () => {
    const x = graph(); row(x, "manifest").identityIds.push(id("inventoryA"), id("inventoryB")); row(x, "attestation").identityIds.push(id("inventoryA"), id("inventoryB"));
    sealInventory(x); expect((await maintenance(x)).status).toBe("planned");
  });
  it("refuses a receipt proof belonging to a different immutable attempt", async () => {
    const x = graph(); row(x, "eventA").proofIds = [id("receiptB")]; sealInventory(x); expect((await maintenance(x)).reasonCodes).toEqual(["dependency_mismatch"]);
  });
  it.each(["missing_section", "extra_row", "false_section", "false_inventory", "missing_parent", "digest", "cycle", "missing_member", "missing_proof", "stale"])("refuses incomplete or conflicting inventory: %s", async (change) => {
    const x = graph();
    if (change === "missing_section") x.inventory.sections.pop(); if (change === "extra_row") x.inventory.sections[0].recordIds.push(id("not inventoried"));
    if (change === "false_section") x.inventory.sections[0].complete = false; if (change === "false_inventory") x.inventory.complete = false;
    if (change === "missing_parent") { x.inventory.records = x.inventory.records.filter((r) => r.id !== id("sourceA")); sealInventory(x); }
    if (change === "digest") x.inventory.digestSha256 = sha("wrong");
    if (change === "cycle") { row(x, "sourceA").proofIds = [id("bindingA")]; sealInventory(x); }
    if (change === "missing_member") { x.inventory.records = x.inventory.records.filter((r) => r.id !== id("memberA")); sealInventory(x); }
    if (change === "missing_proof") { row(x, "checkpoint").proofIds = [id("eventB")]; sealInventory(x); }
    if (change === "stale") { x.inventory.capturedAt = NOW - 600001; sealInventory(x); }
    const r = await maintenance(x); expect(r.status).toBe("refused"); expect(r).not.toHaveProperty("purgeOrder"); nonAuthority(r);
  });
  it("inventory, tickets, holds, and normalized horizon commitments all bind the deterministic plan", async () => {
    const x = graph(); x.deletion = deletion(); x.holds = [hold(ident(x, "effectB"))]; x.horizons = horizons([route("backup"), route("ingress")]);
    const first = await maintenance(x); const shuffled = clone(x); shuffled.inventory.records.reverse(); shuffled.inventory.identities.reverse(); shuffled.inventory.sections.reverse(); shuffled.horizons.routes.reverse();
    expect((await maintenance(shuffled)).planDigestSha256).toBe(first.planDigestSha256);
    for (const change of ["ticket", "approval", "hold", "horizon"]) { const y = clone(x); if (change === "ticket") y.deletion.ticketId = id("other ticket");
      if (change === "approval") y.deletion.commitmentSha256 = sha("other approval"); if (change === "hold") y.holds[0].signatureCommitmentSha256 = sha("other signature");
      if (change === "horizon") y.horizons.routes[0] = route("backup", NOW + 2 * DAY); expect((await maintenance(y)).planDigestSha256).not.toBe(first.planDigestSha256); }
  });
  it("unknown replay coverage keeps suppression with no expiry; it cannot disappear on a deletion request", async () => {
    const x = simple(NOW - 120 * DAY, "suppression"); x.horizons = horizons([], false); x.deletion = deletion(); const r = await maintenance(x);
    expect(r.status).toBe("partial"); expect(r.purgeOrder).toEqual([]); expect(r.deadlines[0].expiryEligible).toBe(false);
  });
  it("accepts200 inventoried records and refuses201 rather than truncating dependencies", async () => {
    const identities = Array.from({ length: 200 }, (_, i) => identity(`cap${i}`, "inventory", NOW - DAY));
    const x = maintenanceInput(identities, identities.map((i, n) => record(`cap${n}:origin`, "source", [i]))); expect((await maintenance(x)).preservedRecordIds).toHaveLength(200);
    const extra = identity("overcap"); x.inventory.identities.push(extra); x.inventory.records.push(record("overcap:origin", "source", [extra])); sealInventory(x);
    expect((await maintenance(x)).reasonCodes).toEqual(["limit_exceeded"]); expect(LIMITS).toMatchObject({ records: 200, proposedRowsPerPage: 100, proposedPagesPerRun: 8, payloadBytes: 1500000 });
  });
});

describe("epoch and independent-witness structural transition", () => {
  it.each([0, 1, 2, 3, 4])("keeps stage%d distinct from authentic/durable authority", async (completed) => {
    const r = await epoch(epochInput({ completed })); expect(r.classification).toBe(["awaiting_intent", "intent_recorded", "d1_commit_recorded", "external_ack_recorded", "reader_verified_structurally"][completed]);
    expect(r.status).toBe(completed === 4 ? "classified" : "pending"); expect(r.requiresReadOnlyReconciliation).toBe(completed > 0 && completed < 4); nonAuthority(r);
  });
  it.each(["missing_intent", "ack_before_commit", "local_witness", "different_environment", "different_epoch", "different_digest", "different_bounds", "different_schema"])("fails closed on transition mismatch: %s", async (change) => {
    const x = epochInput(); if (change === "missing_intent") x.intent = null; if (change === "ack_before_commit") x.d1Commit = null;
    if (change === "local_witness") x.externalAck.storage = "local_file"; if (change === "different_environment") x.externalAck.basis.environment = "staging";
    if (change === "different_epoch") x.externalAck.state.epochId = id("restored epoch"); if (change === "different_digest") x.d1Commit.state.checkpointCommitmentSha256 = sha("wrong checkpoint");
    if (change === "different_bounds") x.readerVerification.state.journalThroughSequence = 18; if (change === "different_schema") x.intent.basis.schemaVersion = 1;
    expect((await epoch(x)).status).toBe("refused");
  });
  it("old cursors fail even when their integer sequence fits the current bounds", async () => {
    const x = epochInput(); x.cursor = { epochId: id("old epoch"), stateCommitmentSha256: x.state.stateCommitmentSha256, afterSequence: 4 };
    expect((await epoch(x)).reasonCodes).toEqual(["old_cursor"]); x.cursor.epochId = x.state.epochId; expect((await epoch(x)).status).toBe("classified"); // no consecutive-sequence claim
    x.cursor.afterSequence = 18; expect((await epoch(x)).reasonCodes).toEqual(["old_cursor"]);
  });
  it.each(["stale", "expired", "unknown_horizon"])("completed %s epoch is unavailable and requires read-only reconciliation, never retry", async (kind) => {
    let x = epochInput(); if (kind === "stale") x.asOf += 600001; if (kind === "expired") x.asOf = x.state.expiresAt;
    if (kind === "unknown_horizon") x = epochInput({ h: horizons([], false) }); const r = await epoch(x);
    expect(r).toMatchObject({ status: "pending", classification: "unavailable_gap", completedStages: 4, requiresReadOnlyReconciliation: true, evidenceGap: true, automaticRetryAllowed: false });
  });
  it("a newer external witness detects an older restored D1 prefix", async () => {
    const x = epochInput(); x.d1Commit.state = sealState({ ...x.state, journalThroughSequence: 12 }); expect((await epoch(x)).status).toBe("refused");
  });
  it("a coherent rollback of ALL caller inputs cannot be detected without an independent latest witness", async () => {
    const x = epochInput({ statePatch: { epochId: id("coherently old"), journalThroughSequence: 5 } }); const r = await epoch(x);
    expect(r.status).toBe("classified"); expect(r.coherentRollbackDetectable).toBe(false); expect(r.authenticated).toBe(false); expect(r.limitations).toContain("external_witness_not_authenticated");
  });
  it("expired predecessor requires a replacement verified before expiry covering every replay horizon", async () => {
    expect((await epoch(withPredecessor({ replacement: false }))).classification).toBe("unavailable_gap");
    expect((await epoch(withPredecessor({ routes: [route("backup"), route("provider_replay", NOW + 7 * DAY)] }))).status).toBe("classified");
  });
  it.each(["missing_route", "short_route", "late_anchor", "expired_anchor", "wrong_predecessor", "missing_parent"])("refuses or marks an explicit gap for replacement defect %s", async (change) => {
    const x = withPredecessor(), r = x.replacementAnchor; if (change === "missing_route") r.coverage = []; if (change === "short_route") r.coverage[0].throughAt = NOW;
    if (change === "late_anchor") r.verifiedAt = x.predecessor.expiresAt; if (change === "expired_anchor") r.expiresAt = NOW;
    if (change === "wrong_predecessor") r.predecessorCommitmentSha256 = sha("other"); if (change === "missing_parent") x.predecessor = null;
    const { commitmentSha256: _, ...body } = r; r.commitmentSha256 = sha({ contract: "follow-up-retention-replacement-anchor.v1", basis: BASIS, ...body });
    expect(["pending", "refused"]).toContain((await epoch(x)).status);
  });
  it("a valid structural epoch can retain an explicit historical evidence gap without claiming completeness", async () => {
    const r = await epoch(epochInput({ statePatch: { evidenceGap: true } })); expect(r).toMatchObject({ status: "classified", evidenceGap: true, authoritativeCoverage: false });
  });
});

describe("bounded hostile inputs, privacy, and pure source isolation", () => {
  it.each([undefined, null, [], new Date(), NaN, Infinity, -1, 1.5])("refuses malformed top-level value without reflecting its content: %s", async (input) => {
    for (const fn of [deadline, maintenance, epoch]) { const r = await fn(input); expect(r.status).toBe("refused"); nonAuthority(r); }
  });
  it.each(["databaseId", "environment", "schemaVersion", "schemaStructureSha256", "physicalCatalogSha256", "sourceRevision"])("binds exact reviewed schema/source/environment: %s", async (field) => {
    const x = deadlineInput(); x.basis[field] = field === "schemaVersion" ? 3 : "untrusted"; expect((await deadline(x)).reasonCodes).toEqual(["wrong_basis"]);
  });
  it("rejects getters without invoking them and snapshots all inputs before the first await", async () => {
    const get = vi.fn(() => { throw new Error("raw secret"); }), bad = deadlineInput(); Object.defineProperty(bad.identity.origin, "at", { enumerable: true, get });
    expect((await deadline(bad)).status).toBe("refused"); expect(get).not.toHaveBeenCalled();
    const x = graph(), expected = await maintenance(clone(x)), pending = maintenance(x); x.inventory.records.splice(0); x.deletion = deletion(); x.asOf += 100 * DAY;
    expect(await pending).toEqual(expected); expect(Object.isFrozen(expected.deadlines[0])).toBe(true);
  });
  it("refuses arbitrary person/body/clinical/credential text, oversized keys, sparse arrays, symbols, and custom prototypes", async () => {
    const mutations = [(x) => { x.identity.id = "person@example.test"; }, (x) => { x.identity.body = "private clinical narrative or token"; },
      (x) => { x["k".repeat(81)] = "private text"; }, (x) => { x.horizons.routes = new Array(1); }, (x) => { x[Symbol("private")] = "value"; }, (x) => { Object.setPrototypeOf(x.identity, { private: true }); }];
    for (const mutate of mutations) { const x = deadlineInput(); mutate(x); const r = await deadline(x); expect(r.status).toBe("refused"); expect(canonicalJson(r)).not.toMatch(/example\.test|clinical narrative|private text|token/); }
  });
  it("refuses caller authority/proof booleans instead of accepting them as authentication", async () => {
    for (const key of ["authenticated", "complete", "approved", "restoreAuthorized", "executionAuthorized"]) { const x = epochInput(); x[key] = true; expect((await epoch(x)).status).toBe("refused"); }
  });
  it.each(["too_many_routes", "duplicate_routes", "wrong_hash", "future_verification"])("refuses malformed horizon inventory: %s", async (change) => {
    const x = deadlineInput(); x.horizons.routes = [route()]; if (change === "too_many_routes") x.horizons.routes = Array.from({ length: 33 }, () => route());
    if (change === "duplicate_routes") x.horizons.routes.push(route()); if (change === "wrong_hash") x.horizons.routes[0].commitmentSha256 = sha("wrong");
    if (change === "future_verification") x.horizons.routes = [route("backup", NOW + DAY, NOW + 1)]; expect((await deadline(x)).status).toBe("refused");
  });
  it.each(["wrong_owner", "unverified_order", "over30_days", "hold_over30", "hold_unknown_identity", "unknown_subject"])("refuses unsupported deletion/hold input: %s", async (change) => {
    const x = simple(); x.deletion = deletion(); if (change === "wrong_owner") x.deletion.approvedBy = "other";
    if (change === "unverified_order") x.deletion.verifiedAt = x.deletion.approvedAt + 1; if (change === "over30_days") x.deletion.dueAt = x.deletion.receivedAt + 30 * DAY + 1;
    if (change === "unknown_subject") x.deletion.subjectIds = [id("missing subject")];
    if (change.startsWith("hold_")) { x.holds = [hold(x.inventory.identities[0])]; if (change === "hold_over30") x.holds[0].nextReviewAt = NOW + 31 * DAY; else x.holds[0].identityIds = [id("missing identity")]; }
    expect((await maintenance(x)).status).toBe("refused");
  });
  it("never acquires wall-clock time, network, credentials, database, or executable SQL", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("implicit clock forbidden"); });
    for (const [fn, input] of [[deadline, deadlineInput()], [maintenance, graph()], [epoch, epochInput()]]) nonAuthority(await fn(input));
    expect(network).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
    const source = readFileSync(new URL("../../functions/lib/follow-up-retention-policy-plan.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bprocess\.(?:env|argv)|\b(?:INSERT|DELETE|UPDATE|DROP|ALTER)\s+(?:INTO|FROM|TABLE)\b|\bdb\.(?:prepare|batch|exec)\s*\(/);
  });
});
