import { WorkerEntrypoint } from "cloudflare:workers";
import { VERSION, OPERATION_MS, WAIT_MS, authenticate, parse, encode, need, digest, integer, canonical } from "./protocol.mjs";
import { validateCallerConfiguration } from "./caller-authorization.mjs";
import { FOLLOW_UP_STORAGE_ADAPTER_FLAGS } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";
import { FOLLOW_UP_ADMISSION_GATE_VERSION } from "../../scripts/lib/follow-up-evidence-admission-gate.mjs";

const RESPONSE_FIELDS = ["contract", "schemaDigest", "status", "requiresReadOnlyReconciliation", "counter", "gate", "bootstrap", "metrics", "foundationClaims", "productionAuthority"];
const STATUSES = ["refused", "indeterminate", "initialized", "uninitialized", "revoked", "observed", "captured", "admitted", "consumed_not_attempted"];
function responseValue(text) {
  const result = parse(text);
  need(result && !Array.isArray(result) && Object.keys(result).every(k => RESPONSE_FIELDS.includes(k)) && result.contract === VERSION && STATUSES.includes(result.status) && typeof result.requiresReadOnlyReconciliation === "boolean");
  if (Object.keys(result).length === 3) need(["refused", "indeterminate"].includes(result.status));
  else need(["schemaDigest", "metrics", "foundationClaims", "productionAuthority"].every(k => Object.hasOwn(result, k)));
  if (Object.hasOwn(result, "schemaDigest")) digest(result.schemaDigest);
  if (Object.hasOwn(result, "counter")) integer(result.counter, 0, 1);
  if (Object.hasOwn(result, "productionAuthority")) need(result.productionAuthority === false);
  if (Object.hasOwn(result, "foundationClaims")) need(canonical(result.foundationClaims) === canonical(FOLLOW_UP_STORAGE_ADAPTER_FLAGS));
  if (Object.hasOwn(result, "gate")) {
    need(result.gate && result.gate.contract === FOLLOW_UP_ADMISSION_GATE_VERSION && result.gate.status === result.status);
    for (const [key, value] of Object.entries(FOLLOW_UP_STORAGE_ADAPTER_FLAGS)) need(result.gate[key] === value);
  }
  const checkClaims = value => { if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { if (Object.hasOwn(FOLLOW_UP_STORAGE_ADAPTER_FLAGS, key)) need(child === FOLLOW_UP_STORAGE_ADAPTER_FLAGS[key]); checkClaims(child); } };
  checkClaims(result);
  if (result.status === "indeterminate") need(result.requiresReadOnlyReconciliation === true);
  return result;
}

// Private RPC relay only. The host/operator invocation mechanism and signing
// custody are deliberately not implemented by an HTTP route or this Worker.
// A single caller→control hop is additional to the frozen downstream64 budget.
export class FollowUpRehearsalCaller extends WorkerEntrypoint {
  async invoke(text) {
    let forwarded = false, timer;
    try {
      const config = validateCallerConfiguration(this.env), auth = authenticate(config, text);
      need(this.env.CONTROL && typeof this.env.CONTROL.invoke === "function");
      auth.fresh();
      const wait = Math.min(OPERATION_MS + 2 * WAIT_MS, auth.r.expiresAt - Date.now(), auth.p.expiresAt - Date.now(), config.m.expiresAt - Date.now()); need(wait > 0);
      // The exact signed bytes, original nonce and deadline are forwarded once.
      // A timeout does not cancel remote work and can never authorize a retry.
      forwarded = true;
      const response = await Promise.race([this.env.CONTROL.invoke(text), new Promise((_, reject) => { timer = setTimeout(() => reject(new TypeError("private_caller_unavailable")), wait); })]);
      auth.fresh(); responseValue(response); return response;
    } catch {
      return encode({ contract: VERSION, status: forwarded ? "indeterminate" : "refused", requiresReadOnlyReconciliation: forwarded, productionAuthority: false });
    } finally { clearTimeout(timer); }
  }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
