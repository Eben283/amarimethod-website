// A source-to-runtime provenance record must be supplied by the cloud release
// path. Missing metadata is deliberately visible as unbound; runtime state must
// never be inferred from a conversational deployment claim.
const SHA = /^[0-9a-f]{7,64}$/i;

export function sourceProvenance(env = {}, workflowId, definitionVersion) {
  const revision = String(env.SOURCE_REVISION || "").trim();
  const workerVersion = String(env.WORKER_VERSION || "").trim();
  return Object.freeze({
    workflowId,
    definitionVersion,
    sourceRevision: SHA.test(revision) ? revision : null,
    workerVersion: workerVersion || null,
    state: SHA.test(revision) && workerVersion ? "bound" : "unbound",
  });
}
