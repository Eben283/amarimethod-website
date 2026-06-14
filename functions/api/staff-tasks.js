// Cloudflare Pages Function: GET/POST /api/staff-tasks
// "Garrett's Day" — a short, shared, manually-curated directive list shown on
// the Schedule tab. Eben sets marching orders; Garrett works + edits them.
// Deliberately NOT auto-fed (per Eben 2026-06-14): Garrett does what he's told,
// so this is the channel for telling him — kept short, do → tap done.
//
// Storage: one shared list in PORTAL_KV under TASKS_KEY (single practitioner).
// Both Garrett and Eben edit the same list; `addedBy` records who added each.
// Last-write-wins on concurrent edits (two people editing the same instant is
// rare and low-stakes for a task list).

import { verifySessionToken } from "../lib/auth.js";

const TASKS_KEY = "staff:garrett-tasks";
const MAX_TASKS = 50;          // backstop against runaway growth
const MAX_TEXT_LEN = 280;

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

// Verify the staff session and return the token payload, or a Response to return.
async function requireStaff(context, headers) {
  const JWT_SECRET = context.env.JWT_SECRET;
  if (!JWT_SECRET) return { error: new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers }) };
  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return { error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers }) };
  let payload;
  try {
    payload = await verifySessionToken(auth.slice(7), JWT_SECRET);
  } catch {
    return { error: new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers }) };
  }
  if (payload.role !== "staff") return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers }) };
  return { payload };
}

async function readTasks(env) {
  const raw = await env.PORTAL_KV.get(TASKS_KEY, "json");
  return Array.isArray(raw?.tasks) ? raw.tasks : [];
}

async function writeTasks(env, tasks) {
  await env.PORTAL_KV.put(TASKS_KEY, JSON.stringify({ tasks, updatedAt: new Date().toISOString() }));
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  const gate = await requireStaff(context, headers);
  if (gate.error) return gate.error;
  const tasks = await readTasks(context.env);
  return new Response(JSON.stringify({ tasks }), { status: 200, headers });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  const gate = await requireStaff(context, headers);
  if (gate.error) return gate.error;

  let body;
  try { body = await context.request.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

  const { action, id } = body;
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_LEN) : "";
  const now = new Date().toISOString();

  let tasks = await readTasks(context.env);

  switch (action) {
    case "add": {
      if (!text) return new Response(JSON.stringify({ error: "Task text required" }), { status: 400, headers });
      if (tasks.length >= MAX_TASKS) return new Response(JSON.stringify({ error: "Too many tasks — clear some first" }), { status: 400, headers });
      tasks = [
        ...tasks,
        { id: crypto.randomUUID(), text, done: false, addedBy: gate.payload.user || "staff", createdAt: now },
      ];
      break;
    }
    case "edit": {
      if (!id || !text) return new Response(JSON.stringify({ error: "id and text required" }), { status: 400, headers });
      tasks = tasks.map((t) => (t.id === id ? { ...t, text } : t));
      break;
    }
    case "toggle": {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers });
      tasks = tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? now : null } : t));
      break;
    }
    case "delete": {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers });
      tasks = tasks.filter((t) => t.id !== id);
      break;
    }
    case "clear-done": {
      tasks = tasks.filter((t) => !t.done);
      break;
    }
    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  }

  await writeTasks(context.env, tasks);
  return new Response(JSON.stringify({ tasks }), { status: 200, headers });
}
