import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import { getMediaAssetRecord } from "../lib/staff-media.js";

function baseHeaders(context) {
  return {
    ...corsHeaders(context.request.headers.get("Origin") || "", "GET, HEAD, OPTIONS"),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function contentDisposition(name, download) {
  const fallback = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "amari-media";
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function parseRange(value, size) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value || "");
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return { offset: start, length: end - start + 1, end };
}

async function serve(context, headOnly = false) {
  const headers = baseHeaders(context);
  const auth = await requireStaffAuth(context, headers);
  if (auth.error) return auth.error;
  if (!context.env.MEDIA_BUCKET || !context.env.ATTEND_DB) {
    return new Response(JSON.stringify({ error: "Media file storage is not configured" }), { status: 422, headers: { ...headers, "Content-Type": "application/json" } });
  }
  try {
    const url = new URL(context.request.url);
    const record = await getMediaAssetRecord(context.env.ATTEND_DB, url.searchParams.get("id"));
    const range = parseRange(context.request.headers.get("Range"), record.public.sizeBytes);
    const object = headOnly
      ? await context.env.MEDIA_BUCKET.head(record.objectKey)
      : await context.env.MEDIA_BUCKET.get(record.objectKey, range ? { range: { offset: range.offset, length: range.length } } : undefined);
    if (!object) return new Response("File not found", { status: 404, headers });
    const responseHeaders = new Headers(headers);
    responseHeaders.set("Content-Type", record.public.mimeType);
    responseHeaders.set("Accept-Ranges", "bytes");
    responseHeaders.set("Content-Disposition", contentDisposition(record.public.name, url.searchParams.get("download") === "1"));
    if (object.etag) responseHeaders.set("ETag", object.etag);
    if (range) {
      responseHeaders.set("Content-Length", String(range.length));
      responseHeaders.set("Content-Range", `bytes ${range.offset}-${range.end}/${record.public.sizeBytes}`);
    } else {
      responseHeaders.set("Content-Length", String(record.public.sizeBytes));
    }
    return new Response(headOnly ? null : object.body, { status: range ? 206 : 200, headers: responseHeaders });
  } catch (cause) {
    const status = [400, 404, 422].includes(Number(cause?.status)) ? Number(cause.status) : 500;
    if (status === 500) console.error("[staff-media-file]", cause);
    return new Response(JSON.stringify({ error: cause instanceof Error ? cause.message : "Media file could not be opened" }), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: baseHeaders(context) });
}

export async function onRequestGet(context) {
  return serve(context, false);
}

export async function onRequestHead(context) {
  return serve(context, true);
}
