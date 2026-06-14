// Cloudflare Pages Function: GET/POST /api/staff-tasks
// "Garrett's Day" — the directive surface on the Schedule tab. ADHD-shaped:
//   - goal: the WHY in Garrett's currency (helping people, not revenue) — the
//     thing an ADHD-healer brain actually moves toward.
//   - rule: a standing reflex (every call ends with a text), pinned — NOT a
//     checkbox, so it never becomes a guilt item that never completes.
//   - bookedToday: the real win to chase (a booking = someone helped). Resets
//     daily. This is the outcome that matters, not "calls done".
//   - tasks: short, manually-curated, checkable. NOT auto-fed (per Eben):
//     Garrett does what he's told, so this is the channel for telling him.
// Both Garrett and Eben edit; last-write-wins (rare concurrent edits, low stakes).

import { verifySessionToken } from "../lib/auth.js";

const TASKS_KEY = "staff:garrett-tasks";
const MAX_TASKS = 50;
const MAX_TEXT_LEN = 280;
const MAX_BOOKED = 200;

const DEFAULT_GOAL = "Today: get people out of pain — every call is someone you could help.";
const DEFAULT_RULE = "Every call ends with a text — tap VM + text or Talked + text.";

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

// Practice-local (Pacific) date, so "booked today" rolls at local midnight.
function pacificToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
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

// Read the full state, applying defaults + the daily booked-counter reset.
async function readState(env) {
  const raw = (await env.PORTAL_KV.get(TASKS_KEY, "json")) || {};
  const today = pacificToday();
  const bookedToday = raw.bookedDate === today ? (raw.bookedToday || 0) : 0;
  return {
    goal: typeof raw.goal === "string" ? raw.goal : DEFAULT_GOAL,
    rule: typeof raw.rule === "string" ? raw.rule : DEFAULT_RULE,
    bookedToday,
    bookedDate: today,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
  };
}

async function writeState(env, state) {
  await env.PORTAL_KV.put(TASKS_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
}

function publicView(state) {
  return { goal: state.goal, rule: state.rule, bookedToday: state.bookedToday, tasks: state.tasks };
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  const gate = await requireStaff(context, headers);
  if (gate.error) return gate.error;
  const state = await readState(context.env);
  return new Response(JSON.stringify(publicView(state)), { status: 200, headers });
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

  const state = await readState(context.env); // already date-normalized

  switch (action) {
    case "add": {
      if (!text) return new Response(JSON.stringify({ error: "Task text required" }), { status: 400, headers });
      if (state.tasks.length >= MAX_TASKS) return new Response(JSON.stringify({ error: "Too many tasks — clear some first" }), { status: 400, headers });
      state.tasks = [...state.tasks, { id: crypto.randomUUID(), text, done: false, addedBy: gate.payload.user || "staff", createdAt: now }];
      break;
    }
    case "edit": {
      if (!id || !text) return new Response(JSON.stringify({ error: "id and text required" }), { status: 400, headers });
      state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, text } : t));
      break;
    }
    case "toggle": {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers });
      state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? now : null } : t));
      break;
    }
    case "delete": {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers });
      state.tasks = state.tasks.filter((t) => t.id !== id);
      break;
    }
    case "clear-done": {
      state.tasks = state.tasks.filter((t) => !t.done);
      break;
    }
    case "set-goal": {
      state.goal = text; // empty clears it
      break;
    }
    case "set-rule": {
      state.rule = text;
      break;
    }
    case "booked-inc": {
      state.bookedToday = Math.min(MAX_BOOKED, (state.bookedToday || 0) + 1);
      break;
    }
    case "booked-dec": {
      state.bookedToday = Math.max(0, (state.bookedToday || 0) - 1);
      break;
    }
    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  }

  await writeState(context.env, state);
  return new Response(JSON.stringify(publicView(state)), { status: 200, headers });
}
