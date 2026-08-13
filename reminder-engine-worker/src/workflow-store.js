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
  const read = db.prepare(
    "SELECT document FROM workflow_versions WHERE workflow_id = ? AND state = 'published' LIMIT 1",
  ).bind(workflowId);
  // Some isolated adapters only model the reminder ledger. Missing workflow
  // storage must fail closed for a separately released workflow.
  if (typeof read.first !== "function") return null;
  return parse(await read.first());
}

// Publishing a bundled first version is an explicit CRM behavior-release action.
// It is deliberately never called during Worker startup or an ordinary deployment.
export async function publishBundledWorkflow(db, document, nowMs = Date.now()) {
  const existing = await publishedWorkflow(db, document.id);
  if (existing) return existing;
  await db.prepare(
    `INSERT INTO workflow_versions (workflow_id, version, state, document, created_at, published_at)
     VALUES (?, ?, 'published', ?, ?, ?) ON CONFLICT(workflow_id, version) DO NOTHING`,
  ).bind(document.id, document.version, JSON.stringify(document), nowMs, nowMs).run();
  return document;
}

export async function workflowVersion(db, workflowId, version) {
  const read = db.prepare(
    "SELECT document FROM workflow_versions WHERE workflow_id = ? AND version = ? LIMIT 1",
  ).bind(workflowId, version);
  if (typeof read.first !== "function") return null;
  return parse(await read.first());
}

function stable(value) {
  return JSON.stringify(value ?? null);
}

function nodeShape(node) {
  return {
    id: node.id,
    at: node.at,
    when: node.when ?? null,
    skipIfPast: node.skipIfPast === true,
    action: node.action,
  };
}

/**
 * Copy amendments are safe to apply to pending Follow-up work only when the
 * node identity, timing, branch, and delivery route remain identical. The
 * Staff editor intentionally locks those fields; this server-side guard keeps
 * a direct request from quietly turning a copy edit into an unplanned replan.
 */
export function changedMessageNodes(currentInput, candidateInput) {
  const current = defineWorkflow(currentInput);
  const candidate = defineWorkflow(candidateInput);
  if (current.id !== candidate.id) throw new Error("workflow id cannot change");
  if (candidate.version !== current.version + 1) throw new Error(`candidate must be v${current.version + 1}`);
  if (candidate.executionMode !== current.executionMode) throw new Error("execution mode changes require a separate activation review");
  if (stable(candidate.trigger) !== stable(current.trigger) || stable(candidate.exits) !== stable(current.exits)) {
    throw new Error("trigger and exit changes require a separate replan review");
  }
  if (candidate.nodes.length !== current.nodes.length) throw new Error("adding or removing nodes requires a separate replan review");

  return candidate.nodes.map((node, index) => {
    const prior = current.nodes[index];
    if (!prior || node.id !== prior.id || stable(nodeShape(node)) !== stable(nodeShape(prior))) {
      throw new Error(`node ${node.id} changes timing, routing, or branch and requires a separate replan review`);
    }
    return stable(node.message) === stable(prior.message) ? null : {
      nodeId: node.id,
      label: node.label,
      template: node.action.template,
      changedFields: ["message"],
    };
  }).filter(Boolean);
}

/**
 * Read-only impact calculation for a candidate Follow-up version. It names
 * every active enrollment and still-pending step that would render with new
 * copy after publish; completed/terminal evidence is deliberately excluded.
 */
export async function workflowImpactPreview(db, currentInput, candidateInput) {
  const current = defineWorkflow(currentInput);
  const candidate = defineWorkflow(candidateInput);
  const changedNodes = changedMessageNodes(current, candidate);
  if (!changedNodes.length) {
    return { workflowId: current.id, currentVersion: current.version, candidateVersion: candidate.version, changedNodes: [], affected: [] };
  }
  const templates = changedNodes.map((node) => node.template);
  const placeholders = templates.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT e.enrollment_id, e.contact_id, e.appointment_id, s.step_index, s.template, s.due_at
     FROM reminder_enrollments e
     JOIN reminder_steps s ON s.enrollment_id = e.enrollment_id
     WHERE e.flow_key = ? AND e.status = 'active' AND s.status = 'pending'
       AND s.template IN (${placeholders})
     ORDER BY s.due_at ASC, e.enrollment_id ASC, s.step_index ASC`,
  ).bind(current.id, ...templates).all();
  return {
    workflowId: current.id,
    currentVersion: current.version,
    candidateVersion: candidate.version,
    changedNodes,
    affected: (result.results || []).map((row) => ({
      enrollmentId: row.enrollment_id,
      contactId: row.contact_id,
      appointmentId: row.appointment_id,
      stepIndex: row.step_index,
      template: row.template,
      dueAt: row.due_at,
    })),
  };
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
