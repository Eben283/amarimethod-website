// Cloudflare Pages Function: GET/POST /api/staff-sharpen
// "Sharpen" — a bite-sized, Instagram-ish card feed for getting better at the
// CALL itself (framing, objections, discovery, the ask). NOT a work to-do — it's
// the "scroll this instead of Instagram" surface, so it lives on its own tab.
//
// Content principle (important): cards are REAL — drawn from the locked Amari
// positioning, general call technique, and (the gold) Garrett's actual calls.
// NEVER generic sales-bro scripts in his voice — he bounces off those, and we
// don't fabricate his playbook (see feedback_prescriptive_vs_descriptive).
// Editable so Eben/Garrett grow it from real calls in the morning loop.

import { verifySessionToken } from "../lib/auth.js";

const CARDS_KEY = "staff:sharpen-cards";
const MAX_CARDS = 200;
const MAX_LEN = 600;
const CATEGORIES = ["frame", "objection", "discovery", "close", "real-call"];

const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

async function requireStaff(context, headers) {
  const JWT_SECRET = context.env.JWT_SECRET;
  if (!JWT_SECRET) return { error: new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers }) };
  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return { error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers }) };
  let payload;
  try { payload = await verifySessionToken(auth.slice(7), JWT_SECRET); }
  catch { return { error: new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers }) }; }
  if (payload.role !== "staff") return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers }) };
  return { payload };
}

async function readCards(env) {
  const raw = await env.PORTAL_KV.get(CARDS_KEY, "json");
  return Array.isArray(raw?.cards) ? raw.cards : [];
}
async function writeCards(env, cards) {
  await env.PORTAL_KV.put(CARDS_KEY, JSON.stringify({ cards, updatedAt: new Date().toISOString() }));
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  const gate = await requireStaff(context, headers);
  if (gate.error) return gate.error;
  return new Response(JSON.stringify({ cards: await readCards(context.env) }), { status: 200, headers });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  const gate = await requireStaff(context, headers);
  if (gate.error) return gate.error;

  let body;
  try { body = await context.request.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

  const { action, id } = body;
  const category = CATEGORIES.includes(body.category) ? body.category : "frame";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_LEN) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, MAX_LEN) : "";
  const now = new Date().toISOString();

  let cards = await readCards(context.env);

  switch (action) {
    case "add": {
      if (!title && !text) return new Response(JSON.stringify({ error: "Card needs a title or body" }), { status: 400, headers });
      if (cards.length >= MAX_CARDS) return new Response(JSON.stringify({ error: "Too many cards" }), { status: 400, headers });
      cards = [{ id: crypto.randomUUID(), category, title, body: text, addedBy: gate.payload.user || "staff", createdAt: now }, ...cards];
      break;
    }
    case "edit": {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers });
      cards = cards.map((c) => (c.id === id ? { ...c, category, title, body: text } : c));
      break;
    }
    case "delete": {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers });
      cards = cards.filter((c) => c.id !== id);
      break;
    }
    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  }

  await writeCards(context.env, cards);
  return new Response(JSON.stringify({ cards }), { status: 200, headers });
}
