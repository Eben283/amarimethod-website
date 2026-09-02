// Cross-store dry-run retention planner for owned Pain Pattern Quiz data.
//
// This module reads CRM_DB plus the bound automation database and returns a bounded plan. It has
// no delete statement, route that returns record identifiers, scheduler hook, provider call, or
// GHL fallback. The explicit dependency catalog is checked against the complete migrated schema
// in tests so new contact-linked copies cannot silently escape retention review.

export const QUIZ_RETENTION_PLAN_VERSION = "owned-quiz-retention.v1";
export const QUIZ_SOURCE = "owned:quiz";
const DEFAULT_LIMIT = 25;
const TERMINAL_DISPATCH_STATES = new Set(["dispatched"]);

export const CONTACT_FOREIGN_KEY_COVERAGE = Object.freeze([
  ["appointment_authority_commands", "contact_id"],
  ["appointment_attendance_commands", "contact_id"],
  ["appointment_lifecycle_dispatches", "contact_id"],
  ["appointment_payment_events", "contact_id"],
  ["appointment_payment_records", "contact_id"],
  ["appointment_recovery_requests", "contact_id"],
  ["appointment_source_observations", "contact_id"],
  ["appointment_status_facts", "contact_id"],
  ["appointments", "contact_id"],
  ["client_desk_seen", "contact_id"],
  ["client_notes", "contact_id"],
  ["client_tasks", "contact_id"],
  ["communication_events", "contact_id"],
  ["communication_threads", "contact_id"],
  ["communications", "contact_id"],
  ["consents", "contact_id"],
  ["contact_attributes", "contact_id"],
  ["contact_roles", "contact_id"],
  ["contact_tags", "contact_id"],
  ["external_records", "contact_id"],
  ["gmail_inbound_messages", "contact_id"],
  ["gmail_provider_events", "contact_id"],
  ["gmail_provider_submissions", "contact_id"],
  ["ledger_cutover_candidates", "contact_id"],
  ["notes", "contact_id"],
  ["outbound_delivery_attempts", "contact_id"],
  ["owned_communication_commands", "contact_id"],
  ["owned_note_versions", "contact_id"],
  ["owned_followups", "contact_id"],
  ["purchase_reconciliation_candidates", "contact_id"],
  ["purchases", "contact_id"],
  ["quiz_intake_submissions", "contact_id"],
  ["quiz_nurture_dispatches", "contact_id"],
  ["referrals", "referred_contact_id"],
  ["referrals", "referrer_contact_id"],
  ["session_ledger_entries", "contact_id"],
  ["stripe_invoices", "contact_id"],
].map((entry) => Object.freeze(entry)));

// Current schema copies that can retain contact identity without a contacts foreign key.
// `provider_contact_id` / `contact_external_id` usually hold provider IDs, but exact matching is
// still counted conservatively. Gmail reviews and operational review events can hold owned IDs in
// JSON and therefore require explicit JSON-aware coverage.
export const CONTACT_NON_FK_REFERENCE_COVERAGE = Object.freeze([
  ["appointment_lifecycle_dispatches", "provider_contact_id", "exact"],
  ["appointment_projection_events", "provider_contact_id", "exact"],
  ["ghl_webhook_events", "contact_external_id", "exact"],
  ["gmail_evidence_reviews", "candidate_contact_ids_json", "json_array"],
  ["operational_events", "detail_json", "json_contact_id"],
].map((entry) => Object.freeze(entry)));

const QUIZ_PROJECTION_TABLES = new Set(["contact_attributes", "contact_roles", "contact_tags"]);
const QUIZ_RECORD_TABLES = new Set(["quiz_intake_submissions", "quiz_nurture_dispatches"]);

function safeAlias(table, column) { return `dep_${table}_${column}`.replaceAll(/[^a-z0-9_]/g, "_"); }

function quoted(value) { return `"${String(value).replaceAll('"', '""')}"`; }

function dependencyExpression(table, column) {
  const alias = safeAlias(table, column);
  if (QUIZ_RECORD_TABLES.has(table)) return null;
  const sourceFilter = QUIZ_PROJECTION_TABLES.has(table) ? ` AND source <> '${QUIZ_SOURCE}'` : "";
  return `(SELECT COUNT(*) FROM ${quoted(table)} WHERE ${quoted(column)} = submission.contact_id${sourceFilter}) AS ${quoted(alias)}`;
}

function nonForeignKeyDependencyExpression(table, column, kind) {
  const alias = safeAlias(table, column);
  if (kind === "json_array") {
    return `(SELECT COUNT(*) FROM ${quoted(table)} item
              WHERE EXISTS (SELECT 1 FROM json_each(item.${quoted(column)}) value
                             WHERE value.value = submission.contact_id)) AS ${quoted(alias)}`;
  }
  if (kind === "json_contact_id") {
    return `(SELECT COUNT(*) FROM ${quoted(table)}
              WHERE json_extract(${quoted(column)}, '$.contactId') = submission.contact_id) AS ${quoted(alias)}`;
  }
  return `(SELECT COUNT(*) FROM ${quoted(table)} WHERE ${quoted(column)} = submission.contact_id) AS ${quoted(alias)}`;
}

const OTHER_DEPENDENCY_EXPRESSIONS = CONTACT_FOREIGN_KEY_COVERAGE
  .map(([table, column]) => dependencyExpression(table, column))
  .filter(Boolean);
const NON_FK_DEPENDENCY_EXPRESSIONS = CONTACT_NON_FK_REFERENCE_COVERAGE
  .map(([table, column, kind]) => nonForeignKeyDependencyExpression(table, column, kind));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function automationCopies(automationDb, contactId) {
  const row = await automationDb.prepare(
    `SELECT
       (SELECT COUNT(*) FROM nurture_enrollments
         WHERE sequence_id = 'flow-1-quiz' AND contact_id = ?) AS enrollments,
       (SELECT COUNT(*) FROM nurture_steps step
         JOIN nurture_enrollments enrollment ON enrollment.enrollment_id = step.enrollment_id
        WHERE enrollment.sequence_id = 'flow-1-quiz' AND enrollment.contact_id = ?) AS steps,
       (SELECT COUNT(*) FROM automation_events
         WHERE engine = 'nurture' AND flow_key = 'flow-1-quiz' AND contact_id = ?) AS events`,
  ).bind(contactId, contactId, contactId).first();
  return Object.freeze({
    enrollments: number(row?.enrollments),
    steps: number(row?.steps),
    events: number(row?.events),
  });
}

function dependencyCounts(row) {
  const result = {};
  for (const [table, column] of CONTACT_FOREIGN_KEY_COVERAGE) {
    if (QUIZ_RECORD_TABLES.has(table)) continue;
    const alias = safeAlias(table, column);
    result[`${table}.${column}`] = number(row[alias]);
  }
  for (const [table, column] of CONTACT_NON_FK_REFERENCE_COVERAGE) {
    const alias = safeAlias(table, column);
    result[`${table}.${column}`] = number(row[alias]);
  }
  return Object.freeze(result);
}

function projectionCounts(row) {
  return Object.freeze({
    roles: number(row.quiz_roles),
    tags: number(row.quiz_tags),
    attributes: number(row.quiz_attributes),
  });
}

export async function planOwnedQuizRetention(crmDb, automationDb, now = new Date().toISOString(), limit = DEFAULT_LIMIT) {
  if (!crmDb || !automationDb) {
    return Object.freeze({
      version: QUIZ_RETENTION_PLAN_VERSION,
      state: "unavailable",
      generatedAt: now,
      deletionEnabled: false,
      candidates: [],
      reason: "CRM_DB and AUTOMATION_DB are required",
    });
  }
  const generatedAt = new Date(now).toISOString();
  const bounded = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIMIT));
  try {
    const query = `SELECT submission.id AS submission_id, submission.contact_id,
                          submission.retention_until, dispatch.id AS dispatch_id,
                          dispatch.state AS dispatch_state,
                          (SELECT COUNT(*) FROM quiz_intake_submissions successor
                            WHERE successor.contact_id = submission.contact_id
                              AND successor.retention_until > ?) AS retained_successors,
                          (SELECT COUNT(*) FROM quiz_intake_submissions same_contact
                            WHERE same_contact.contact_id = submission.contact_id) AS contact_submissions,
                          (SELECT COUNT(*) FROM quiz_nurture_dispatches same_contact_dispatch
                            WHERE same_contact_dispatch.contact_id = submission.contact_id) AS contact_dispatches,
                          (SELECT COUNT(*) FROM contact_roles
                            WHERE contact_id = submission.contact_id AND source = ?) AS quiz_roles,
                          (SELECT COUNT(*) FROM contact_tags
                            WHERE contact_id = submission.contact_id AND source = ?) AS quiz_tags,
                          (SELECT COUNT(*) FROM contact_attributes
                            WHERE contact_id = submission.contact_id AND source = ?) AS quiz_attributes,
                          ${[...OTHER_DEPENDENCY_EXPRESSIONS, ...NON_FK_DEPENDENCY_EXPRESSIONS].join(",\n                          ")}
                     FROM quiz_intake_submissions submission
                     LEFT JOIN quiz_nurture_dispatches dispatch ON dispatch.submission_id = submission.id
                    WHERE submission.retention_until <= ?
                    ORDER BY datetime(submission.retention_until), submission.id LIMIT ?`;
    const rows = (await crmDb.prepare(query)
      .bind(generatedAt, QUIZ_SOURCE, QUIZ_SOURCE, QUIZ_SOURCE, generatedAt, bounded).all()).results || [];
    const candidates = [];
    for (const row of rows) {
      const otherDependencies = dependencyCounts(row);
      const otherDependencyTotal = Object.values(otherDependencies).reduce((sum, count) => sum + count, 0);
      const retainedSuccessors = number(row.retained_successors);
      const automation = await automationCopies(automationDb, row.contact_id);
      const automationCopyTotal = automation.enrollments + automation.steps + automation.events;
      const dispatchState = row.dispatch_state || "missing";
      const dispatchTerminal = TERMINAL_DISPATCH_STATES.has(dispatchState);
      const purgeScope = retainedSuccessors
        ? "expired_source_only"
        : "expired_source_and_quiz_projections";
      const contactDisposition = retainedSuccessors || otherDependencyTotal
        ? "preserve_contact"
        : "eligible_for_identity_deletion_review";
      const state = !dispatchTerminal
        ? "blocked_unfinished_dispatch"
        : "dry_run_ready";
      candidates.push(Object.freeze({
        submissionId: row.submission_id,
        contactId: row.contact_id,
        retentionUntil: row.retention_until,
        dispatch: Object.freeze({ id: row.dispatch_id || null, state: dispatchState, terminal: dispatchTerminal }),
        retainedSuccessors,
        purgeScope,
        crmQuizCopies: Object.freeze({
          submissions: number(row.contact_submissions),
          dispatches: number(row.contact_dispatches),
          projections: projectionCounts(row),
        }),
        otherDependencies,
        otherDependencyTotal,
        automationCopies: automation,
        automationCopyTotal,
        automationCleanupRequired: retainedSuccessors === 0 && automationCopyTotal > 0,
        contactDisposition,
        state,
        executionEnabled: false,
      }));
    }
    const unsigned = Object.freeze({
      version: QUIZ_RETENTION_PLAN_VERSION,
      state: candidates.some((candidate) => candidate.state.startsWith("blocked")) ? "attention" : candidates.length ? "dry_run_ready" : "empty",
      generatedAt,
      deletionEnabled: false,
      coverage: Object.freeze({
        crmContactForeignKeys: CONTACT_FOREIGN_KEY_COVERAGE.length,
        crmNonForeignKeyReferences: CONTACT_NON_FK_REFERENCE_COVERAGE.length,
        automationRelations: 3,
      }),
      candidates: Object.freeze(candidates),
    });
    const digestInput = Object.freeze({
      version: unsigned.version,
      state: unsigned.state,
      deletionEnabled: unsigned.deletionEnabled,
      coverage: unsigned.coverage,
      candidates: unsigned.candidates,
    });
    return Object.freeze({ ...unsigned, planDigest: await sha256(digestInput) });
  } catch (error) {
    return Object.freeze({
      version: QUIZ_RETENTION_PLAN_VERSION,
      state: "unavailable",
      generatedAt,
      deletionEnabled: false,
      candidates: [],
      reason: error?.message || String(error),
    });
  }
}

export async function ownedQuizRetentionReadiness(crmDb, automationDb, now = new Date().toISOString()) {
  const plan = await planOwnedQuizRetention(crmDb, automationDb, now, DEFAULT_LIMIT);
  if (plan.state === "unavailable") {
    return Object.freeze({ state: "unavailable", deletionEnabled: false, reason: plan.reason });
  }
  const candidates = plan.candidates || [];
  return Object.freeze({
    state: plan.state,
    deletionEnabled: false,
    planVersion: plan.version,
    planDigest: plan.planDigest,
    coverage: plan.coverage,
    expiredCandidates: candidates.length,
    unfinishedDispatches: candidates.filter((candidate) => !candidate.dispatch.terminal).length,
    expiredSourceOnly: candidates.filter((candidate) => candidate.purgeScope === "expired_source_only").length,
    quizProjectionCleanupRequired: candidates.filter((candidate) => candidate.purgeScope === "expired_source_and_quiz_projections").length,
    automationCleanupRequired: candidates.filter((candidate) => candidate.automationCleanupRequired).length,
    automationCopyRows: candidates.reduce((sum, candidate) => sum + candidate.automationCopyTotal, 0),
    contactIdentityDeletionReview: candidates.filter((candidate) => candidate.contactDisposition === "eligible_for_identity_deletion_review").length,
    executionContract: "not_exposed",
  });
}
