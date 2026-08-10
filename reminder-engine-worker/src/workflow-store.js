import { defineWorkflow, executableFlow } from "./workflow-definition.js";

function parse(row) {
  if (!row?.document) return null;
  return defineWorkflow(JSON.parse(row.document));
}

export async function ensurePublishedWorkflow(db, fallback, nowMs = Date.now()) {
  const read = db.prepare(
    "SELECT document FROM workflow_versions WHERE workflow_id = ? AND state = 'published' LIMIT 1",
  ).bind(fallback.id);
  // Minimal store adapters used by pure engine tests deliberately expose only run/all.
  if (typeof read.first !== "function") return fallback;
  const existing = await read.first();
  if (existing) return parse(existing);
  await db.prepare(
    `INSERT INTO workflow_versions (workflow_id, version, state, document, created_at, published_at)
     VALUES (?, ?, 'published', ?, ?, ?) ON CONFLICT(workflow_id, version) DO NOTHING`,
  ).bind(fallback.id, fallback.version, JSON.stringify(fallback), nowMs, nowMs).run();
  return fallback;
}

export async function publishedWorkflow(db, workflowId) {
  return parse(await db.prepare(
    "SELECT document FROM workflow_versions WHERE workflow_id = ? AND state = 'published' LIMIT 1",
  ).bind(workflowId).first());
}

export async function workflowVersion(db, workflowId, version) {
  const read = db.prepare(
    "SELECT document FROM workflow_versions WHERE workflow_id = ? AND version = ? LIMIT 1",
  ).bind(workflowId, version);
  if (typeof read.first !== "function") return null;
  return parse(await read.first());
}

export async function saveDraftWorkflow(db, input, nowMs = Date.now()) {
  const document = defineWorkflow(input);
  const published = await db.prepare(
    "SELECT version FROM workflow_versions WHERE workflow_id = ? AND state = 'published' LIMIT 1",
  ).bind(document.id).first();
  if (published && document.version <= published.version) throw new Error(`draft version must be greater than published v${published.version}`);
  await db.prepare(
    `INSERT INTO workflow_versions (workflow_id, version, state, document, created_at, published_at)
     VALUES (?, ?, 'draft', ?, ?, NULL)
     ON CONFLICT(workflow_id, version) DO UPDATE SET document = excluded.document, created_at = excluded.created_at
     WHERE workflow_versions.state = 'draft'`,
  ).bind(document.id, document.version, JSON.stringify(document), nowMs).run();
  return document;
}

export async function publishDraftWorkflow(db, workflowId, version, expectedPublishedVersion, nowMs = Date.now()) {
  const current = await db.prepare(
    "SELECT version FROM workflow_versions WHERE workflow_id = ? AND state = 'published' LIMIT 1",
  ).bind(workflowId).first();
  if (!current || current.version !== expectedPublishedVersion) {
    throw new Error(`published workflow changed; expected v${expectedPublishedVersion}, found v${current?.version ?? "none"}`);
  }
  const draft = await db.prepare(
    "SELECT document FROM workflow_versions WHERE workflow_id = ? AND version = ? AND state = 'draft'",
  ).bind(workflowId, version).first();
  const document = parse(draft);
  if (!document) throw new Error("draft workflow version not found");
  await db.batch([
    db.prepare("UPDATE workflow_versions SET state = 'retired' WHERE workflow_id = ? AND state = 'published'").bind(workflowId),
    db.prepare("UPDATE workflow_versions SET state = 'published', published_at = ? WHERE workflow_id = ? AND version = ? AND state = 'draft'").bind(nowMs, workflowId, version),
  ]);
  return document;
}

export async function workflowVersions(db, workflowId) {
  const result = await db.prepare(
    "SELECT version, state, created_at, published_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC",
  ).bind(workflowId).all();
  return result.results || [];
}

export function asExecutableWorkflow(document) {
  return executableFlow(document);
}
