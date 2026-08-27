import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import { createMediaFolder, listStaffMedia, updateMediaAsset } from "../lib/staff-media.js";
import { importSiteMediaBatch, syncSiteMediaCatalog } from "../lib/staff-site-media.js";

function responseHeaders(context) {
  return {
    ...corsHeaders(context.request.headers.get("Origin") || "", "GET, POST, OPTIONS"),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers });
}

function safeStatus(cause) {
  const status = Number(cause?.status) || 500;
  return [400, 404, 409, 422].includes(status) ? status : 500;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context) });
}

export async function onRequestGet(context) {
  const headers = responseHeaders(context);
  const auth = await requireStaffAuth(context, headers);
  if (auth.error) return auth.error;
  try {
    const url = new URL(context.request.url);
    const library = await listStaffMedia(context.env.ATTEND_DB || null, {
      includeArchived: url.searchParams.get("archived") === "1",
    });
    return json({ ...library, storage: "owned-d1-r2", uploadReady: !!context.env.MEDIA_BUCKET }, 200, headers);
  } catch (cause) {
    const status = safeStatus(cause);
    if (status === 500) console.error("[staff-media] list", cause);
    return json({ error: cause instanceof Error ? cause.message : "Media library could not be loaded" }, status, headers);
  }
}

export async function onRequestPost(context) {
  const headers = responseHeaders(context);
  const auth = await requireStaffAuth(context, headers);
  if (auth.error) return auth.error;
  const parsed = await parseJsonBody(context.request, headers);
  if (parsed.error) return parsed.error;
  try {
    const actor = auth.payload?.user || "Staff";
    if (parsed.body.action === "sync_site_catalog") {
      const synced = await syncSiteMediaCatalog({ db: context.env.ATTEND_DB || null, actor });
      return json(synced, 200, headers);
    }
    if (parsed.body.action === "import_site_assets") {
      const imported = await importSiteMediaBatch({
        db: context.env.ATTEND_DB || null,
        bucket: context.env.MEDIA_BUCKET || null,
        origin: new URL(context.request.url).origin,
        actor,
        offset: parsed.body.offset,
      });
      return json(imported, 200, headers);
    }
    if (parsed.body.action === "create_folder") {
      const folder = await createMediaFolder(context.env.ATTEND_DB || null, parsed.body, { actor });
      return json({ folder }, 201, headers);
    }
    const asset = await updateMediaAsset(context.env.ATTEND_DB || null, parsed.body, { actor });
    return json({ asset }, 200, headers);
  } catch (cause) {
    const status = safeStatus(cause);
    if (status === 500) console.error("[staff-media] mutate", cause);
    return json({ error: cause instanceof Error ? cause.message : "Media library could not be updated" }, status, headers);
  }
}
