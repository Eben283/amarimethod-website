// Private workshop storage for the Amari description practice. It records only
// staff-authored language feedback; it never touches client or provider data.
import { requireStaffAuth, corsHeaders } from '../lib/endpoint-guards.js';

const KEY = 'staff:amari-description-lab:v1';
const MAX_TEXT = 1600;
const MAX_EVENTS = 300;

function headers(request) {
  return { ...corsHeaders(request.headers.get('Origin'), 'GET, POST, OPTIONS'), 'Content-Type': 'application/json' };
}
function clean(value) { return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''; }
async function read(env) { return (await env.PORTAL_KV.get(KEY, 'json')) || { overrides: {}, feedback: [] }; }

export async function onRequestOptions(context) { return new Response(null, { status: 204, headers: headers(context.request) }); }
export async function onRequestGet(context) {
  const out = headers(context.request); const auth = await requireStaffAuth(context, out); if (auth.error) return auth.error;
  return new Response(JSON.stringify(await read(context.env)), { status: 200, headers: out });
}
export async function onRequestPost(context) {
  const out = headers(context.request); const auth = await requireStaffAuth(context, out); if (auth.error) return auth.error;
  let body; try { body = await context.request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: out }); }
  const cardId = clean(body.cardId); if (!cardId || cardId.length > 80) return new Response(JSON.stringify({ error: 'A card is required' }), { status: 400, headers: out });
  const state = await read(context.env); const now = new Date().toISOString();
  if (body.action === 'save') {
    const answer = clean(body.answer); const note = clean(body.note);
    if (!answer) return new Response(JSON.stringify({ error: 'An answer is required' }), { status: 400, headers: out });
    state.overrides[cardId] = { answer, note, updatedAt: now, updatedBy: auth.payload.user || 'staff' };
    state.feedback.unshift({ type: 'edit', cardId, answer, note, at: now, by: auth.payload.user || 'staff' });
  } else if (body.action === 'feedback') {
    const sentiment = body.sentiment === 'keep' || body.sentiment === 'rewrite' ? body.sentiment : null;
    if (!sentiment) return new Response(JSON.stringify({ error: 'Choose keep or rewrite' }), { status: 400, headers: out });
    state.feedback.unshift({ type: sentiment, cardId, note: clean(body.note), at: now, by: auth.payload.user || 'staff' });
  } else return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: out });
  state.feedback = state.feedback.slice(0, MAX_EVENTS);
  await context.env.PORTAL_KV.put(KEY, JSON.stringify(state));
  return new Response(JSON.stringify(state), { status: 200, headers: out });
}
