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

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const CARDS_KEY = "staff:sharpen-cards";
const MAX_CARDS = 200;
const MAX_LEN = 600;
const CATEGORIES = ["frame", "objection", "discovery", "close", "real-call"];


export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS") });
}

async function readCards(env) {
  const raw = await env.PORTAL_KV.get(CARDS_KEY, "json");
  return Array.isArray(raw?.cards) ? raw.cards : [];
}
async function writeCards(env, cards) {
  await env.PORTAL_KV.put(CARDS_KEY, JSON.stringify({ cards, updatedAt: new Date().toISOString() }));
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"), "Content-Type": "application/json" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  return new Response(JSON.stringify({ cards: await readCards(context.env) }), { status: 200, headers });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"), "Content-Type": "application/json" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;

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
      cards = [{ id: crypto.randomUUID(), category, title, body: text, addedBy: payload.user || "staff", createdAt: now }, ...cards];
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
    case "seen": {
      const seenKey = "staff:sharpen-seen";
      const current = (await context.env.PORTAL_KV.get(seenKey, "json")) || {};
      current.lastOpenedAt = now;
      if (body.cardId && typeof body.cardId === "string") {
        if (!current.seen) current.seen = {};
        current.seen[body.cardId] = now.slice(0, 10);
      }
      await context.env.PORTAL_KV.put(seenKey, JSON.stringify(current));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }
    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  }

  await writeCards(context.env, cards);
  return new Response(JSON.stringify({ cards }), { status: 200, headers });
}
