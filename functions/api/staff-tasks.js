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

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const TASKS_KEY = "staff:garrett-tasks";
const MAX_TASKS = 50;
const MAX_TEXT_LEN = 280;

const DEFAULT_GOAL = "Today: get people out of pain — every call is someone you could help.";
const DEFAULT_RULE = "Every call ends with a text — tap VM + text or Talked + text.";


export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS") });
}

// Read the full state, applying defaults. (Bookings are tracked authoritatively
// in the funnel — deliberately NOT counted here, to avoid two diverging numbers.)
async function readState(env) {
  const raw = (await env.PORTAL_KV.get(TASKS_KEY, "json")) || {};
  return {
    goal: typeof raw.goal === "string" ? raw.goal : DEFAULT_GOAL,
    rule: typeof raw.rule === "string" ? raw.rule : DEFAULT_RULE,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
  };
}

async function writeState(env, state) {
  await env.PORTAL_KV.put(TASKS_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
}

function publicView(state) {
  return { goal: state.goal, rule: state.rule, tasks: state.tasks };
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"), "Content-Type": "application/json" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  const state = await readState(context.env);
  return new Response(JSON.stringify(publicView(state)), { status: 200, headers });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"), "Content-Type": "application/json" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;

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
      state.tasks = [...state.tasks, { id: crypto.randomUUID(), text, done: false, addedBy: payload.user || "staff", createdAt: now }];
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
    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  }

  await writeState(context.env, state);
  return new Response(JSON.stringify(publicView(state)), { status: 200, headers });
}
