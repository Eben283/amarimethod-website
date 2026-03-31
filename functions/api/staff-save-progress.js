// Cloudflare Pages Function: POST /api/staff-save-progress
// Saves client progress as GHL tags (taught:*, body:*, block:*)

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

// All known module IDs and body regions — used to compute removals
const ALL_MODULES = [
  "suspension-squat", "hand-balancer", "power-posture", "vertical-drop",
  "active-bridge", "passive-bridge", "spinal-wave", "spring-step",
  "elbow-reset", "jaw-align",
];
const ALL_BODY_REGIONS = ["upper", "middle", "lower"];
const ALL_BODY_STATES = ["active", "passive"];

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const body = await context.request.json();
    const { contactId, progress } = body;

    if (!contactId || !progress) {
      return new Response(JSON.stringify({ error: "contactId and progress are required" }), { status: 400, headers });
    }

    // Compute desired tags from progress state
    const desiredTags = new Set();
    for (const moduleId of ALL_MODULES) {
      if (progress.modules?.[moduleId]) {
        desiredTags.add(`taught:${moduleId}`);
      }
    }
    for (const region of ALL_BODY_REGIONS) {
      const state = progress.bodyGraph?.[region];
      if (state === "active" || state === "passive") {
        desiredTags.add(`body:${region}-${state}`);
      }
    }
    if (progress.yogaBlockSize === "3" || progress.yogaBlockSize === "4") {
      desiredTags.add(`block:${progress.yogaBlockSize}`);
    }

    // Compute all possible progress tags (to know what to remove)
    const allPossibleTags = new Set();
    for (const m of ALL_MODULES) allPossibleTags.add(`taught:${m}`);
    for (const r of ALL_BODY_REGIONS) {
      for (const s of ALL_BODY_STATES) allPossibleTags.add(`body:${r}-${s}`);
    }
    allPossibleTags.add("block:3");
    allPossibleTags.add("block:4");

    const tagsToAdd = [...desiredTags];
    const tagsToRemove = [...allPossibleTags].filter((t) => !desiredTags.has(t));

    // Add and remove tags in parallel
    const ops = [];
    if (tagsToAdd.length > 0) {
      ops.push(
        ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags: tagsToAdd }),
        })
      );
    }
    if (tagsToRemove.length > 0) {
      ops.push(
        ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/tags`, {
          method: "DELETE",
          body: JSON.stringify({ tags: tagsToRemove }),
        })
      );
    }

    const results = await Promise.all(ops);
    const failed = results.find((r) => !r.ok);
    if (failed) {
      const errText = await failed.text();
      console.error(`[staff-save-progress] Tag update failed: ${failed.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to save progress" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-save-progress] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
