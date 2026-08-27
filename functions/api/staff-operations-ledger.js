// Staff Operations Ledger boundary.
//
// The ledger implementation is deliberately kept in functions/lib/ops-ledger.js.
// This module owns the browser/service trust boundaries and the response
// projection. In particular, it must not become a second ledger or a proxy for
// raw CRM/provider records.

import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import { timingSafeEqual } from "../lib/safe-equal.js";
import {
  readOperationsLedger,
  ingestOperationsLedgerTask,
  ingestOperationsLedgerEvent,
  ingestOperationsLedgerRelease,
} from "../lib/ops-ledger.js";

// Contract owned by the ledger-core work: readOperationsLedger(env, options)
// returns { configured, entries, tasks, releases, incidents, nextCursor };
// each ingest function accepts (env, safeInput, { actor, source }). Keeping the
// contract explicit makes this boundary easy to wire without putting D1 SQL or
// a second storage model in the Staff route.

const METHODS = "GET, POST, OPTIONS";
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const RESOURCES = new Set(["entries", "tasks", "releases", "incidents"]);
const INGEST_RESOURCES = new Set(["tasks", "events", "releases"]);

// These are intentionally projections rather than a pass-through. Raw event
// payloads, contact/person fields, and arbitrary metadata must never cross the
// Staff API boundary, even if a future ledger schema adds them.
const SAFE_FIELDS = {
  entries: new Set([
    "id", "at", "atMs", "createdAt", "timestamp", "type", "eventType", "kind",
    "status", "outcome", "reason", "reasonCode", "summary", "source", "sourceSystem",
    "pathId", "taskId", "releaseId", "incidentId", "actor",
  ]),
  tasks: new Set([
    "id", "createdAt", "updatedAt", "dueAt", "completedAt", "status", "priority",
    "title", "summary", "source", "releaseId", "incidentId", "actor",
  ]),
  releases: new Set([
    "id", "createdAt", "releasedAt", "status", "version", "environment", "source",
    "summary", "rollback", "commitSha", "changeType", "actor",
  ]),
  incidents: new Set([
    "id", "createdAt", "openedAt", "resolvedAt", "status", "severity", "title",
    "summary", "source", "pathId", "releaseId", "actor",
  ]),
};

const SAFE_INPUT_FIELDS = {
  tasks: new Set(["id", "createdAt", "updatedAt", "dueAt", "completedAt", "status", "priority", "title", "summary", "source", "releaseId", "incidentId"]),
  events: new Set(["id", "at", "atMs", "createdAt", "timestamp", "type", "eventType", "kind", "status", "outcome", "reason", "reasonCode", "summary", "source", "sourceSystem", "pathId", "taskId", "releaseId", "incidentId"]),
  releases: new Set(["id", "createdAt", "releasedAt", "status", "version", "environment", "source", "summary", "rollback", "commitSha", "changeType"]),
};

function responseHeaders(context) {
  return {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  };
}

function boundedLimit(value) {
  const parsed = Number.parseInt(value || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function resourceFrom(context) {
  const url = new URL(context.request.url);
  const routeResource = context.params?.resource;
  const queryResource = url.searchParams.get("resource") || url.searchParams.get("kind");
  return String(routeResource || queryResource || "").trim().toLowerCase();
}

function filtersFrom(url) {
  const filters = {};
  for (const key of ["status", "type", "eventType", "outcome", "source", "pathId", "releaseId", "incidentId", "from", "to", "q"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value.slice(0, 160);
  }
  return filters;
}

function safePrimitive(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;
}

function projectRecord(record, resource) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const fields = SAFE_FIELDS[resource] || SAFE_FIELDS.entries;
  const projected = {};
  for (const key of fields) {
    const value = safePrimitive(record[key]);
    if (value !== undefined) projected[key] = typeof value === "string" ? value.slice(0, 1000) : value;
  }
  return projected;
}

function projectCollection(result, resource) {
  const source = result?.[resource];
  if (Array.isArray(source)) return source.map((row) => projectRecord(row, resource)).filter(Boolean);
  if (Array.isArray(source?.items)) return source.items.map((row) => projectRecord(row, resource)).filter(Boolean);
  if (Array.isArray(result?.items) && resource === result?.resource) {
    return result.items.map((row) => projectRecord(row, resource)).filter(Boolean);
  }
  return [];
}

function projectRead(result, requestedResource) {
  const resources = requestedResource ? [requestedResource] : [...RESOURCES];
  const body = {
    success: true,
    configured: result?.configured !== false,
  };
  for (const resource of resources) body[resource] = projectCollection(result || {}, resource);
  body.nextCursor = result?.nextCursor || result?.cursor || null;
  if (result?.generatedAt) body.generatedAt = result.generatedAt;
  // The Staff page uses three concise, metadata-only views. Keep the raw safe
  // collections above for future filters while deriving the presentation model
  // here, never from CRM/provider payloads.
  const tasksById = new Map((result?.tasks || []).map((task) => [task.id, task]));
  body.activity = (result?.entries || []).map((entry) => ({
    id: entry.id,
    taskId: entry.taskId || entry.id,
    taskLabel: tasksById.get(entry.taskId)?.title || entry.summary || "Operational work",
    actor: entry.actor?.kind || "automation",
    requestedBy: "—",
    outcome: entry.eventType?.includes("failed") ? "failed" : "completed",
    at: entry.occurredAt ? new Date(entry.occurredAt).toISOString() : null,
    counts: { total: Number(entry.counts?.total || 1), completed: 1, failed: 0, skipped: 0 },
  }));
  body.changes = (result?.releases || []).map((release) => ({
    id: release.id, taskId: null, taskLabel: null, kind: "release", label: release.summary,
    from: release.sourceRef || null, to: release.versionRef || release.releaseRef,
    verification: release.status === "succeeded" || release.status === "active" ? "Observed" : null,
    rollback: release.status === "rolled_back" ? "Rollback recorded" : null,
    at: release.updatedAt ? new Date(release.updatedAt).toISOString() : null,
  }));
  return body;
}

function safeInput(body, resource) {
  // Ingest is intentionally narrow. The core validator performs the final
  // schema/sanitizer checks; this boundary removes actor and arbitrary payload
  // fields before they can get there.
  if (resource === "tasks") return {
    ...(typeof body?.id === "string" ? { id: body.id } : {}),
    ...(typeof body?.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
    ...(typeof body?.title === "string" ? { title: body.title } : {}),
    ...(typeof body?.status === "string" ? { status: body.status } : {}),
    ...(typeof body?.priority === "string" ? { priority: body.priority } : {}),
    ...(typeof body?.ownerKind === "string" ? { ownerKind: body.ownerKind } : {}),
    ...(typeof body?.ownerRef === "string" ? { ownerRef: body.ownerRef } : {}),
    ...(typeof body?.sourceRef === "string" ? { sourceRef: body.sourceRef } : {}),
    ...(Number.isSafeInteger(body?.dueAt) ? { dueAt: body.dueAt } : {}),
  };
  if (resource === "events") return {
    ...(typeof body?.id === "string" ? { id: body.id } : {}),
    ...(typeof body?.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
    ...(typeof body?.eventType === "string" ? { eventType: body.eventType } : {}),
    ...(typeof body?.summary === "string" ? { summary: body.summary } : {}),
    ...(Number.isSafeInteger(body?.occurredAt) ? { occurredAt: body.occurredAt } : {}),
    ...(typeof body?.correlationRef === "string" ? { correlationRef: body.correlationRef } : {}),
    ...(typeof body?.taskId === "string" ? { taskId: body.taskId } : {}),
    ...(typeof body?.releaseId === "string" ? { releaseId: body.releaseId } : {}),
    ...(Array.isArray(body?.fieldNames) ? { fieldNames: body.fieldNames } : {}),
    ...(body?.counts && typeof body.counts === "object" && !Array.isArray(body.counts) ? { counts: body.counts } : {}),
    ...(Array.isArray(body?.subjects) ? { subjects: body.subjects } : {}),
  };
  if (resource === "releases") return {
    ...(typeof body?.id === "string" ? { id: body.id } : {}),
    ...(typeof body?.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
    ...(typeof body?.releaseRef === "string" ? { releaseRef: body.releaseRef } : {}),
    ...(typeof body?.serviceRef === "string" ? { serviceRef: body.serviceRef } : {}),
    ...(typeof body?.environment === "string" ? { environment: body.environment } : {}),
    ...(typeof body?.versionRef === "string" ? { versionRef: body.versionRef } : {}),
    ...(typeof body?.status === "string" ? { status: body.status } : {}),
    ...(typeof body?.summary === "string" ? { summary: body.summary } : {}),
    ...(typeof body?.sourceRef === "string" ? { sourceRef: body.sourceRef } : {}),
  };
  const fields = SAFE_INPUT_FIELDS[resource];
  const input = {};
  for (const key of fields) {
    const value = safePrimitive(body?.[key]);
    if (value !== undefined) input[key] = typeof value === "string" ? value.trim().slice(0, 1000) : value;
  }
  return input;
}

// Service writes use one fixed actor. Body fields such as actor/user/createdBy
// are intentionally ignored; callers cannot impersonate Staff or select an
// audit actor. The core receives this explicit provenance envelope.
const INGESTORS = {
  tasks: ingestOperationsLedgerTask,
  events: ingestOperationsLedgerEvent,
  releases: ingestOperationsLedgerRelease,
};

function requireLedgerIngestKey(context, headers) {
  const configured = context.env.OPS_LEDGER_INGEST_KEY;
  if (!configured) {
    console.error("[staff-operations-ledger] OPS_LEDGER_INGEST_KEY is not configured; denying service write");
    return new Response(JSON.stringify({ error: "Operations Ledger ingest is not configured" }), { status: 500, headers });
  }
  const provided = context.request.headers.get("OPS_LEDGER_INGEST_KEY") || "";
  if (!provided || !timingSafeEqual(provided, configured)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }
  return null;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context) });
}

export async function onRequestGet(context) {
  const headers = responseHeaders(context);
  const auth = await requireStaffAuth(context, headers);
  if (auth.error) return auth.error;

  const url = new URL(context.request.url);
  const requestedResource = resourceFrom(context);
  if (requestedResource && !RESOURCES.has(requestedResource)) {
    return new Response(JSON.stringify({ error: "Unknown ledger resource" }), { status: 400, headers });
  }

  try {
    const result = await readOperationsLedger(context.env, {
      resource: requestedResource || "all",
      limit: boundedLimit(url.searchParams.get("limit")),
      cursor: (url.searchParams.get("cursor") || "").slice(0, 512) || null,
      filters: filtersFrom(url),
    });
    return new Response(JSON.stringify(projectRead(result, requestedResource || null)), { status: 200, headers });
  } catch (error) {
    console.error("[staff-operations-ledger] read failed:", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: "Operations Ledger is unavailable" }), { status: 503, headers });
  }
}

export async function onRequestPost(context) {
  const headers = responseHeaders(context);
  const denied = requireLedgerIngestKey(context, headers);
  if (denied) return denied;

  const resource = resourceFrom(context);
  if (!INGEST_RESOURCES.has(resource)) {
    return new Response(JSON.stringify({ error: "Ingest resource must be tasks, events, or releases" }), { status: 400, headers });
  }

  const { body, error } = await parseJsonBody(context.request, headers);
  if (error) return error;
  const input = safeInput(body, resource);
  const ingest = INGESTORS[resource];
  try {
    const result = await ingest(context.env, input, {
      principal: { kind: "worker", id: "ops-ledger-ingest" },
      source: "staff-operations-ledger-service",
    });
    const projected = projectRecord(result?.entry || result?.record || result, resource === "events" ? "entries" : resource) || {};
    // The server, never the request body, is the actor for this endpoint.
    projected.actor = "service";
    return new Response(JSON.stringify({
      success: true,
      resource,
      result: projected,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[staff-operations-ledger] ingest failed:", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: "Operations Ledger ingest failed" }), { status: 503, headers });
  }
}

export const __test = {
  boundedLimit,
  filtersFrom,
  projectRecord,
  projectRead,
  resourceFrom,
  safeInput,
};
