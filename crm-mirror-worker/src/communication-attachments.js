import { resolveGhlAttachmentUrl } from "./providers.js";

const ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const SAFE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic",
  "application/pdf", "text/plain", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function failure(message, status) { return Object.assign(new Error(message), { status }); }

function safeRemoteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure("Attachment source is invalid", 422); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) {
    throw failure("Attachment source is invalid", 422);
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) {
    throw failure("Attachment source is invalid", 422);
  }
  return url;
}

function cleanName(value, fallback) {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f"\\/]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return name || fallback;
}

async function providerResponse(locator, fetchImpl) {
  let current = safeRemoteUrl(locator);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(current, { method: "GET", redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === MAX_REDIRECTS) throw failure("Attachment redirect limit exceeded", 502);
    const location = response.headers.get("Location");
    if (!location) throw failure("Attachment redirect is invalid", 502);
    current = safeRemoteUrl(new URL(location, current).toString());
  }
  throw failure("Attachment could not be opened", 502);
}

export async function serveCommunicationAttachment(env, attachmentId, options = {}) {
  if (!env?.CRM_DB) throw failure("Attachment storage is unavailable", 503);
  if (!ATTACHMENT_ID.test(String(attachmentId || ""))) throw failure("Attachment not found", 404);
  const record = await env.CRM_DB.prepare(
    `SELECT id, provider, provider_locator, display_name, mime_type, size_bytes
       FROM communication_event_attachments WHERE id = ?`,
  ).bind(attachmentId).first();
  if (!record) throw failure("Attachment not found", 404);
  if (record.provider !== "ghl") throw failure("Attachment provider is unavailable", 422);
  const resolveLocator = options.resolveGhlAttachmentUrl || resolveGhlAttachmentUrl;
  const locator = await resolveLocator(env, record.provider_locator);
  const response = await providerResponse(locator, options.fetchImpl || globalThis.fetch);
  if (!response.ok || !response.body) throw failure("Attachment could not be opened", response.status === 404 ? 404 : 502);
  const contentType = String(response.headers.get("Content-Type") || record.mime_type || "").split(";", 1)[0].trim().toLowerCase();
  const contentLength = Number(response.headers.get("Content-Length") || record.size_bytes);
  if (!SAFE_TYPES.has(contentType)) throw failure("Attachment type is not supported", 415);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_BYTES) {
    throw failure("Attachment size is unavailable or too large", 413);
  }
  const fallback = contentType.startsWith("image/") ? "image-attachment" : "attachment";
  const filename = cleanName(record.display_name, fallback);
  const asciiFilename = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "attachment";
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(contentLength),
      "Content-Disposition": `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
