import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const STRIPE_BASE = "https://api.stripe.com/v1";
const GHL_MAX_ATTEMPTS = 3;
const GHL_MIN_INTERVAL_MS = 200;
const GHL_MAX_RETRY_DELAY_MS = 10_000;
const GHL_FALLBACK_BASE_MS = 250;
const GHL_SERVER_JITTER_MS = 100;
const GHL_REQUEST_TIMEOUT_MS = 8_000;

const GHL_INVOCATION_GATE = Symbol("amari.crmMirror.ghlInvocationGate");
let fallbackGate = newGhlGate();
let ghlTimingOverride = null;

function newGhlGate() {
  return { tail: Promise.resolve(), lastRequestAt: null };
}

// A Worker isolate can serve many invocations. Never let one invocation's
// pending I/O promise become the head of another invocation's provider queue:
// if Cloudflare terminates the first pass, every later cron would otherwise
// wait forever on work that can no longer complete in its request context.
export function withGhlProviderInvocation(env) {
  const runtime = { ...(env || {}) };
  Object.defineProperty(runtime, GHL_INVOCATION_GATE, { value: newGhlGate() });
  return runtime;
}

function ghlGate(env) {
  return env?.[GHL_INVOCATION_GATE] || fallbackGate;
}

function defaultTiming() {
  return {
    minIntervalMs: GHL_MIN_INTERVAL_MS,
    maxRetryDelayMs: GHL_MAX_RETRY_DELAY_MS,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: () => Math.random(),
    requestTimeoutMs: GHL_REQUEST_TIMEOUT_MS,
  };
}

function timing() {
  return { ...defaultTiming(), ...(ghlTimingOverride || {}) };
}

// Test-only hooks keep retry/pacing assertions deterministic without exposing
// a production environment switch that could accidentally disable the gate.
export function _setGhlProviderTimingForTests(overrides) {
  ghlTimingOverride = { ...(overrides || {}) };
}

export function _resetGhlProviderGateForTests() {
  fallbackGate = newGhlGate();
  ghlTimingOverride = null;
}

function numericHeader(response, name) {
  const raw = response?.headers?.get?.(name);
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function retryDelayMs(response, attempt, clock) {
  const retryAfter = response?.headers?.get?.("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const serverDelayMs = Math.round(seconds * 1_000);
      return {
        capDelayMs: serverDelayMs,
        waitMs: serverDelayMs + Math.floor(clock.random() * GHL_SERVER_JITTER_MS),
      };
    }
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) {
      const serverDelayMs = Math.max(0, at - clock.now());
      return {
        capDelayMs: serverDelayMs,
        waitMs: serverDelayMs + Math.floor(clock.random() * GHL_SERVER_JITTER_MS),
      };
    }
  }

  const intervalMs = numericHeader(response, "X-RateLimit-Interval-Milliseconds");
  if (intervalMs != null) {
    const serverDelayMs = Math.round(intervalMs);
    return {
      capDelayMs: serverDelayMs,
      waitMs: serverDelayMs + Math.floor(clock.random() * GHL_SERVER_JITTER_MS),
    };
  }

  const ceiling = GHL_FALLBACK_BASE_MS * (2 ** Math.max(0, attempt - 1));
  const waitMs = Math.floor(clock.random() * ceiling);
  return { capDelayMs: waitMs, waitMs };
}

function ghlRateError(response, deferredMs = null) {
  const metadata = [
    ["max", numericHeader(response, "X-RateLimit-Max")],
    ["remaining", numericHeader(response, "X-RateLimit-Remaining")],
    ["intervalMs", numericHeader(response, "X-RateLimit-Interval-Milliseconds")],
    ["dailyRemaining", numericHeader(response, "X-RateLimit-Daily-Remaining")],
    ["retryAfterMs", deferredMs],
  ]
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}=${Math.round(value)}`);
  const suffix = metadata.length ? `; ${metadata.join("; ")}` : "";
  return new Error(`GHL read failed (429${suffix})`);
}

async function paceGhlRead(gate, clock) {
  if (gate.lastRequestAt != null) {
    const waitMs = gate.lastRequestAt + clock.minIntervalMs - clock.now();
    if (waitMs > 0) await clock.sleep(waitMs);
  }
  gate.lastRequestAt = clock.now();
}

function serializeGhlRead(env, task) {
  const gate = ghlGate(env);
  const current = gate.tail.then(task, task);
  gate.tail = current.catch(() => {});
  return current;
}

async function ghlResponse(env, path) {
  return serializeGhlRead(env, async () => {
    const gate = ghlGate(env);
    const clock = timing();
    const token = await getAccessToken(env);

    for (let attempt = 1; attempt <= GHL_MAX_ATTEMPTS; attempt += 1) {
      await paceGhlRead(gate, clock);
      const controller = new AbortController();
      let timeoutId;
      const request = fetch(`${GHL_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
        signal: controller.signal,
      });
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`GHL read timed out after ${clock.requestTimeoutMs}ms`));
        }, clock.requestTimeoutMs);
      });
      let response;
      try {
        response = await Promise.race([request, timeout]);
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") {
          throw new Error(`GHL read timed out after ${clock.requestTimeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
      if (response.status !== 429) return response;
      if (attempt === GHL_MAX_ATTEMPTS) {
        const finalDelay = retryDelayMs(response, attempt, clock);
        throw ghlRateError(response, finalDelay.waitMs);
      }

      const retryDelay = retryDelayMs(response, attempt, clock);
      if (retryDelay.capDelayMs > clock.maxRetryDelayMs) {
        throw ghlRateError(response, retryDelay.waitMs);
      }
      await clock.sleep(retryDelay.waitMs);
    }

    throw new Error("GHL read failed (429)");
  });
}

async function readJson(response, provider) {
  if (!response.ok) throw new Error(`${provider} read failed (${response.status})`);
  return response.json();
}

async function ghlGet(env, path) {
  const response = await ghlResponse(env, path);
  return readJson(response, "GHL");
}

function parseGhlCursor(cursor) {
  if (typeof cursor !== "string") return null;
  try {
    const parsed = JSON.parse(cursor);
    if (!parsed || typeof parsed.afterId !== "string" || !parsed.afterId) return null;
    if (parsed.after == null) return null;
    return { afterId: parsed.afterId, after: parsed.after };
  } catch {
    // The first deployed version stored only an ID. Restarting that bounded import
    // once is safe because contact upserts are idempotent; resuming it is not.
    return null;
  }
}

function nextGhlCursor(meta, contactCount, limit) {
  if (contactCount < limit || !meta?.startAfterId || meta.startAfter == null) return null;
  return JSON.stringify({ afterId: meta.startAfterId, after: meta.startAfter });
}

export async function fetchGhlContactsPage(env, cursor, limit) {
  const params = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: String(limit) });
  const position = parseGhlCursor(cursor);
  if (position) {
    params.set("startAfterId", position.afterId);
    params.set("startAfter", String(position.after));
  }
  const payload = await ghlGet(env, `/contacts/?${params}`);
  const contacts = Array.isArray(payload.contacts) ? payload.contacts.slice(0, limit) : [];
  return { contacts, nextCursor: nextGhlCursor(payload.meta, contacts.length, limit) };
}

// The location-wide inbox is paginated separately from contacts. GHL's
// conversation search uses the sort value of the last returned row
// (`startAfterDate`), not a page number. A synthetic `page` query silently
// returned the same recent slice forever, leaving older conversations absent.
// Messages are then fetched per thread so the owned timeline never depends on
// a UI-only summary.
function conversationCursor(cursor) {
  if (typeof cursor !== "string") return null;
  const value = cursor.trim();
  // Legacy values were small synthetic page numbers such as "1041". GHL's
  // numeric sort value is epoch milliseconds, so only accept a plausibly
  // modern timestamp; otherwise restart once from the recent window.
  if (Number.isFinite(Number(value))) return Number(value) >= 1_000_000_000_000 ? value : null;
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

function conversationSortValue(conversation) {
  const value = conversation?.lastMessageDate || conversation?.dateUpdated || conversation?.dateAdded;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && (Number.isFinite(Number(value)) || Number.isFinite(Date.parse(value)))) return value;
  return null;
}

export async function fetchGhlConversationsPage(env, cursor = null, limit = 100) {
  const params = new URLSearchParams({
    locationId: env.GHL_LOCATION_ID,
    sortBy: "last_message_date",
    sort: "desc",
    limit: String(Math.min(100, Math.max(1, limit))),
  });
  const position = conversationCursor(cursor);
  if (position) params.set("startAfterDate", position);
  const payload = await ghlGet(env, `/conversations/search?${params}`);
  const conversations = Array.isArray(payload.conversations) ? payload.conversations : (Array.isArray(payload.data) ? payload.data : []);
  const lastCursor = conversationSortValue(conversations.at(-1));
  // A missing or unchanged sort value is not safe to advance. Stop rather
  // than repeatedly importing the same slice; a subsequent run can restart
  // from the newest bounded window without corrupting the mirror.
  const nextCursor = conversations.length >= limit && lastCursor && lastCursor !== position
    ? lastCursor
    : null;
  return { conversations, nextCursor };
}

export async function fetchGhlConversationMessages(env, conversationExternalId, limit = 100) {
  const payload = await ghlGet(env, `/conversations/${encodeURIComponent(conversationExternalId)}/messages?limit=${Math.min(100, Math.max(1, limit))}`);
  const messages = Array.isArray(payload.messages?.messages) ? payload.messages.messages : (Array.isArray(payload.messages) ? payload.messages : []);
  return messages.slice(0, limit);
}

// GHL's conversation message-list response can carry the preceding outbound
// body on a new inbound email. The individual message read is authoritative
// for the body and metadata shown in Staff.
export async function fetchGhlMessage(env, messageExternalId) {
  const payload = await ghlGet(env, `/conversations/messages/${encodeURIComponent(messageExternalId)}`);
  return payload.message || payload;
}

// Email threads are represented in the generic message list by one mutable
// container row. Its meta.email.messageIds entries are the immutable email
// revisions that must be mirrored individually or a later reply overwrites an
// earlier one in Staff.
export async function fetchGhlEmail(env, emailMessageExternalId) {
  const payload = await ghlGet(env, `/conversations/messages/email/${encodeURIComponent(emailMessageExternalId)}`);
  const email = payload.emailMessage || payload.email || payload.message || payload;
  return { ...email, messageType: email.messageType || "TYPE_EMAIL" };
}

export async function fetchGhlMessageExport(env, cursor = null, limit = 50) {
  const params = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: String(Math.min(100, Math.max(10, limit))) });
  if (cursor) params.set("cursor", cursor);
  const payload = await ghlGet(env, `/conversations/messages/export?${params}`);
  return { messages: Array.isArray(payload.messages) ? payload.messages : [], nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null };
}

export async function fetchGhlAppointmentsForContact(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/appointments?limit=100`);
  const appointments = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.appointments)
      ? payload.appointments
      : [];
  // This is deliberately bounded. An unexpectedly large history is a review condition, not a reason to buffer it all.
  return appointments.slice(0, 100);
}

export async function fetchGhlContact(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}`);
  return payload.contact || payload;
}

// Notes and tasks are contact-scoped endpoints. Unlike the contacts list, they
// reject a locationId query parameter, so use the shared authenticated reader
// directly rather than routing through a helper that adds location scope.
export async function fetchGhlContactNotes(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/notes`);
  return Array.isArray(payload.notes) ? payload.notes : [];
}

export async function fetchGhlContactTasks(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/tasks`);
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

// Used when a full-pass completeness cycle finds contacts the list walk did not
// refresh. GHL returns 400 "Contact not found" for deleted IDs; those are ghosts
// in the mirror, not missing source records that need operator recovery.
export async function fetchGhlContactExists(env, contactExternalId) {
  const response = await ghlResponse(
    env,
    `/contacts/${encodeURIComponent(contactExternalId)}`,
  );
  if (response.status === 400 || response.status === 404) return false;
  if (!response.ok) throw new Error(`GHL contact probe failed (${response.status})`);
  return true;
}

export async function fetchStripeChargesPage(env, cursor, limit) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("starting_after", cursor);
  const response = await fetch(`${STRIPE_BASE}/charges?${params}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const payload = await readJson(response, "Stripe");
  const charges = Array.isArray(payload.data) ? payload.data.slice(0, limit) : [];
  return { charges, nextCursor: payload.has_more ? charges.at(-1)?.id || null : null };
}

export async function fetchStripeInvoicesPage(env, cursor, limit) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("starting_after", cursor);
  const response = await fetch(`${STRIPE_BASE}/invoices?${params}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const payload = await readJson(response, "Stripe invoices");
  const invoices = Array.isArray(payload.data) ? payload.data.slice(0, limit) : [];
  return { invoices, nextCursor: payload.has_more ? invoices.at(-1)?.id || null : null };
}

export async function fetchStripeCustomer(env, customerExternalId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!customerExternalId) return null;
  const response = await fetch(`${STRIPE_BASE}/customers/${encodeURIComponent(customerExternalId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  // Deleted customers are not an import failure. The charge remains visible for
  // review but contributes no identity evidence.
  if (response.status === 404) return null;
  return readJson(response, "Stripe customer");
}
