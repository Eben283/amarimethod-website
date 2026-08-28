import { VERSION, MAX, WAIT_MS, OPERATION_MS, need, authenticate, encode } from "./protocol.mjs";
import { validateOperatorAccessConfig, authenticateOperatorAccess, validateOperatorResponse, OPERATOR_PATH } from "./operator-access.mjs";

const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const refusal = forwarded => new Response(encode({ contract: VERSION, status: forwarded ? "indeterminate" : "refused", requiresReadOnlyReconciliation: forwarded, productionAuthority: false }), { status: forwarded ? 422 : 403, headers });
async function bounded(start, until) {
  let timer; const wait = until - Date.now(); need(wait > 0);
  try { return await Promise.race([start(), new Promise((_, reject) => { timer = setTimeout(() => reject(new TypeError("operator_unavailable")), wait); })]); }
  finally { clearTimeout(timer); }
}
async function bodyText(request, access) {
  need(request.headers.get("content-type") === "application/json" && !request.headers.has("content-encoding") && request.body);
  const length = request.headers.get("content-length"); if (length !== null) need(/^[1-9][0-9]{0,4}$/.test(length) && Number(length) <= MAX);
  const reader = request.body.getReader(), chunks = []; let size = 0, count = 0, complete = false;
  const until = Math.min(Date.now() + WAIT_MS, access.expiresAt);
  try {
    for (;;) {
      access.fresh(); const { value, done } = await bounded(() => reader.read(), until); access.fresh();
      if (done) { complete = true; break; }
      need(++count <= 32 && value instanceof Uint8Array); size += value.byteLength; need(size <= MAX); chunks.push(value);
    }
    need(size > 0 && (length === null || size === Number(length)));
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Separate, disabled-by-default HTTPS gateway. Access service credentials are
// retained by the host; only signed JWTs and public pins reach this Worker.
// One gateway→caller hop is additional to caller→control and downstream64.
// Timeout cannot cancel remote work and never authorizes retry/new nonce.
export default {
  async fetch(request, env) {
    let forwarded = false;
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== OPERATOR_PATH || url.search || url.hash) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
      const config = validateOperatorAccessConfig(env); need(request.url === config.origin + OPERATOR_PATH);
      const access = authenticateOperatorAccess(config, request.headers.get("Cf-Access-Jwt-Assertion"));
      const text = await bodyText(request, access); access.fresh();
      const auth = authenticate(config.callerConfig, text), mapping = access.mapping;
      need(auth.r.callerId === mapping.callerId && auth.p.keyId === mapping.keyId && auth.r.role === mapping.role && env.CALLER && typeof env.CALLER.invoke === "function");
      auth.fresh(); access.fresh();
      const until = Math.min(Date.now() + OPERATION_MS + 2 * WAIT_MS, auth.r.expiresAt, auth.p.expiresAt, config.callerConfig.m.expiresAt, access.expiresAt); need(until > Date.now());
      const result = await bounded(() => { forwarded = true; return env.CALLER.invoke(text); }, until);
      auth.fresh(); access.fresh(); validateOperatorResponse(result);
      return new Response(result, { status: 200, headers });
    } catch { return refusal(forwarded); }
  }
};
