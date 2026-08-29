import { createHash, KeyObject, randomBytes, verify } from "node:crypto";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import {
  FOLLOW_UP_RETENTION_COPY_INVENTORY_CONTRACT,
  FOLLOW_UP_RETENTION_COPY_PLAN_CONTRACT,
  FOLLOW_UP_RETENTION_COPY_STORE_KINDS,
  planFollowUpRetentionCopies,
  reconcileFollowUpRetentionCopies,
} from "../../functions/lib/follow-up-retention-copy-plan.js";

/**
 * Inactive private adapter contract. All transports, trust anchors and clocks are
 * injected at construction. The returned object can only collect authenticated
 * inventory and inspect declared action capabilities. It has no delete, list,
 * mutation, retry, credential, environment or default-network path.
 *
 * A valid signature authenticates bytes to a configured key. It does not prove
 * that the configured collector is complete, honestly deployed, rollback-safe,
 * or authorized by a provider. Current access is therefore required separately
 * for every page/capability read and all live-source/durability claims stay false.
 */
export const FOLLOW_UP_RETENTION_COPY_ADAPTER_VERSION = "follow-up-retention-copy-adapters.v1";
export const FOLLOW_UP_RETENTION_INVENTORY_REQUEST_CONTRACT = "follow-up-retention-copy-inventory-request.v1";
export const FOLLOW_UP_RETENTION_INVENTORY_PAGE_CONTRACT = "follow-up-retention-copy-inventory-page.v1";
export const FOLLOW_UP_RETENTION_PURGE_INSPECTION_REQUEST_CONTRACT = "follow-up-retention-purge-inspection-request.v1";
export const FOLLOW_UP_RETENTION_PURGE_CAPABILITY_CONTRACT = "follow-up-retention-purge-capability.v1";
export const FOLLOW_UP_RETENTION_COPY_ADAPTER_FLAGS = Object.freeze({
  sourceOnly: true,
  simulation: true,
  authority: false,
  productionAllowed: false,
  executionAllowed: false,
  adoptionAllowed: false,
  deletionAllowed: false,
  retryAllowed: false,
  restoreAllowed: false,
  liveAuthorizationProven: false,
  liveSourceTruthProven: false,
  providerAuthenticityProven: false,
  inventoryCompletenessProven: false,
  coherentRollbackDetectionProven: false,
  physicalErasureProven: false,
});

const INVENTORY_DOMAIN = "amari/follow-up-retention-copy-inventory-page/v1\n";
const CAPABILITY_DOMAIN = "amari/follow-up-retention-purge-capability/v1\n";
const ACCESS_VERSION = "follow-up-retention-copy-access.v1";
const MAX_TIME = 8640000000000000 - 800 * 86400000;
const MAX_PAGES = 32, MAX_STORES = 64, MAX_COPIES = 600, MAX_BYTES = 1_500_000, FRESH_MS = 10 * 60_000, CAPTURE_SKEW_MS = 5000;
const MAX_AUTHENTICATED_PLANS = 16;
const HEX = /^[a-f0-9]{64}$/, ID = /^id_[a-f0-9]{64}$/;
const OPERATIONS = Object.freeze({ d1: "delete_exact_d1_row", r2: "delete_exact_r2_object_version", kv: "delete_exact_kv_key_version",
  worker_config: "delete_exact_worker_binding_version", backup: "expire_exact_backup_member_version", provider: "delete_exact_provider_record_version" });
const SAFE = new Set(["invalid_input", "adapter_unavailable", "access_denied", "signature_invalid", "page_mismatch", "page_chain_incomplete",
  "inventory_limit_exceeded", "inventory_not_fresh", "inventory_plan_refused", "plan_mismatch", "capability_mismatch", "capability_not_fresh"]);

const sha = value => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const idFor = value => `id_${sha(value)}`;
const stop = code => { throw new Error(code); };
const need = (value, code = "invalid_input") => { if (!value) stop(code); };
const integer = (value, code = "invalid_input") => need(Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME, code);
const digest = (value, code = "invalid_input") => need(typeof value === "string" && HEX.test(value), code);
const opaque = (value, code = "invalid_input") => need(typeof value === "string" && ID.test(value), code);
const plain = value => !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exact(value, fields, code = "invalid_input") {
  need(plain(value), code); const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  need(keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key)
    && descriptors[key].enumerable && Object.hasOwn(descriptors[key], "value")), code);
}
function copy(value, depth = 0, budget = { nodes: 0, bytes: 0, active: new Set() }) {
  need(depth <= 14 && ++budget.nodes <= 50_000, "inventory_limit_exceeded");
  if (value === null || typeof value === "boolean") { budget.bytes += 5; return value; }
  if (typeof value === "number") { integer(value); budget.bytes += 24; return value; }
  if (typeof value === "string") { need(value.length <= 512); budget.bytes += Buffer.byteLength(value); need(budget.bytes <= MAX_BYTES, "inventory_limit_exceeded"); return value; }
  need(value && typeof value === "object" && !budget.active.has(value)); const array = Array.isArray(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype)); const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = array ? descriptors.length?.value : null; need(!array || (Number.isSafeInteger(length) && length <= 1200), "inventory_limit_exceeded");
  need(array || Reflect.ownKeys(descriptors).length <= 64, "inventory_limit_exceeded"); budget.active.add(value); const out = array ? new Array(length) : {};
  for (const key of Reflect.ownKeys(descriptors)) { if (array && key === "length") continue; const descriptor = descriptors[key];
    need(typeof key === "string" && key.length <= 80 && descriptor.enumerable && Object.hasOwn(descriptor, "value"));
    if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
    Object.defineProperty(out, key, { value: copy(descriptor.value, depth + 1, budget), enumerable: true, writable: true, configurable: true });
  }
  budget.active.delete(value); if (array) need(Object.keys(out).length === length); return out;
}
function frozen(value) { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
function key(value) { need(value instanceof KeyObject && value.type === "public" && value.asymmetricKeyType === "ed25519"); return value; }
function signature(value, code = "signature_invalid") { need(typeof value === "string" && /^[A-Za-z0-9+/]{86}==$/.test(value), code);
  const bytes = Buffer.from(value, "base64"); need(bytes.length === 64 && bytes.toString("base64") === value, code); return bytes; }
function signedBytes(domain, body) { return Buffer.from(domain + canonicalJson(body)); }
export function followUpRetentionInventoryPageSigningBytes(body) { return signedBytes(INVENTORY_DOMAIN, pageBody(copy(body))); }
export function followUpRetentionPurgeCapabilitySigningBytes(body) { return signedBytes(CAPABILITY_DOMAIN, capabilityBody(copy(body))); }
function verifyEnvelope(input, domain, trustedKey, bodyValidator) {
  const envelope = copy(input); exact(envelope, ["body", "keyId", "signature"], "signature_invalid"); opaque(envelope.keyId, "signature_invalid");
  need(envelope.keyId === trustedKey.keyId && verify(null, signedBytes(domain, envelope.body), trustedKey.publicKey, signature(envelope.signature)), "signature_invalid");
  return bodyValidator(envelope.body);
}
function scopeValue(value) {
  const scope = copy(value); exact(scope, ["scopeId", "accountId", "d1CatalogDigestSha256", "sourceRevision"]);
  opaque(scope.scopeId); opaque(scope.accountId); digest(scope.d1CatalogDigestSha256); need(typeof scope.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(scope.sourceRevision));
  return frozen(scope);
}
function partyValue(value, callbackName) {
  exact(value, ["kind", callbackName, "partyId", "keyId", "publicKey", "releaseDigestSha256"]);
  need(FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(value.kind)); opaque(value.partyId); opaque(value.keyId); digest(value.releaseDigestSha256);
  key(value.publicKey); need(typeof value[callbackName] === "function");
  return Object.freeze({ kind: value.kind, [callbackName]: value[callbackName], partyId: value.partyId, keyId: value.keyId,
    publicKey: value.publicKey, releaseDigestSha256: value.releaseDigestSha256 });
}
function parties(values, callbackName) {
  need(Array.isArray(values) && values.length === FOLLOW_UP_RETENTION_COPY_STORE_KINDS.length); const result = new Map();
  for (const value of values) { const party = partyValue(value, callbackName); need(!result.has(party.kind)); result.set(party.kind, party); }
  need(FOLLOW_UP_RETENTION_COPY_STORE_KINDS.every(kind => result.has(kind))); return result;
}
function pageBody(value) {
  exact(value, ["contract", "scopeId", "accountId", "sourceRevision", "kind", "collectorId", "collectorReleaseDigestSha256", "sessionId", "requestDigestSha256", "snapshotId",
    "catalogDigestSha256", "pageIndex", "previousPageDigestSha256", "capturedAt", "expiresAt", "nextCursor", "complete", "stores", "copies"], "page_mismatch");
  need(value.contract === FOLLOW_UP_RETENTION_INVENTORY_PAGE_CONTRACT && FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(value.kind), "page_mismatch");
  need(typeof value.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(value.sourceRevision), "page_mismatch");
  digest(value.collectorReleaseDigestSha256, "page_mismatch");
  for (const field of ["scopeId", "accountId", "collectorId", "sessionId", "snapshotId"]) opaque(value[field], "page_mismatch");
  digest(value.requestDigestSha256, "page_mismatch"); if (value.catalogDigestSha256 !== null) digest(value.catalogDigestSha256, "page_mismatch");
  if (value.previousPageDigestSha256 !== null) digest(value.previousPageDigestSha256, "page_mismatch");
  if (value.nextCursor !== null) opaque(value.nextCursor, "page_mismatch"); integer(value.pageIndex, "page_mismatch"); integer(value.capturedAt, "page_mismatch"); integer(value.expiresAt, "page_mismatch");
  need(typeof value.complete === "boolean" && Array.isArray(value.stores) && Array.isArray(value.copies), "page_mismatch");
  need(value.stores.length <= MAX_STORES && value.copies.length <= MAX_COPIES, "inventory_limit_exceeded"); return frozen(value);
}
function capabilityBody(value) {
  exact(value, ["contract", "scopeId", "accountId", "sourceRevision", "kind", "inspectorId", "sessionId", "requestDigestSha256", "actionId", "storeId",
    "operation", "readbackOperation", "locatorDigestSha256", "mode", "issuedAt", "expiresAt", "executorReleaseDigestSha256"], "capability_mismatch");
  need(value.contract === FOLLOW_UP_RETENTION_PURGE_CAPABILITY_CONTRACT && FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(value.kind), "capability_mismatch");
  need(typeof value.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(value.sourceRevision), "capability_mismatch");
  for (const field of ["scopeId", "accountId", "inspectorId", "sessionId", "actionId", "storeId"]) opaque(value[field], "capability_mismatch");
  for (const field of ["requestDigestSha256", "locatorDigestSha256", "executorReleaseDigestSha256"]) digest(value[field], "capability_mismatch");
  need(value.operation === OPERATIONS[value.kind] && value.readbackOperation === "read_exact_locator_absence" && value.mode === "inspect_only", "capability_mismatch");
  integer(value.issuedAt, "capability_mismatch"); integer(value.expiresAt, "capability_mismatch"); return frozen(value);
}
function result(status, values = {}) { return frozen({ contract: FOLLOW_UP_RETENTION_COPY_ADAPTER_VERSION, ...FOLLOW_UP_RETENTION_COPY_ADAPTER_FLAGS,
  status, reasonCodes: [], deletionMethodsExposed: [], unknownOutcomePolicy: "read_only_exact_locator_reconciliation_no_retry", ...values }); }
function refusal(error, fallback = "adapter_unavailable") { const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
  return result("refused", { cryptographicInventoryAuthentication: false, currentAccessChecked: false, reasonCodes: [SAFE.has(code) ? code : fallback] }); }

function base(config) {
  const scope = scopeValue(config.scope), clock = config.clock, authorize = config.authorize, timeoutMs = config.timeoutMs;
  need(typeof clock === "function" && typeof authorize === "function"); integer(timeoutMs); need(timeoutMs >= 1 && timeoutMs <= 20_000);
  const now = () => { const value = clock(); integer(value); return value; };
  async function bounded(work) { let timer; try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("adapter_unavailable")), timeoutMs); })]); } finally { clearTimeout(timer); } }
  async function access(resource, purpose, sessionId) {
    const startedAt = now(), nonce = sha(randomBytes(32).toString("hex")), request = frozen({ version: "follow-up-retention-copy-access-request.v1", scopeId: scope.scopeId,
      accountId: scope.accountId, resource, purpose, sessionId, nonce, requestedAt: startedAt });
    const grant = copy(await bounded(() => authorize(request))); exact(grant, ["version", "scopeId", "accountId", "resource", "purpose", "sessionId", "nonce", "issuedAt", "expiresAt"], "access_denied");
    need(grant.version === ACCESS_VERSION && ["scopeId", "accountId", "resource", "purpose", "sessionId", "nonce"].every(field => grant[field] === request[field]), "access_denied");
    integer(grant.issuedAt, "access_denied"); integer(grant.expiresAt, "access_denied"); const current = now();
    need(grant.issuedAt >= startedAt && grant.issuedAt <= current && grant.expiresAt > current && grant.expiresAt - grant.issuedAt <= 30_000, "access_denied"); return frozen(grant);
  }
  const valid = grant => need(grant.expiresAt > now(), "access_denied");
  return { scope, now, bounded, access, valid };
}

function validatePage(page, request, party, state, b) {
  need(page.scopeId === b.scope.scopeId && page.accountId === b.scope.accountId && page.sourceRevision === b.scope.sourceRevision
    && page.kind === party.kind && page.collectorId === party.partyId && page.collectorReleaseDigestSha256 === party.releaseDigestSha256
    && page.sessionId === request.sessionId && page.requestDigestSha256 === sha(request) && page.snapshotId === request.sessionId && page.pageIndex === request.pageIndex,
  "page_mismatch");
  need(page.previousPageDigestSha256 === state.previousDigest, "page_chain_incomplete");
  need(page.capturedAt === request.asOf && page.expiresAt > b.now() && page.expiresAt - page.capturedAt <= 30_000, "inventory_not_fresh");
  need(party.kind === "d1" ? page.catalogDigestSha256 === b.scope.d1CatalogDigestSha256 : page.catalogDigestSha256 === null, "page_mismatch");
  need(page.complete === (page.nextCursor === null), "page_chain_incomplete");
  return page;
}

async function validatePlanForInspection(plan, scope) {
  const value = copy(plan); need(value.contract === FOLLOW_UP_RETENTION_COPY_PLAN_CONTRACT && ["planned", "partial"].includes(value.status), "plan_mismatch");
  digest(value.planDigestSha256, "plan_mismatch"); need(Array.isArray(value.actions) && value.actions.length <= MAX_COPIES, "plan_mismatch");
  for (let index = 0; index < value.actions.length; index++) { const action = value.actions[index];
    need(plain(action) && action.index === index && FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(action.storeKind), "plan_mismatch");
    for (const field of ["actionId", "storeId"]) opaque(action[field], "plan_mismatch"); digest(action.locatorDigestSha256, "plan_mismatch");
    need(action.operation === OPERATIONS[action.storeKind] && action.requiredReadback === "read_exact_locator_absence", "plan_mismatch");
  }
  const reconciliation = await reconcileFollowUpRetentionCopies({ basis: value.basis, asOf: value.asOf, plan: value, receipts: [] });
  need(["pending", "reconciled"].includes(reconciliation.status) && reconciliation.planDigestSha256 === value.planDigestSha256, "plan_mismatch");
  need(scope.scopeId); return frozen(value);
}

export function createFollowUpRetentionCopyAdapters(config) {
  exact(config, ["scope", "collectors", "purgeInspectors", "authorize", "clock", "timeoutMs"]);
  const b = base(config), collectors = parties(config.collectors, "readPage"), inspectors = parties(config.purgeInspectors, "inspect");
  const authenticatedPlans = new Map();

  async function collectAndPlan(input) {
    try {
      const requestInput = frozen(copy(input)); exact(requestInput, ["basis", "logicalPlan", "asOf"]); integer(requestInput.asOf);
      const started = b.now(); need(requestInput.asOf <= started && started - requestInput.asOf <= CAPTURE_SKEW_MS, "inventory_not_fresh"); digest(requestInput.logicalPlan?.planDigestSha256);
      const basisDigestSha256 = sha(requestInput.basis), sessionId = idFor(`inventory:${randomBytes(32).toString("hex")}:${started}`);
      const stores = [], copies = [], sections = [], grants = [], pageExpiries = [], seenStores = new Set(), seenCopies = new Set(); let collectorPageCount = 0;
      for (const kind of FOLLOW_UP_RETENTION_COPY_STORE_KINDS) {
        const party = collectors.get(kind), state = { cursor: null, previousDigest: null, page: 0, storeIds: [], copyRows: [] };
        while (state.page < MAX_PAGES) {
          const grant = await b.access(`inventory/${kind}/page/${state.page}`, "read", sessionId);
          const request = frozen({ contract: FOLLOW_UP_RETENTION_INVENTORY_REQUEST_CONTRACT, scopeId: b.scope.scopeId, accountId: b.scope.accountId,
            sourceRevision: b.scope.sourceRevision, kind,
            collectorId: party.partyId, collectorReleaseDigestSha256: party.releaseDigestSha256, sessionId,
            logicalPlanDigestSha256: requestInput.logicalPlan.planDigestSha256, basisDigestSha256,
            asOf: requestInput.asOf, pageIndex: state.page, cursor: state.cursor });
          const page = validatePage(verifyEnvelope(await b.bounded(() => party.readPage(request)), INVENTORY_DOMAIN,
            { keyId: party.keyId, publicKey: party.publicKey }, pageBody), request, party, state, b);
          b.valid(grant); grants.push(grant); pageExpiries.push(page.expiresAt); collectorPageCount++;
          const pageDigest = sha(page); state.previousDigest = pageDigest;
          for (const store of page.stores) { need(plain(store) && store.kind === kind && store.ownerAccountId === b.scope.accountId && !seenStores.has(store.storeId), "page_mismatch");
            opaque(store.storeId, "page_mismatch"); seenStores.add(store.storeId); state.storeIds.push(store.storeId); stores.push(store); }
          for (const row of page.copies) { need(plain(row) && !seenCopies.has(row.copyId), "page_mismatch"); opaque(row.copyId, "page_mismatch");
            seenCopies.add(row.copyId); state.copyRows.push(row); copies.push(row); }
          need(stores.length <= MAX_STORES && copies.length <= MAX_COPIES, "inventory_limit_exceeded");
          if (page.complete) { need(state.copyRows.every(row => state.storeIds.includes(row.storeId)), "page_mismatch");
            sections.push({ kind, complete: true, storeIds: [...state.storeIds].sort() }); break; }
          state.cursor = page.nextCursor; state.page++;
        }
        need(sections.some(section => section.kind === kind), "page_chain_incomplete");
      }
      const kindByStore = new Map(stores.map(store => [store.storeId, store.kind]));
      for (const row of copies) need(kindByStore.has(row.storeId), "page_mismatch");
      const normalized = { contract: FOLLOW_UP_RETENTION_COPY_INVENTORY_CONTRACT, scopeId: b.scope.scopeId, capturedAt: requestInput.asOf, complete: true,
        sections: sections.sort((a, z) => a.kind.localeCompare(z.kind)), stores: stores.sort((a, z) => a.storeId.localeCompare(z.storeId)),
        copies: copies.map(row => ({ ...row, parentCopyIds: [...row.parentCopyIds].sort(), holdIds: [...row.holdIds].sort() })).sort((a, z) => a.copyId.localeCompare(z.copyId)) };
      need(Buffer.byteLength(canonicalJson(normalized)) <= MAX_BYTES, "inventory_limit_exceeded");
      const inventory = frozen({ ...normalized, digestSha256: sha({ basis: requestInput.basis, logicalPlanDigestSha256: requestInput.logicalPlan.planDigestSha256, inventory: normalized }) });
      const plan = await planFollowUpRetentionCopies({ basis: requestInput.basis, asOf: requestInput.asOf, logicalPlan: requestInput.logicalPlan, inventory });
      need(["planned", "partial"].includes(plan.status), "inventory_plan_refused");
      const completedAt = b.now();
      need(grants.every(grant => grant.expiresAt > completedAt), "access_denied");
      need(pageExpiries.every(expiresAt => expiresAt > completedAt), "inventory_not_fresh");
      if (!authenticatedPlans.has(plan.planDigestSha256) && authenticatedPlans.size >= MAX_AUTHENTICATED_PLANS) {
        authenticatedPlans.delete(authenticatedPlans.keys().next().value);
      }
      authenticatedPlans.set(plan.planDigestSha256, frozen({ scopeId: b.scope.scopeId, inventoryDigestSha256: plan.inventoryDigestSha256, asOf: plan.asOf }));
      return result("collected", { cryptographicInventoryAuthentication: true, currentAccessChecked: true, inventory, plan,
        collectorPageCount, configuredStoreKindsComplete: true });
    } catch (error) { return refusal(error); }
  }

  async function inspectCapabilities(input) {
    try {
      const requestInput = frozen(copy(input)); exact(requestInput, ["plan", "asOf"]); integer(requestInput.asOf); const started = b.now();
      need(requestInput.asOf <= started && started - requestInput.asOf <= FRESH_MS, "capability_not_fresh");
      const plan = await validatePlanForInspection(requestInput.plan, b.scope), authenticatedPlan = authenticatedPlans.get(plan.planDigestSha256);
      need(authenticatedPlan && authenticatedPlan.scopeId === b.scope.scopeId && authenticatedPlan.inventoryDigestSha256 === plan.inventoryDigestSha256
        && authenticatedPlan.asOf === plan.asOf, "plan_mismatch");
      const sessionId = idFor(`capability:${randomBytes(32).toString("hex")}:${requestInput.asOf}`), capabilities = [], grants = [];
      for (const action of plan.actions) {
        const party = inspectors.get(action.storeKind), grant = await b.access(`purge-capability/${action.actionId}`, "read", sessionId);
        const request = frozen({ contract: FOLLOW_UP_RETENTION_PURGE_INSPECTION_REQUEST_CONTRACT, scopeId: b.scope.scopeId, accountId: b.scope.accountId,
          sourceRevision: b.scope.sourceRevision,
          kind: action.storeKind, inspectorId: party.partyId, executorReleaseDigestSha256: party.releaseDigestSha256,
          sessionId, planDigestSha256: plan.planDigestSha256, actionId: action.actionId,
          storeId: action.storeId, operation: action.operation, readbackOperation: action.requiredReadback, locatorDigestSha256: action.locatorDigestSha256, asOf: requestInput.asOf });
        const capability = verifyEnvelope(await b.bounded(() => party.inspect(request)), CAPABILITY_DOMAIN,
          { keyId: party.keyId, publicKey: party.publicKey }, capabilityBody);
        b.valid(grant); grants.push(grant);
        need(capability.scopeId === b.scope.scopeId && capability.accountId === b.scope.accountId && capability.sourceRevision === b.scope.sourceRevision && capability.kind === action.storeKind
          && capability.inspectorId === party.partyId && capability.sessionId === sessionId && capability.requestDigestSha256 === sha(request)
          && capability.actionId === action.actionId && capability.storeId === action.storeId && capability.operation === action.operation
          && capability.readbackOperation === action.requiredReadback && capability.locatorDigestSha256 === action.locatorDigestSha256
          && capability.executorReleaseDigestSha256 === party.releaseDigestSha256,
        "capability_mismatch");
        need(capability.issuedAt >= requestInput.asOf && capability.issuedAt <= b.now() && capability.expiresAt > b.now()
          && capability.expiresAt - capability.issuedAt <= 30_000, "capability_not_fresh"); capabilities.push(capability);
      }
      const completedAt = b.now();
      need(grants.every(grant => grant.expiresAt > completedAt), "access_denied");
      need(capabilities.every(capability => capability.expiresAt > completedAt), "capability_not_fresh");
      return result("inspected", { cryptographicInventoryAuthentication: false, currentAccessChecked: true, planDigestSha256: plan.planDigestSha256,
        cryptographicCapabilityAuthentication: true, capabilities: frozen(capabilities), everyActionInspectOnly: capabilities.length === plan.actions.length, executionBoundaryPresent: true });
    } catch (error) { return refusal(error); }
  }

  return Object.freeze({ collectAndPlan, inspectCapabilities });
}
