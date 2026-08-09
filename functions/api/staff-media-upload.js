import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import { mediaObjectKey, registerMediaAsset, validateMediaUpload } from "../lib/staff-media.js";

function responseHeaders(context) {
  return {
    ...corsHeaders(context.request.headers.get("Origin") || "", "POST, OPTIONS"),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amari-File-Name, X-Amari-Folder-Id, X-Amari-File-Size",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers });
}

function decodedHeader(request, key) {
  const value = request.headers.get(key) || "";
  try { return decodeURIComponent(value); } catch { return ""; }
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context) });
}

export async function onRequestPost(context) {
  const headers = responseHeaders(context);
  const auth = await requireStaffAuth(context, headers);
  if (auth.error) return auth.error;
  if (!context.env.MEDIA_BUCKET || !context.env.ATTEND_DB) {
    return json({ error: "Media upload storage is not configured" }, 422, headers);
  }
  const name = decodedHeader(context.request, "X-Amari-File-Name");
  const folderId = decodedHeader(context.request, "X-Amari-Folder-Id") || null;
  const mimeType = context.request.headers.get("Content-Type") || "";
  const sizeBytes = Number(context.request.headers.get("X-Amari-File-Size") || context.request.headers.get("Content-Length"));
  let upload;
  try {
    upload = validateMediaUpload({ name, mimeType, sizeBytes });
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : "Invalid media upload" }, Number(cause?.status) || 400, headers);
  }
  if (!context.request.body) return json({ error: "The file is empty" }, 400, headers);

  const assetId = crypto.randomUUID();
  const objectKey = mediaObjectKey(assetId, upload.mimeType);
  try {
    await context.env.MEDIA_BUCKET.put(objectKey, context.request.body, {
      httpMetadata: { contentType: upload.mimeType },
      customMetadata: { assetId, uploadedBy: String(auth.payload?.user || "Staff").slice(0, 80) },
    });
    const registered = await registerMediaAsset(context.env.ATTEND_DB, {
      name: upload.displayName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      folderId,
    }, { actor: auth.payload?.user || "Staff", id: assetId });
    return json({ asset: registered.asset }, 201, headers);
  } catch (cause) {
    try { await context.env.MEDIA_BUCKET.delete(objectKey); } catch { /* best-effort compensation */ }
    const status = [400, 404, 409, 422].includes(Number(cause?.status)) ? Number(cause.status) : 500;
    if (status === 500) console.error("[staff-media-upload]", cause);
    return json({ error: cause instanceof Error ? cause.message : "File upload failed" }, status, headers);
  }
}
