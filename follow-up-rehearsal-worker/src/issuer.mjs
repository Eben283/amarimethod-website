import { WorkerEntrypoint } from "cloudflare:workers";
import { followUpAdmissionSigningBytes } from "../../scripts/lib/follow-up-evidence-admission-gate.mjs";
import { followUpEvidenceIntentSigningBytes } from "../../scripts/lib/follow-up-evidence-capture-integration.mjs";
import { createFollowUpCurrentFloorIssuer, followUpFloorSourceSigningBytes } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";
import { configuration, authenticate, encode, parse, signed, need, hash, canonical, WAIT_MS } from "./protocol.mjs";

// No storage, DO, production provider or public route capability. The only
// eligible source is the exact finite synthetic origin in the owner manifest.
export class FollowUpRehearsalIssuer extends WorkerEntrypoint {
  async issue(requestText, challengeText = null) {
    try {
      const c = configuration(this.env, "issuer"), a = authenticate(c, requestText);
      if (challengeText === null) {
        const capture = signed(c.intent, followUpEvidenceIntentSigningBytes(c.intent), c.signers.capture);
        const admission = signed(c.admission, followUpAdmissionSigningBytes(c.admission), c.signers.admission);
        a.fresh(); return encode({ admission: admission.body, capture: { intent: capture.body, keyId: capture.keyId, signature: capture.signature }, keyId: admission.keyId, signature: admission.signature });
      }
      need(a.p.role === "operator" && ["admit", "execute"].includes(a.r.action)); const q = parse(challengeText);
      const trustedSource = { async read(q) {
        const at = a.fresh(); need(at < c.m.origin.dispatchUntil && q.scopeDigest === c.scopeDigest && q.businessKey === c.operationId && q.admissionDigest === c.admissionDigest && q.originDigest === hash(canonical(c.m.origin)));
        const expiresAt = Math.min(at + 30000, a.r.expiresAt, a.p.expiresAt, c.m.expiresAt, c.m.origin.dispatchUntil);
        const body = { version: "follow-up-floor-source.v1", challengeDigest: hash("amari/follow-up-floor-challenge/v1\n" + canonical(q)), scopeDigest: c.scopeDigest, businessKey: c.operationId, admissionDigest: c.admissionDigest, origin: c.m.origin, governance: { epoch: c.scope.epoch, generation: c.scope.generation, issuerReleaseDigest: c.scope.issuerReleaseDigest, minimumOriginSequence: c.m.origin.sequence, state: "active", observedAt: at, expiresAt }, suppression: { aliasSetDigest: c.m.aliasSetDigest, replayHorizonUntil: c.m.replayHorizonUntil, disposition: "clear", observedAt: at, expiresAt }, observedAt: at, expiresAt };
        return signed(body, followUpFloorSourceSigningBytes(body), c.signers.source);
      } };
      const issuer = createFollowUpCurrentFloorIssuer({ scope: c.scope, trustedSource, sourceKeys: c.publicKeys.source, signer: c.signers.floor, clock: Date.now, timeoutMs: WAIT_MS });
      const result = await issuer.read(q); a.fresh(); return encode(result);
    } catch { return encode({ status: "refused" }); }
  }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
