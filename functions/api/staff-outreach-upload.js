// Cloudflare Pages Function: POST /api/staff-outreach-upload
// Receives the daily outreach snapshot from the local /day cron and stores it in PORTAL_KV.
// Auth: shared-secret header X-Upload-Secret (must match env OUTREACH_UPLOAD_SECRET).
// The shared secret is set via:
//   npx wrangler pages secret put OUTREACH_UPLOAD_SECRET --project-name amarimethod-website

import { writeBeat } from "../lib/heartbeat.js";

const KV_KEY = "outreach-snapshot:current";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Upload-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const expectedSecret = context.env.OUTREACH_UPLOAD_SECRET;
    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }

    const providedSecret = context.request.headers.get("X-Upload-Secret");
    if (!providedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 401,
        headers,
      });
    }

    const kv = context.env.PORTAL_KV;
    if (!kv) {
      return new Response(
        JSON.stringify({ error: "KV not bound" }),
        { status: 500, headers },
      );
    }

    let snapshot;
    try {
      snapshot = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers,
      });
    }

    if (!snapshot || !Array.isArray(snapshot.cards)) {
      return new Response(
        JSON.stringify({ error: "Snapshot missing 'cards' array" }),
        { status: 400, headers },
      );
    }

    // Stamp upload time alongside the generation time. Useful for the staff app
    // to display "snapshot taken at X, uploaded at Y."
    const stored = {
      ...snapshot,
      uploadedAt: new Date().toISOString(),
    };

    await kv.put(KV_KEY, JSON.stringify(stored));

    // Heartbeat for the outreach-snapshot job. This upload IS the outreach
    // pipeline reaching KV, so the beat belongs here (the local generator writes
    // a file; KV is the shared surface). producedN = cards. If the local cron
    // dies before uploading, this endpoint is never called and no beat is
    // written, so /day flags the job red — the exact silent-writer failure the
    // system map calls out. Best-effort: never fail the upload over a beat.
    try {
      await writeBeat(kv, "outreach-snapshot", { producedN: snapshot.cards.length, ok: true });
    } catch (beatErr) {
      console.error("[staff-outreach-upload] beat write failed (non-fatal):", beatErr);
    }

    return new Response(
      JSON.stringify({ ok: true, cardCount: snapshot.cards.length, uploadedAt: stored.uploadedAt }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("[staff-outreach-upload]", err);
    return new Response(
      JSON.stringify({ error: err.message || "Upload failed" }),
      { status: 500, headers },
    );
  }
}
