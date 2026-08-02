import {
  beginSyncRun,
  finishSyncRun,
  findContactIdByGhlId,
  getSyncCursor,
  listGhlContactExternalIds,
  setSyncCursor,
  upsertGhlAppointment,
  upsertGhlContact,
  upsertClientNote,
  upsertClientTask,
  upsertStripeCharge,
  upsertCommunicationEvent,
  upsertCommunicationThread,
  ensureCommunicationThread,
} from "./repository.js";
import { normalizeGhlAppointment, normalizeGhlContact, normalizeGhlConversation, normalizeGhlMessage, normalizeGhlNote, normalizeGhlTask, normalizeStripeCharge, normalizedEmail } from "./normalizers.js";
import { fetchGhlAppointmentsForContact, fetchGhlContact, fetchGhlContactNotes, fetchGhlContactTasks, fetchGhlContactsPage, fetchGhlConversationMessages, fetchGhlConversationsPage, fetchGhlMessageExport, fetchStripeChargesPage, fetchStripeCustomer } from "./providers.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../../functions/lib/ops-last-run.js";

function result(status = "succeeded") {
  return { status, recordsRead: 0, recordsWritten: 0, recordsSkipped: 0, cursorAfter: null, failureDetail: null };
}

// A cron pass remains deliberately bounded. GHL contacts are paginated, so the
// cursor advances through the full mirror across runs instead of doing one large
// provider read. This is observation-only: these functions write only CRM_DB.
export const SCHEDULED_SYNC_LIMIT = 50;

export async function syncGhl(env, limit, now) {
  const cursorBefore = await getSyncCursor(env.CRM_DB, "ghl");
  const runId = await beginSyncRun(env.CRM_DB, "ghl", cursorBefore, now);
  const outcome = result();
  try {
    const page = await fetchGhlContactsPage(env, cursorBefore, limit);
    for (const rawContact of page.contacts) {
      outcome.recordsRead += 1;
      const contact = normalizeGhlContact(rawContact);
      if (!contact) {
        outcome.recordsSkipped += 1;
        continue;
      }
      const contactId = await upsertGhlContact(env.CRM_DB, contact, now);
      outcome.recordsWritten += 1;
      const rawAppointments = await fetchGhlAppointmentsForContact(env, contact.externalId);
      for (const rawAppointment of rawAppointments) {
        outcome.recordsRead += 1;
        const appointment = normalizeGhlAppointment(rawAppointment, contact.externalId);
        if (!appointment) {
          outcome.recordsSkipped += 1;
          continue;
        }
        await upsertGhlAppointment(env.CRM_DB, appointment, contactId, now);
        outcome.recordsWritten += 1;
      }
    }
    outcome.cursorAfter = page.nextCursor;
    outcome.status = page.nextCursor ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, "ghl", page.nextCursor, now);
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

// Kept separate from the contact sweep while this is introduced: conversation
// history is larger and needs its own health/cursor contract. It is read-only
// against GHL and writes solely into the owned CRM mirror.
export async function syncGhlConversations(env, limit, now) {
  const cursorBefore = await getSyncCursor(env.CRM_DB, "ghl-conversations");
  const page = Math.max(1, Number(cursorBefore || 1) || 1);
  const runId = await beginSyncRun(env.CRM_DB, "ghl", `conversations:${page}`, now);
  const outcome = result();
  try {
    const response = await fetchGhlConversationsPage(env, page, Math.min(100, limit));
    for (const rawThread of response.conversations) {
      outcome.recordsRead += 1;
      const thread = normalizeGhlConversation(rawThread);
      if (!thread) { outcome.recordsSkipped += 1; continue; }
      const contactId = await findContactIdByGhlId(env.CRM_DB, thread.contactExternalId);
      if (!contactId) { outcome.recordsSkipped += 1; continue; }
      const threadId = await upsertCommunicationThread(env.CRM_DB, thread, contactId, now);
      outcome.recordsWritten += 1;
      const rawMessages = await fetchGhlConversationMessages(env, thread.externalId);
      for (const rawMessage of rawMessages) {
        outcome.recordsRead += 1;
        const message = normalizeGhlMessage(rawMessage, thread.externalId, thread.contactExternalId);
        if (!message) { outcome.recordsSkipped += 1; continue; }
        await upsertCommunicationEvent(env.CRM_DB, message, threadId, contactId, now);
        outcome.recordsWritten += 1;
      }
    }
    outcome.cursorAfter = response.nextPage ? String(response.nextPage) : "1";
    outcome.status = response.nextPage ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, "ghl-conversations", outcome.cursorAfter, now);
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

// Historical export uses a short-lived cursor. Consume bounded pages in one
// invocation; never persist the cursor for a later cron run.
export async function backfillGhlMessageExport(env, { pages = 8, pageSize = 50 } = {}, now) {
  const runId = await beginSyncRun(env.CRM_DB, "ghl", "message-export", now);
  const outcome = result();
  let cursor = null;
  try {
    for (let page = 0; page < pages; page += 1) {
      const response = await fetchGhlMessageExport(env, cursor, pageSize);
      for (const rawMessage of response.messages) {
        outcome.recordsRead += 1;
        const message = normalizeGhlMessage(rawMessage, rawMessage.conversationId, rawMessage.contactId);
        if (!message) { outcome.recordsSkipped += 1; continue; }
        const contactId = await findContactIdByGhlId(env.CRM_DB, message.contactExternalId);
        if (!contactId) { outcome.recordsSkipped += 1; continue; }
        const threadId = await ensureCommunicationThread(env.CRM_DB, message, contactId, now);
        await upsertCommunicationEvent(env.CRM_DB, message, threadId, contactId, now);
        outcome.recordsWritten += 1;
      }
      cursor = response.nextCursor;
      if (!cursor || !response.messages.length) break;
    }
    outcome.cursorAfter = cursor ? "more-history" : null;
    outcome.status = cursor ? "partial" : "succeeded";
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

// Historic client records have no location-wide GHL API feed. Walk the existing
// owned contact↔GHL links in small, durable pages and re-read only that contact's
// source state, notes, and tasks. It writes solely to CRM_DB; it never changes
// a GHL contact, consent, note, or task. Consent remains unknown unless a source
// with explicit, independently auditable consent evidence is introduced.
export async function backfillGhlClientRecords(env, requestedLimit, now) {
  const cursorKey = "ghl-client-records";
  const cursorBefore = await getSyncCursor(env.CRM_DB, cursorKey);
  // Once the historic pass is complete, cron should not create empty sync-run
  // rows forever. A deliberate future re-import needs an explicit cursor reset.
  if (cursorBefore === "done") return { ...result(), cursorAfter: "done" };
  const runId = await beginSyncRun(env.CRM_DB, "ghl", `client-records:${cursorBefore || "start"}`, now);
  const outcome = result();
  try {
    // Three source reads per contact; cap one Worker invocation to avoid a
    // large historical sweep competing with the real-time mirror.
    const limit = Math.min(Math.max(1, requestedLimit), 10);
    const externalIds = await listGhlContactExternalIds(env.CRM_DB, cursorBefore, limit);
    for (const externalId of externalIds) {
      const [rawContact, rawNotes, rawTasks] = await Promise.all([
        fetchGhlContact(env, externalId),
        fetchGhlContactNotes(env, externalId),
        fetchGhlContactTasks(env, externalId),
      ]);
      outcome.recordsRead += 1 + rawNotes.length + rawTasks.length;
      const contact = normalizeGhlContact(rawContact);
      if (!contact) {
        outcome.recordsSkipped += 1 + rawNotes.length + rawTasks.length;
        continue;
      }
      const contactId = await upsertGhlContact(env.CRM_DB, contact, now);
      outcome.recordsWritten += 1;
      for (const rawNote of rawNotes) {
        const note = normalizeGhlNote(rawNote);
        if (!note) { outcome.recordsSkipped += 1; continue; }
        await upsertClientNote(env.CRM_DB, note, contactId, now);
        outcome.recordsWritten += 1;
      }
      for (const rawTask of rawTasks) {
        const task = normalizeGhlTask(rawTask);
        if (!task) { outcome.recordsSkipped += 1; continue; }
        await upsertClientTask(env.CRM_DB, task, contactId, now);
        outcome.recordsWritten += 1;
      }
    }
    const hasMore = externalIds.length === limit;
    outcome.cursorAfter = hasMore ? externalIds.at(-1) : "done";
    outcome.status = hasMore ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, cursorKey, outcome.cursorAfter, now);
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

export async function syncStripe(env, limit, now) {
  const cursorBefore = await getSyncCursor(env.CRM_DB, "stripe");
  const runId = await beginSyncRun(env.CRM_DB, "stripe", cursorBefore, now);
  const outcome = result();
  const customerEmailCache = new Map();
  try {
    const page = await fetchStripeChargesPage(env, cursorBefore, limit);
    for (const rawCharge of page.charges) {
      outcome.recordsRead += 1;
      const charge = normalizeStripeCharge(rawCharge);
      if (!charge) {
        outcome.recordsSkipped += 1;
        continue;
      }
      let enrichedCharge = charge;
      // This only improves evidence for an otherwise-unlinked charge. A Stripe
      // customer email can create a review candidate, never an automatic link.
      if (!charge.contactExternalId && !charge.billingEmail && charge.customerExternalId) {
        let customerEmail = customerEmailCache.get(charge.customerExternalId);
        if (customerEmail === undefined) {
          try {
            const customer = await fetchStripeCustomer(env, charge.customerExternalId);
            customerEmail = normalizedEmail(customer?.email);
          } catch (error) {
            customerEmail = null;
            console.warn(JSON.stringify({
              event: "crm_mirror_stripe_customer_lookup_failed",
              customerId: charge.customerExternalId,
              message: error instanceof Error ? error.message : String(error),
            }));
          }
          customerEmailCache.set(charge.customerExternalId, customerEmail);
        }
        if (customerEmail) enrichedCharge = { ...charge, billingEmail: customerEmail };
      }
      const upserted = await upsertStripeCharge(env.CRM_DB, enrichedCharge, now);
      outcome.recordsWritten += 1;
      if (!upserted.linked) outcome.recordsSkipped += 1;
    }
    outcome.cursorAfter = page.nextCursor;
    outcome.status = page.nextCursor ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, "stripe", page.nextCursor, now);
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

export async function syncRequestedProviders(env, sources, limit, now, pages = 8) {
  const selected = new Set(sources);
  const results = {};
  if (selected.has("ghl")) results.ghl = await syncGhl(env, limit, now);
  if (selected.has("ghl-conversations")) results.ghlConversations = await syncGhlConversations(env, limit, now);
  if (selected.has("ghl-message-export")) results.ghlMessageExport = await backfillGhlMessageExport(env, { pages, pageSize: limit }, now);
  if (selected.has("ghl-client-records")) {
    try {
      results.ghlClientRecords = await backfillGhlClientRecords(env, limit, now);
    } catch (error) {
      // This source is a deliberately manual historic import. Return its
      // aggregate failure to the authenticated operator so a pre-run problem
      // can be diagnosed without exposing any contact payloads or making the
      // whole protected sync endpoint look like a generic server failure.
      results.ghlClientRecords = {
        ...result("failed"),
        failureDetail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (selected.has("stripe")) results.stripe = await syncStripe(env, limit, now);
  await writeCrmMirrorLastRun(env, results, now);
  return results;
}

async function writeCrmMirrorLastRun(env, results, now) {
  try {
    const failed = Object.values(results).some((r) => r && r.status === "failed");
    await writeOpsLastRun(env, OPS_LAST_RUN_KEYS.crmMirror, {
      status: failed ? "error" : "ok",
      ok: !failed,
      results,
      failure_detail: failed
        ? Object.entries(results)
            .filter(([, r]) => r?.status === "failed")
            .map(([p, r]) => `${p}: ${r.failureDetail || "failed"}`)
            .join("; ")
        : null,
      finishedAt: typeof now === "string" ? now : new Date().toISOString(),
    });
  } catch {
    /* never break sync for board writes */
  }
}

export async function runScheduledSync(env, now) {
  const results = {};
  // Conversation history is intentionally not scheduled until its GHL cursor
  // is proven to advance; rerunning the first page would waste API capacity.
  // Historic client records are different: each run has its own durable cursor
  // and is deliberately capped well below the provider rate limit.
  for (const [provider, sync, limit] of [
    ["ghl", syncGhl, SCHEDULED_SYNC_LIMIT],
    ["stripe", syncStripe, SCHEDULED_SYNC_LIMIT],
    ["ghl-client-records", backfillGhlClientRecords, 10],
  ]) {
    try {
      results[provider] = await sync(env, limit, now);
    } catch (error) {
      // Each provider records its own failed sync run. Keep the other source
      // moving so a transient GHL failure cannot make Stripe stale too.
      results[provider] = {
        status: "failed",
        failureDetail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  console.log(JSON.stringify({ event: "crm_mirror_scheduled_sync", limit: SCHEDULED_SYNC_LIMIT, results }));
  await writeCrmMirrorLastRun(env, results, now);
  return results;
}

export async function contactIdFromGhl(env, externalId) {
  return findContactIdByGhlId(env.CRM_DB, externalId);
}
