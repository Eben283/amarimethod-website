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
  backfillNativeBookingConsents,
  recordConsentObservation,
  upsertStripeCharge,
  upsertStripeInvoice,
  upsertCommunicationEvent,
  upsertCommunicationThread,
  ensureCommunicationThread,
  deleteGhlEmailContainerEvent,
} from "./repository.js";
import { nativeBookingConsentObservations, normalizeGhlAppointment, normalizeGhlContact, normalizeGhlConversation, normalizeGhlMessage, normalizeGhlNote, normalizeGhlTask, normalizeStripeCharge, normalizeStripeInvoice, normalizedEmail } from "./normalizers.js";
import { fetchGhlAppointmentsForContact, fetchGhlContact, fetchGhlContactNotes, fetchGhlContactTasks, fetchGhlContactsPage, fetchGhlConversationMessages, fetchGhlConversationsPage, fetchGhlEmail, fetchGhlMessage, fetchGhlMessageExport, fetchStripeChargesPage, fetchStripeCustomer, fetchStripeInvoicesPage } from "./providers.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../../functions/lib/ops-last-run.js";
import { dispatchOwnedAppointmentLifecycles } from "./appointment-lifecycle-dispatch.js";
import { dispatchOwnedQuizNurture } from "./quiz-nurture-dispatch.js";

function result(status = "succeeded") {
  return { status, recordsRead: 0, recordsWritten: 0, recordsSkipped: 0, cursorAfter: null, failureDetail: null };
}

// A cron pass remains deliberately bounded. GHL contacts are paginated, so the
// cursor advances through the full mirror across runs instead of doing one large
// provider read. This is observation-only: these functions write only CRM_DB.
export const SCHEDULED_GHL_CONTACT_LIMIT = 20;
export const SCHEDULED_STRIPE_LIMIT = 25;
export const RECENT_CONVERSATION_LIMIT = 10;
export const RECENT_MESSAGE_LIMIT = 20;
export const SCHEDULED_RECENT_CONVERSATION_LIMIT = 3;
export const SCHEDULED_HISTORICAL_CONVERSATION_LIMIT = 3;
// The five-minute cron rotates bounded lanes. Running every provider and both
// conversation sweeps in one invocation exceeded the platform's execution
// boundary and starved every later source. Each core provider is still read at
// least every fifteen minutes, within the 45-minute freshness contract.
export const SCHEDULED_SYNC_LANES = Object.freeze([
  Object.freeze(["owned-appointment-lifecycles", "owned-quiz-nurture", "ghl-conversations-recent", "ghl", "consents"]),
  Object.freeze(["owned-appointment-lifecycles", "owned-quiz-nurture", "ghl-conversations-recent", "stripe", "stripe-invoices", "consents"]),
  Object.freeze(["owned-appointment-lifecycles", "owned-quiz-nurture", "ghl-conversations-recent", "ghl-conversations", "ghl-client-records", "consents"]),
]);

function newestMessage(messages) {
  return [...messages].sort((left, right) => Date.parse(right?.dateAdded || right?.createdAt || right?.date || 0) - Date.parse(left?.dateAdded || left?.createdAt || left?.date || 0))[0] || null;
}

function emailRevisionIds(raw) {
  const ids = raw?.meta?.email?.messageIds || raw?.meta?.email?.email?.messageIds;
  return Array.isArray(ids) ? [...new Set(ids.filter((value) => typeof value === "string" && value.trim()))] : [];
}

async function expandGhlMessages(env, rawMessages, { hydrateNewest = false } = {}) {
  const newest = hydrateNewest ? newestMessage(rawMessages) : null;
  const expanded = [];
  const seenEmailIds = new Set();
  for (const rawMessage of rawMessages) {
    const revisionIds = emailRevisionIds(rawMessage);
    if (revisionIds.length) {
      for (const revisionId of revisionIds) {
        if (seenEmailIds.has(revisionId)) continue;
        seenEmailIds.add(revisionId);
        expanded.push(await fetchGhlEmail(env, revisionId));
      }
      continue;
    }
    if (hydrateNewest && rawMessage === newest) {
      const newestId = rawMessage?.id || rawMessage?.messageId || rawMessage?.emailMessageId;
      expanded.push(newestId ? await fetchGhlMessage(env, newestId) : rawMessage);
    } else {
      expanded.push(rawMessage);
    }
  }
  return expanded;
}

// Always refresh the newest bounded conversation window before historical and
// contact sweeps. GHL's message-list response can have a stale newest body, so
// the newest row is hydrated from the authoritative individual-message read.
export async function syncRecentGhlConversations(env, limit, now) {
  const boundedLimit = Math.min(RECENT_CONVERSATION_LIMIT, Math.max(1, limit));
  const runId = await beginSyncRun(env.CRM_DB, "ghl", `conversations-recent:${boundedLimit}`, now);
  const outcome = result();
  try {
    const response = await fetchGhlConversationsPage(env, null, boundedLimit);
    for (const rawThread of response.conversations) {
      outcome.recordsRead += 1;
      const thread = normalizeGhlConversation(rawThread);
      if (!thread) { outcome.recordsSkipped += 1; continue; }
      const contactId = await findContactIdByGhlId(env.CRM_DB, thread.contactExternalId);
      if (!contactId) { outcome.recordsSkipped += 1; continue; }
      const threadId = await upsertCommunicationThread(env.CRM_DB, thread, contactId, now);
      outcome.recordsWritten += 1;
      const listedMessages = await fetchGhlConversationMessages(env, thread.externalId, RECENT_MESSAGE_LIMIT);
      for (const listedMessage of listedMessages) {
        if (emailRevisionIds(listedMessage).length) {
          outcome.recordsWritten += await deleteGhlEmailContainerEvent(env.CRM_DB, listedMessage.id || listedMessage.messageId || listedMessage.emailMessageId);
        }
      }
      const rawMessages = await expandGhlMessages(env, listedMessages, { hydrateNewest: true });
      outcome.recordsRead += rawMessages.length - listedMessages.length;
      for (const rawMessage of rawMessages) {
        outcome.recordsRead += 1;
        const message = normalizeGhlMessage(rawMessage, thread.externalId, thread.contactExternalId);
        if (!message) { outcome.recordsSkipped += 1; continue; }
        await upsertCommunicationEvent(env.CRM_DB, message, threadId, contactId, now);
        outcome.recordsWritten += 1;
      }
    }
    outcome.status = "succeeded";
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

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
  const runId = await beginSyncRun(env.CRM_DB, "ghl", `conversations:${cursorBefore || "start"}`, now);
  const outcome = result();
  try {
    const response = await fetchGhlConversationsPage(env, cursorBefore, Math.min(100, limit));
    for (const rawThread of response.conversations) {
      outcome.recordsRead += 1;
      const thread = normalizeGhlConversation(rawThread);
      if (!thread) { outcome.recordsSkipped += 1; continue; }
      const contactId = await findContactIdByGhlId(env.CRM_DB, thread.contactExternalId);
      if (!contactId) { outcome.recordsSkipped += 1; continue; }
      const threadId = await upsertCommunicationThread(env.CRM_DB, thread, contactId, now);
      outcome.recordsWritten += 1;
      const listedMessages = await fetchGhlConversationMessages(env, thread.externalId, RECENT_MESSAGE_LIMIT);
      for (const listedMessage of listedMessages) {
        if (emailRevisionIds(listedMessage).length) {
          outcome.recordsWritten += await deleteGhlEmailContainerEvent(env.CRM_DB, listedMessage.id || listedMessage.messageId || listedMessage.emailMessageId);
        }
      }
      const rawMessages = await expandGhlMessages(env, listedMessages);
      for (const rawMessage of rawMessages) {
        outcome.recordsRead += 1;
        const message = normalizeGhlMessage(rawMessage, thread.externalId, thread.contactExternalId);
        if (!message) { outcome.recordsSkipped += 1; continue; }
        await upsertCommunicationEvent(env.CRM_DB, message, threadId, contactId, now);
        outcome.recordsWritten += 1;
      }
    }
    outcome.cursorAfter = response.nextCursor;
    outcome.status = response.nextCursor ? "partial" : "succeeded";
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
        for (const observation of nativeBookingConsentObservations(note)) {
          const recorded = await recordConsentObservation(env.CRM_DB, observation, contactId, now);
          if (recorded.inserted) outcome.recordsWritten += 1;
        }
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

export async function syncNativeBookingConsents(env, now) {
  const details = await backfillNativeBookingConsents(env.CRM_DB, now);
  return { ...result("succeeded"), ...details, cursorAfter: "owned-notes" };
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

// Invoices are a separate source stream from settled charges. They provide
// invoice status and balance context in Client Desk, without treating an
// invoice as a payment or inferring a contact from billing email.
export async function syncStripeInvoices(env, limit, now) {
  const cursorKey = "stripe-invoices";
  const cursorBefore = await getSyncCursor(env.CRM_DB, cursorKey);
  const runId = await beginSyncRun(env.CRM_DB, "stripe", `invoices:${cursorBefore || "start"}`, now);
  const outcome = result();
  try {
    const page = await fetchStripeInvoicesPage(env, cursorBefore, limit);
    for (const rawInvoice of page.invoices) {
      outcome.recordsRead += 1;
      const invoice = normalizeStripeInvoice(rawInvoice);
      if (!invoice) {
        outcome.recordsSkipped += 1;
        continue;
      }
      const upserted = await upsertStripeInvoice(env.CRM_DB, invoice, now);
      outcome.recordsWritten += 1;
      if (!upserted.linked) outcome.recordsSkipped += 1;
    }
    outcome.cursorAfter = page.nextCursor;
    outcome.status = page.nextCursor ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, cursorKey, page.nextCursor, now);
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
  if (selected.has("owned-appointment-lifecycles")) {
    results.ownedAppointmentLifecycles = await dispatchOwnedAppointmentLifecycles(env, Date.parse(now), limit);
  }
  if (selected.has("owned-quiz-nurture")) {
    results.ownedQuizNurture = await dispatchOwnedQuizNurture(env, Date.parse(now), limit);
  }
  if (selected.has("ghl-conversations-recent")) results.ghlConversationsRecent = await syncRecentGhlConversations(env, limit, now);
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
  if (selected.has("stripe-invoices")) results.stripeInvoices = await syncStripeInvoices(env, limit, now);
  if (selected.has("consents")) results.consents = await syncNativeBookingConsents(env, now);
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
  // Conversation sync advances its own durable GHL page cursor each pass, so
  // the complete communication mirror stays current without re-reading page 1.
  // Historic client records are separately capped below provider rate limits.
  const plan = {
    "owned-appointment-lifecycles": [
      (runtime, limit) => dispatchOwnedAppointmentLifecycles(runtime, Date.parse(now), limit),
      10,
    ],
    "owned-quiz-nurture": [
      (runtime, limit) => dispatchOwnedQuizNurture(runtime, Date.parse(now), limit),
      10,
    ],
    "ghl": [syncGhl, SCHEDULED_GHL_CONTACT_LIMIT],
    "stripe": [syncStripe, SCHEDULED_STRIPE_LIMIT],
    "stripe-invoices": [syncStripeInvoices, SCHEDULED_STRIPE_LIMIT],
    "ghl-conversations-recent": [syncRecentGhlConversations, SCHEDULED_RECENT_CONVERSATION_LIMIT],
    "ghl-conversations": [syncGhlConversations, SCHEDULED_HISTORICAL_CONVERSATION_LIMIT],
    "ghl-client-records": [backfillGhlClientRecords, 3],
    "consents": [syncNativeBookingConsents, 0],
  };
  const minute = new Date(now).getUTCMinutes();
  const laneIndex = Number.isFinite(minute) ? Math.floor(minute / 5) % SCHEDULED_SYNC_LANES.length : 0;
  const providers = SCHEDULED_SYNC_LANES[laneIndex];
  for (const provider of providers) {
    const [sync, limit] = plan[provider];
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
  console.log(JSON.stringify({ event: "crm_mirror_scheduled_sync", laneIndex, providers, results }));
  await writeCrmMirrorLastRun(env, results, now);
  return results;
}

export async function contactIdFromGhl(env, externalId) {
  return findContactIdByGhlId(env.CRM_DB, externalId);
}
