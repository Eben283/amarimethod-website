// Nurture engine — orchestration. Ties the event taxonomy, the pure enroll logic, the D1
// store, and the shadow-aware sweep together. Two entry points:
//   handleEvent(env, raw, nowMs, deps?) — an event arrived (appointment via the dispatch seam,
//       quiz/purchase/tag from their emitters): run exits, then entries, then the entries'
//       onEnter tags back through exits (Flow 3 enrolling exits Flows 1+2 without a round-trip).
//   runSweep(env, nowMs)                — the cron: fire (or shadow-log) every due step.
//
// Optional deps (primarily tests; production defaults use owned CRM):
//   getContactTags(contactId)  → string[]  guard reads. Default: unknown (null) — shadow
//       enrolls flagged guardUnchecked, active fails closed (see enroll.js).
//   addContactTags(contactId, tags)        active-mode owned-CRM onEnter tag write.
//       Shadow never calls it; an active sequence without it fails loudly, not silently.

import { SEQUENCES } from "./config.js";
import { toNurtureEvent, eventMatches } from "./events.js";
import { enroll } from "./enroll.js";
import { processStep } from "./sweep.js";
import {
  saveEnrollment, loadDueSteps, markStep, claimStep, appendEvent, exitEnrollment, enrollmentId,
} from "./store.js";
import {
  addOwnedContactTags,
  readOwnedContactFields,
  readOwnedContactRecipient,
  readOwnedContactTags,
} from "./owned-contact.js";
import { renderNurtureTemplate } from "./templates.js";
import { deliverNurtureEmail } from "./email-delivery.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../../functions/lib/ops-last-run.js";

async function exitPass(db, event, nowMs, actions) {
  for (const seq of SEQUENCES) {
    if (!seq.exits.some((x) => eventMatches(x, event))) continue;
    const { exitedSteps, closed } = await exitEnrollment(db, enrollmentId(seq.sequenceId, event.contactId));
    if (!closed) continue; // no active enrollment — a no-op, no ghost events
    await appendEvent(db, {
      ts: nowMs, flowKey: seq.sequenceId, contactId: event.contactId,
      definitionVersion: seq.definitionVersion,
      action: "exited", outcome: "exited", detail: { via: event.kind, exitedSteps },
    });
    actions.push({ engine: "nurture", action: "exit", detail: { sequenceId: seq.sequenceId, exitedSteps } });
  }
}

async function applyOnEnterTags(db, seq, event, nowMs, deps, actions, syntheticTags) {
  const onEnter = seq.entry.onEnter;
  if (!onEnter) return;
  for (const tag of onEnter.addTags) {
    if (seq.mode === "active") {
      try {
        await deps.addContactTags(event.contactId, [tag]);
        await appendEvent(db, { ts: nowMs, flowKey: seq.sequenceId, definitionVersion: seq.definitionVersion, contactId: event.contactId, action: "tagged", outcome: "tagged", detail: { tag } });
        actions.push({ engine: "nurture", action: "tag", detail: { sequenceId: seq.sequenceId, tag } });
      } catch (err) {
        await appendEvent(db, {
          ts: nowMs, flowKey: seq.sequenceId, contactId: event.contactId,
          definitionVersion: seq.definitionVersion,
          action: "tagged", outcome: "failed", detail: { tag, error: String((err && err.message) || err) },
        });
        actions.push({ engine: "nurture", action: "tag-failed", detail: { sequenceId: seq.sequenceId, tag } });
      }
    } else {
      await appendEvent(db, { ts: nowMs, flowKey: seq.sequenceId, definitionVersion: seq.definitionVersion, contactId: event.contactId, action: "would_tag", outcome: "would_tag", detail: { tag } });
      actions.push({ engine: "nurture", action: "would_tag", detail: { sequenceId: seq.sequenceId, tag } });
    }
    // Internal exit signal in BOTH modes — code-side exits never depend on the GHL tag write.
    syntheticTags.push(tag);
  }
}

/**
 * React to an inbound event. Order: exits on the real event, then entries, then the new
 * enrollments' onEnter tags fed back through the exit pass. Idempotent (saveEnrollment de-dupes
 * a repeated entry event). Returns { actions } for the dispatch seam / emitter to echo.
 */
export async function handleEvent(env, raw, nowMs, deps = {}) {
  const db = env.NURTURE_DB;
  const actions = [];
  const event = toNurtureEvent(raw);
  if (!event) return { actions };

  const getContactTags = deps.getContactTags || (env.CRM_DB
    ? (contactReference) => readOwnedContactTags(env.CRM_DB, contactReference)
    : async () => null);
  const fullDeps = {
    addContactTags: env.CRM_DB
      ? (contactReference, tags) => addOwnedContactTags(env.CRM_DB, contactReference, tags, nowMs)
      : async () => { throw new Error("owned CRM tag store is not configured"); },
    ...deps,
  };

  await exitPass(db, event, nowMs, actions);

  const syntheticTags = [];
  for (const seq of SEQUENCES) {
    if (!eventMatches(seq.entry.on, event)) continue;

    let tags = null;
    if (seq.entry.guard) {
      try { tags = await getContactTags(event.contactId); } catch { tags = null; }
    }
    const enrollment = enroll(event, seq, { tags }, nowMs);
    if (!enrollment) {
      actions.push({ engine: "nurture", action: "guard-blocked", detail: { sequenceId: seq.sequenceId } });
      continue;
    }

    const { created } = await saveEnrollment(db, enrollment);
    if (!created) {
      actions.push({ engine: "nurture", action: "enroll-noop", detail: { sequenceId: seq.sequenceId } });
      continue;
    }
    await appendEvent(db, {
      ts: nowMs, flowKey: seq.sequenceId, contactId: event.contactId,
      definitionVersion: seq.definitionVersion,
      action: "enrolled", outcome: "enrolled",
      detail: { via: event.kind, steps: enrollment.steps.length, mode: seq.mode, guardUnchecked: enrollment.guardUnchecked },
    });
    actions.push({ engine: "nurture", action: "enroll", detail: { sequenceId: seq.sequenceId } });
    await applyOnEnterTags(db, seq, event, nowMs, fullDeps, actions, syntheticTags);
  }

  for (const tag of syntheticTags) {
    await exitPass(db, { kind: "tag.added", contactId: event.contactId, tag }, nowMs, actions);
  }

  return { actions };
}

/**
 * Cron sweep: process every due pending step. Shadow sequences log would_send and never send.
 * Active sequences resolve branches, recipients, and copy through owned CRM; delivery remains
 * fail-closed until a separate native sender and receipt boundary is enabled.
 */
export async function runSweep(env, nowMs, limit = 100) {
  const db = env.NURTURE_DB;
  const due = await loadDueSteps(db, nowMs, limit);
  const seqByKey = Object.fromEntries(SEQUENCES.map((s) => [s.sequenceId, s]));

  const deps = {
    logEvent: (r) => appendEvent(db, r),
    markStep: (enr, idx, status) => markStep(db, enrollmentId(enr.sequenceId, enr.contactId), idx, status),
    claimStep: (enr, idx) => claimStep(db, enrollmentId(enr.sequenceId, enr.contactId), idx),
    getContactFields: env.CRM_DB
      ? (contactReference) => readOwnedContactFields(env.CRM_DB, contactReference)
      : async () => { throw new Error("owned CRM contact store is not configured"); },
    renderMessage: async (sequence, step, enrollment, templateId) => {
      const [recipient, fields] = await Promise.all([
        readOwnedContactRecipient(env.CRM_DB, enrollment.contactId),
        readOwnedContactFields(env.CRM_DB, enrollment.contactId),
      ]);
      return {
        recipient: { contactId: recipient.id, email: recipient.email },
        sequenceId: sequence.sequenceId,
        deliveryKey: `${sequence.sequenceId}:${recipient.id}:v${enrollment.definitionVersion}:s${step.stepIndex}`,
        ...renderNurtureTemplate(templateId, {
          "contact.first_name": recipient.firstName,
          "contact.primary_pain_location": fields.primaryPainLocation,
          "contact.pain_pattern_signature": fields.painPatternSignature,
          "contact.pain_duration": fields.painDuration,
        }),
      };
    },
    // Three independent gates remain: sequence.mode=active in reviewed source, an exact release
    // flag, and a JSON sequence allowlist in the environment. No GHL fallback exists.
    send: (message) => deliverNurtureEmail(env, message),
  };

  const counts = { would_send: 0, submitted: 0, submission_unreconciled: 0, sent: 0, failed: 0, skip: 0 };
  for (const item of due) {
    const sequence = seqByKey[item.enrollment.sequenceId];
    if (!sequence) continue;
    const r = await processStep({ ...item, sequence }, deps, nowMs);
    counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  }

  try {
    const failed = counts.failed || 0;
    await writeOpsLastRun(env, OPS_LAST_RUN_KEYS.nurture, {
      status: failed > 0 && (counts.sent || 0) + (counts.would_send || 0) === 0 ? "error" : "ok",
      due: due.length,
      ...counts,
      startedAt: new Date(nowMs).toISOString(),
    });
  } catch {
    /* never break the sweep for board writes */
  }

  return counts;
}
