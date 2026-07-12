// The working automation dashboard — served straight from this worker so it ships without the
// Pages deploy hold (Eben, 2026-07-12: "make me a working dashboard"). Read-only by design
// (his v1 answer: no actuators).
//
//   GET /dashboard        public shell — layout + JS only, zero data baked in
//   GET /dashboard-data   the four panels as JSON, gated by DASHBOARD_KEY (a dedicated
//                         read-only secret; the page stores it in localStorage after a
//                         one-time paste or a #k= fragment)
//
// Views per Eben's v1 answers: activity feed first ("what is happening today / yesterday"),
// then coming-up, active enrollments, failures. Contact ids resolve to names via a read-only
// GHL lookup (PORTAL_KV token) with an isolate-lifetime cache.

import { timingSafeEqual } from "../../functions/lib/safe-equal.js";
import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

// ── data ──────────────────────────────────────────────────────────────────────

async function rows(db, sql, ...binds) {
  const res = await db.prepare(sql).bind(...binds).all();
  return res.results || [];
}

const nameCache = new Map(); // contactId → name; isolate lifetime is plenty at this volume

async function resolveNames(env, contactIds) {
  const out = {};
  if (!env.PORTAL_KV) return out;
  const wanted = [...new Set(contactIds)].filter(Boolean).slice(0, 25);
  for (const id of wanted) {
    if (nameCache.has(id)) { out[id] = nameCache.get(id); continue; }
    try {
      const token = await getAccessToken(env);
      const res = await fetch(`${GHL_API_BASE}/contacts/${id}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const c = data.contact || data;
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null;
      if (name) { nameCache.set(id, name); out[id] = name; }
    } catch { /* names are decoration — never fail the panel over them */ }
  }
  return out;
}

export async function handleDashboardData(request, env) {
  const key = env.DASHBOARD_KEY;
  if (!key) return json(503, { error: "dashboard key not configured" });
  const header = request.headers.get("Authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !timingSafeEqual(provided, key)) return json(401, { error: "unauthorized" });

  const url = new URL(request.url);
  const hours = Math.min(Math.max(parseInt(url.searchParams.get("hours") || "48", 10) || 48, 1), 24 * 90);
  const sinceMs = Date.now() - hours * 3600000;
  const horizon = Date.now() + 24 * 3600000;
  const db = env.REMINDER_DB;

  try {
    const [events, enrollments, dueSoon, failures] = await Promise.all([
      rows(db, `SELECT * FROM automation_events WHERE ts >= ? ORDER BY ts DESC LIMIT 300`, sinceMs),
      rows(db, `SELECT 'reminder' AS engine, flow_key AS key, contact_id, enrolled_at AS entered_at FROM reminder_enrollments WHERE status='active'
                UNION ALL
                SELECT 'nurture', sequence_id, contact_id, entered_at FROM nurture_enrollments WHERE status='active'`),
      rows(db, `SELECT 'reminder' AS engine, s.template, s.due_at, e.contact_id FROM reminder_steps s
                  JOIN reminder_enrollments e ON e.enrollment_id = s.enrollment_id
                  WHERE s.status='pending' AND e.status='active' AND s.due_at <= ?
                UNION ALL
                SELECT 'nurture', s.template, s.due_at, e.contact_id FROM nurture_steps s
                  JOIN nurture_enrollments e ON e.enrollment_id = s.enrollment_id
                  WHERE s.status='pending' AND e.status='active' AND s.due_at <= ?
                ORDER BY due_at ASC LIMIT 50`, horizon, horizon),
      rows(db, `SELECT * FROM automation_events WHERE outcome IN ('failed','bounced','error') ORDER BY ts DESC LIMIT 50`),
    ]);

    const parse = (e) => {
      let detail = null;
      try { detail = e.detail ? JSON.parse(e.detail) : null; } catch { detail = { raw: e.detail }; }
      return { ...e, detail };
    };
    const names = await resolveNames(env, [
      ...events.map((e) => e.contact_id),
      ...enrollments.map((e) => e.contact_id),
      ...dueSoon.map((e) => e.contact_id),
    ]);

    return json(200, {
      generatedAt: Date.now(),
      hours,
      names,
      events: events.map(parse),
      enrollments,
      dueSoon,
      failures: failures.map(parse),
    });
  } catch (err) {
    return json(500, { error: String((err && err.message) || err) });
  }
}

// ── the shell ─────────────────────────────────────────────────────────────────
// Self-contained: no external fonts, scripts, or styles. Espresso ledger, cream ink, the
// brand apricot as the single accent; the WOULD stamp is the page's signature — shadow
// mode's honesty made visual.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amari — Automation Watch</title>
<style>
  :root {
    --bg: #241B15; --panel: #2E241C; --line: #3E3128;
    --ink: #F2E9DD; --muted: #B5A491; --accent: #EBA584;
    --shadowed: #A8B892; --fail: #D98873;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 28px 18px 80px;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  header h1 {
    font-family: Georgia, "Times New Roman", serif; font-weight: 400;
    font-size: 30px; letter-spacing: 0.01em;
  }
  header .thesis { color: var(--muted); margin-top: 6px; max-width: 56ch; }
  header .thesis b { color: var(--accent); font-weight: 600; }
  .stats { display: flex; gap: 10px; flex-wrap: wrap; margin: 22px 0 6px; }
  .stat {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 14px; min-width: 118px; flex: 1;
  }
  .stat .n { font-size: 24px; font-family: Georgia, serif; }
  .stat .l { color: var(--muted); font-size: 12px; }
  .controls { display: flex; gap: 8px; align-items: center; margin: 14px 0 26px; color: var(--muted); font-size: 13px; }
  .controls button {
    background: none; border: 1px solid var(--line); color: var(--muted);
    border-radius: 999px; padding: 4px 12px; font: inherit; cursor: pointer;
  }
  .controls button[aria-pressed="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .controls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  h2 {
    font-family: Georgia, serif; font-weight: 400; font-size: 19px;
    margin: 34px 0 4px; padding-bottom: 8px; border-bottom: 1px solid var(--line);
  }
  h2 small { color: var(--muted); font-size: 13px; font-family: -apple-system, system-ui, sans-serif; }
  .row { display: flex; gap: 14px; padding: 12px 2px; border-bottom: 1px solid var(--line); align-items: baseline; }
  .when { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; min-width: 86px; }
  .what { flex: 1; }
  .who { color: var(--muted); font-size: 13px; }
  .stamp {
    display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
    border-radius: 4px; padding: 1px 7px 2px; margin-right: 8px; vertical-align: 1px;
  }
  .stamp.would { color: var(--bg); background: var(--shadowed); }
  .stamp.info { color: var(--muted); border: 1px solid var(--line); }
  .stamp.fail { color: var(--bg); background: var(--fail); }
  .empty { color: var(--muted); padding: 16px 2px; }
  .foot { color: var(--muted); font-size: 12px; margin-top: 40px; }
  #gate { max-width: 420px; margin: 12vh auto 0; text-align: center; }
  #gate input {
    width: 100%; margin-top: 14px; padding: 10px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink); font: inherit;
  }
  #gate p { color: var(--muted); margin-top: 10px; font-size: 13px; }
  @media (prefers-reduced-motion: no-preference) {
    .row { animation: rise .25s ease both; }
    @keyframes rise { from { opacity: 0; transform: translateY(3px); } }
  }
</style>
</head>
<body>
<div class="wrap" id="app" hidden>
  <header>
    <h1>Automation Watch</h1>
    <p class="thesis">GHL is still doing the sending. This panel shows what the new system
    <b>would have done</b> — watching until the two agree.</p>
  </header>
  <div class="stats" id="stats"></div>
  <div class="controls">
    <span>Window:</span>
    <button data-hours="48" aria-pressed="true">Today + yesterday</button>
    <button data-hours="168" aria-pressed="false">7 days</button>
    <span id="updated" style="margin-left:auto"></span>
  </div>
  <h2>Activity <small id="evcount"></small></h2>
  <div id="events"></div>
  <h2>Coming up <small>next 24 hours</small></h2>
  <div id="due"></div>
  <h2>In a flow right now</h2>
  <div id="enrollments"></div>
  <h2>Failures</h2>
  <div id="failures"></div>
  <p class="foot">Read-only. Refreshes every 5 minutes. Times are Pacific.</p>
</div>
<div id="gate" hidden>
  <h1 style="font-family:Georgia,serif;font-weight:400">Automation Watch</h1>
  <input id="keyin" type="password" placeholder="Paste the dashboard key" autocomplete="off">
  <p>Stored only in this browser. Ask Claude for the key command if you need it again.</p>
</div>
<script>
(function () {
  var LS = "amari_dashboard_key";
  var hours = 48;
  var hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("k")) {
    localStorage.setItem(LS, hash.get("k"));
    history.replaceState(null, "", location.pathname);
  }
  var gate = document.getElementById("gate"), app = document.getElementById("app");

  function fmt(ts) {
    return new Date(ts).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function line(e, names) {
    var d = e.detail || {};
    var stamp = "", text = "";
    switch (e.action) {
      case "would_send": stamp = "would"; text = "send " + esc(d.template || e.flow_key || "message"); break;
      case "move": stamp = "would"; text = "move to \\u201C" + esc(d.stage) + "\\u201D (" + esc(d.pipeline) + ")"; break;
      case "would_tag": stamp = "would"; text = "add tag \\u201C" + esc(d.tag) + "\\u201D"; break;
      case "enrolled": stamp = "info"; text = "entered " + esc(e.flow_key) + " (" + esc(d.steps || "?") + " steps)"; break;
      case "exited": stamp = "info"; text = "left " + esc(e.flow_key) + " \\u2014 " + esc(d.via || "converted"); break;
      case "cancelled": stamp = "info"; text = "cancelled in " + esc(e.flow_key) + (d.cancelledSteps ? " (" + d.cancelledSteps + " pending steps stopped)" : ""); break;
      case "scheduled": stamp = "info"; text = "upgrade-offer timer set (3 days)"; break;
      case "suppressed": stamp = "info"; text = "upgrade-offer held back \\u2014 no longer eligible"; break;
      case "ingest_enriched": stamp = "info"; text = "webhook filled in from the GHL record"; break;
      case "ingest_deficient": stamp = "info"; text = "webhook arrived incomplete \\u2014 saved for review"; break;
      case "ingest_unrecognized": stamp = "info"; text = "webhook not understood \\u2014 saved for review"; break;
      case "tag_bridge_error": stamp = "fail"; text = "could not read a contact for the tag bridge"; break;
      case "send": stamp = (e.outcome === "sent" ? "info" : "fail"); text = (e.outcome === "sent" ? "sent " : "send failed \\u2014 ") + esc(d.template || ""); break;
      default: stamp = "info"; text = esc(e.action) + " \\u2192 " + esc(e.outcome);
    }
    var who = e.contact_id ? (names[e.contact_id] || e.contact_id) : "";
    return '<div class="row"><span class="when">' + fmt(e.ts) + '</span><span class="what">' +
      '<span class="stamp ' + stamp + '">' + (stamp === "would" ? "WOULD" : stamp === "fail" ? "FAILED" : "\\u2022") + "</span>" +
      text + "</span><span class=\\"who\\">" + esc(who) + "</span></div>";
  }

  function render(data) {
    var names = data.names || {};
    var el = function (id) { return document.getElementById(id); };
    var wouldCount = data.events.filter(function (e) { return String(e.outcome).indexOf("would") === 0; }).length;
    el("stats").innerHTML =
      '<div class="stat"><div class="n">' + data.events.length + '</div><div class="l">events \\u00B7 ' + data.hours + "h</div></div>" +
      '<div class="stat"><div class="n">' + wouldCount + '</div><div class="l">would-haves</div></div>' +
      '<div class="stat"><div class="n">' + data.enrollments.length + '</div><div class="l">in a flow now</div></div>' +
      '<div class="stat"><div class="n">' + data.failures.length + '</div><div class="l">failures</div></div>';
    el("evcount").textContent = data.events.length ? "" : "";
    el("events").innerHTML = data.events.length
      ? data.events.map(function (e) { return line(e, names); }).join("")
      : '<p class="empty">Quiet \\u2014 nothing in this window yet.</p>';
    el("due").innerHTML = data.dueSoon.length
      ? data.dueSoon.map(function (s) {
          return '<div class="row"><span class="when">' + fmt(s.due_at) + '</span><span class="what"><span class="stamp would">WOULD</span>send ' +
            esc(s.template || "(decided at send time)") + '</span><span class="who">' + esc(names[s.contact_id] || s.contact_id) + "</span></div>";
        }).join("")
      : '<p class="empty">Nothing scheduled in the next day.</p>';
    el("enrollments").innerHTML = data.enrollments.length
      ? data.enrollments.map(function (r) {
          return '<div class="row"><span class="when">' + esc(r.engine) + '</span><span class="what">' + esc(r.key) +
            '</span><span class="who">' + esc(names[r.contact_id] || r.contact_id) + "</span></div>";
        }).join("")
      : '<p class="empty">No one is mid-flow.</p>';
    el("failures").innerHTML = data.failures.length
      ? data.failures.map(function (e) { return line(e, names); }).join("")
      : '<p class="empty">None. That\\u2019s the point.</p>';
    el("updated").textContent = "updated " + fmt(data.generatedAt);
  }

  function load() {
    var key = localStorage.getItem(LS);
    if (!key) { gate.hidden = false; app.hidden = true; return; }
    gate.hidden = true; app.hidden = false;
    fetch("/dashboard-data?hours=" + hours, { headers: { Authorization: "Bearer " + key } })
      .then(function (r) {
        if (r.status === 401) { localStorage.removeItem(LS); load(); return null; }
        return r.json();
      })
      .then(function (data) { if (data && !data.error) render(data); })
      .catch(function () { document.getElementById("updated").textContent = "offline \\u2014 retrying"; });
  }

  document.getElementById("keyin").addEventListener("change", function (ev) {
    if (ev.target.value.trim()) { localStorage.setItem(LS, ev.target.value.trim()); load(); }
  });
  document.querySelectorAll(".controls button").forEach(function (b) {
    b.addEventListener("click", function () {
      hours = Number(b.dataset.hours);
      document.querySelectorAll(".controls button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      load();
    });
  });
  load();
  setInterval(load, 5 * 60 * 1000);
})();
</script>
</body>
</html>`;

export function handleDashboardPage() {
  return new Response(DASHBOARD_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
