// Shared helpers for the Staff Conversations inbox backed by conversation-cache KV.
// Pages Functions and send paths append here so the UI never waits on the 5-minute cron.

import { isNonReply } from "../lib/message-reply.js";

const TEXT_LIMIT = 280;
const DEFAULT_LIST_LIMIT = 80;
const ACTIVE_MS = 45 * 24 * 60 * 60 * 1000; // hide quiet threads older than 45 days

export function lastSeenKey(contactId) {
  return `inbox:lastSeen:${contactId}`;
}

export function touchPreview(touch) {
  if (!touch) return "";
  if (touch.kind === "call") {
    const dur = touch.dur != null ? ` · ${Math.round(Number(touch.dur) / 60) || 1}m` : "";
    return `${touch.dir === "in" ? "Inbound" : "Outbound"} call${dur}`;
  }
  return String(touch.text || "").trim();
}

export function summarizeConv(entry, lastSeenMs = 0) {
  if (!entry?.contactId) return null;
  const touches = Array.isArray(entry.touches) ? entry.touches : [];
  const last = touches[touches.length - 1] || null;
  const lastMessageDate = Number(entry.lastMessageDate) || Number(last?.ts) || 0;
  const lastDir = last?.dir === "in" ? "inbound" : last?.dir === "out" ? "outbound" : "outbound";
  const preview = touchPreview(last);
  const needsReply = lastDir === "inbound" && !isNonReply(preview);
  const unread = lastDir === "inbound" && lastMessageDate > Number(lastSeenMs || 0);
  return {
    contactId: entry.contactId,
    contactName: entry.name || [entry.firstName, entry.lastName].filter(Boolean).join(" ") || "Unknown",
    email: entry.email || "",
    lastMessagePreview: preview.slice(0, 160),
    lastMessageDate: lastMessageDate || null,
    lastMessageType: last?.kind === "email" ? "Email" : last?.kind === "call" ? "Call" : "SMS",
    lastMessageDirection: lastDir,
    needsReply,
    unread,
    touchCount: touches.length,
  };
}

export async function readConvIndex(kv) {
  if (!kv) return {};
  const raw = await kv.get("conv:index", "json");
  return raw && typeof raw === "object" ? raw : {};
}

export async function readConv(kv, contactId) {
  if (!kv || !contactId) return null;
  const raw = await kv.get(`conv:${contactId}`, "json");
  return raw && typeof raw === "object" ? raw : null;
}

export async function listInboxThreads(kv, { limit = DEFAULT_LIST_LIMIT, filter = "active" } = {}) {
  const index = await readConvIndex(kv);
  const ranked = Object.entries(index)
    .map(([contactId, lastMessageDate]) => ({ contactId, lastMessageDate: Number(lastMessageDate) || 0 }))
    .filter((row) => row.contactId && row.lastMessageDate > 0)
    .sort((a, b) => b.lastMessageDate - a.lastMessageDate);

  const cutoff = Date.now() - ACTIVE_MS;
  const pool = filter === "all" ? ranked : ranked.filter((row) => row.lastMessageDate >= cutoff);
  const selected = pool.slice(0, Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), 150));

  const threads = [];
  for (const row of selected) {
    const entry = await readConv(kv, row.contactId);
    if (!entry) continue;
    const lastSeenRaw = await kv.get(lastSeenKey(row.contactId));
    const summary = summarizeConv(entry, lastSeenRaw ? Number(lastSeenRaw) : 0);
    if (!summary) continue;
    if (filter === "needs_reply" && !summary.needsReply) continue;
    threads.push(summary);
  }
  return threads;
}

export async function getInboxThread(kv, contactId, { markSeen = false } = {}) {
  const entry = await readConv(kv, contactId);
  if (!entry) return null;
  if (markSeen && kv) {
    const seenAt = Number(entry.lastMessageDate) || Date.now();
    try { await kv.put(lastSeenKey(contactId), String(seenAt)); } catch { /* non-fatal */ }
  }
  const lastSeenRaw = await kv.get(lastSeenKey(contactId));
  const summary = summarizeConv(entry, lastSeenRaw ? Number(lastSeenRaw) : 0);
  const messages = (Array.isArray(entry.touches) ? entry.touches : []).map((touch, index) => ({
    id: `${contactId}:${touch.ts || index}:${touch.kind || "sms"}:${touch.dir || "out"}`,
    body: touch.kind === "call" ? touchPreview(touch) : String(touch.text || "").trim(),
    direction: touch.dir === "in" ? "inbound" : "outbound",
    dateAdded: new Date(Number(touch.ts) || Date.now()).toISOString(),
    type: touch.kind === "email" ? "Email" : touch.kind === "call" ? "Call" : "SMS",
  }));
  return {
    ...summary,
    firstName: entry.firstName || "",
    lastName: entry.lastName || "",
    role: entry.role || "",
    business: entry.business || "",
    messages,
  };
}

export async function appendOutboundTouch(kv, contactId, { kind = "sms", text = "", ts = Date.now() } = {}) {
  if (!kv || !contactId) return false;
  const key = `conv:${contactId}`;
  const entry = (await kv.get(key, "json")) || { contactId, touches: [] };
  const touches = Array.isArray(entry.touches) ? entry.touches.slice() : [];
  const touch = {
    ts: Number(ts) || Date.now(),
    kind: kind === "email" ? "email" : "sms",
    dir: "out",
    text: String(text || "").trim().slice(0, TEXT_LIMIT),
  };
  const dedupe = `${touch.ts}|${touch.kind}|${touch.dir}|${touch.text}`;
  const exists = touches.some((t) => `${t.ts}|${t.kind}|${t.dir}|${t.text || ""}` === dedupe);
  if (!exists) touches.push(touch);
  entry.contactId = contactId;
  entry.touches = touches;
  entry.lastMessageDate = touch.ts;
  await kv.put(key, JSON.stringify(entry));

  const index = await readConvIndex(kv);
  index[contactId] = touch.ts;
  await kv.put("conv:index", JSON.stringify(index));
  return true;
}
