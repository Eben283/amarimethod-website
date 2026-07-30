// GET /ops — Amari Ops board. Click and see. No PIN / login gate.

export async function onRequestGet() {
  return new Response(OPS_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const OPS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Amari Ops</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #14100e;
    --bg2: #1f1814;
    --panel: #241c17;
    --line: #3a2f27;
    --line2: #4a3c32;
    --ink: #f4ebe1;
    --muted: #a89886;
    --faint: #6f6155;
    --accent: #e29a72;
    --accent-dim: color-mix(in srgb, var(--accent) 18%, transparent);
    --good: #7fba8a;
    --good-dim: color-mix(in srgb, var(--good) 16%, transparent);
    --bad: #e07a68;
    --bad-dim: color-mix(in srgb, var(--bad) 16%, transparent);
    --warn: #c9a45a;
    --warn-dim: color-mix(in srgb, var(--warn) 14%, transparent);
    --idle: #6a5c50;
    --serif: "Fraunces", Georgia, serif;
    --sans: "IBM Plex Sans", "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  html { color-scheme: dark; }
  body {
    min-height: 100vh;
    color: var(--ink);
    font: 15px/1.5 var(--sans);
    background:
      radial-gradient(900px 520px at 8% -8%, #3b241c 0%, transparent 55%),
      radial-gradient(700px 480px at 100% 0%, #1e2a22 0%, transparent 48%),
      radial-gradient(600px 400px at 70% 110%, #2a1c16 0%, transparent 50%),
      var(--bg);
  }
  body::before {
    content: "";
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    opacity: 0.045;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap {
    position: relative; z-index: 1;
    max-width: 760px; margin: 0 auto; padding: 36px 20px 88px;
  }

  header.brand { margin-bottom: 8px; }
  header.brand .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent);
  }
  header.brand .eyebrow .live {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--good);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--good) 55%, transparent);
  }
  header.brand .mark {
    margin-top: 10px;
    font-family: var(--serif);
    font-size: clamp(2.6rem, 8vw, 3.6rem);
    font-weight: 400;
    letter-spacing: -0.03em;
    line-height: 0.98;
  }
  header.brand .sub {
    margin-top: 12px;
    color: var(--muted);
    max-width: 38ch;
    font-size: 1.02rem;
    line-height: 1.45;
  }

  .status-bar {
    display: flex; align-items: center; gap: 14px;
    margin-top: 22px; margin-bottom: 6px;
  }
  .orb {
    position: relative;
    width: 44px; height: 44px; flex-shrink: 0;
  }
  .orb .ring {
    position: absolute; inset: 0; border-radius: 50%;
    border: 1px solid var(--line2);
  }
  .orb .core {
    position: absolute; inset: 11px; border-radius: 50%;
    background: var(--idle);
  }
  .orb.green .core { background: var(--good); box-shadow: 0 0 22px color-mix(in srgb, var(--good) 45%, transparent); }
  .orb.red .core { background: var(--bad); box-shadow: 0 0 22px color-mix(in srgb, var(--bad) 45%, transparent); }
  .orb.unknown .core { background: var(--warn); box-shadow: 0 0 18px color-mix(in srgb, var(--warn) 35%, transparent); }
  .orb.green .ring { border-color: color-mix(in srgb, var(--good) 45%, var(--line)); }
  .orb.red .ring { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
  .status-copy .kicker {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint);
  }
  .status-copy .label {
    margin-top: 2px; font-size: 1.05rem; font-weight: 500;
  }

  .banner {
    margin: 16px 0 4px; padding: 11px 14px;
    border-left: 2px solid var(--warn);
    background: linear-gradient(90deg, var(--warn-dim), transparent 85%);
    color: var(--muted); font-size: 13px;
  }

  .section-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; margin: 34px 0 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .section-head h2 {
    font-family: var(--serif); font-weight: 400; font-size: 1.35rem;
    letter-spacing: -0.01em;
  }
  .section-head small {
    font-family: var(--mono); font-size: 11px; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint);
  }

  .sys {
    display: grid; grid-template-columns: 18px 1fr auto; gap: 14px;
    align-items: center; width: 100%;
    padding: 15px 12px; margin: 0 -12px;
    border: 0; border-radius: 10px;
    background: transparent; color: inherit; font: inherit; text-align: left;
    cursor: pointer;
    transition: background .18s ease, transform .18s ease;
  }
  .sys + .sys { margin-top: 2px; }
  .sys:hover, .sys:focus-visible {
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    outline: none;
  }
  .sys:focus-visible { box-shadow: 0 0 0 1px var(--accent); }
  .sys.red {
    background: linear-gradient(90deg, var(--bad-dim), transparent 70%);
  }
  .sys .label { font-size: 1.02rem; font-weight: 500; letter-spacing: -0.01em; }
  .sys .meta { color: var(--muted); font-size: 12.5px; margin-top: 3px; line-height: 1.35; }
  .sys .state {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.1em; text-transform: uppercase;
    padding: 4px 8px; border-radius: 4px;
    color: var(--muted); background: color-mix(in srgb, var(--panel) 70%, transparent);
    border: 1px solid var(--line);
  }
  .sys .state.red { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); background: var(--bad-dim); }
  .sys .state.green { color: var(--good); border-color: color-mix(in srgb, var(--good) 35%, var(--line)); background: var(--good-dim); }
  .sys .state.unknown { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); background: var(--warn-dim); }

  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--idle);
  }
  .dot.green { background: var(--good); box-shadow: 0 0 0 3px var(--good-dim); }
  .dot.red { background: var(--bad); box-shadow: 0 0 0 3px var(--bad-dim); }
  .dot.unknown { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-dim); }

  .back {
    display: inline-flex; align-items: center; gap: 6px;
    background: none; border: 0; color: var(--muted);
    font: 500 13px/1 var(--sans); cursor: pointer; padding: 0; margin-bottom: 22px;
  }
  .back:hover { color: var(--accent); }

  .path-hero .kicker {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint);
  }
  .path-title {
    margin-top: 8px;
    font-family: var(--serif); font-size: clamp(1.8rem, 5vw, 2.35rem);
    font-weight: 400; letter-spacing: -0.02em; line-height: 1.05;
  }
  .why {
    margin: 16px 0 4px; color: var(--muted); font-size: 15px;
    max-width: 48ch; line-height: 1.5;
  }

  .incident {
    margin: 18px 0 8px; padding: 14px 16px;
    border-left: 2px solid var(--bad);
    background: linear-gradient(90deg, var(--bad-dim), transparent 90%);
    border-radius: 0 8px 8px 0;
  }
  .incident .t { font-weight: 600; letter-spacing: -0.01em; }
  .incident .p { color: var(--muted); font-size: 13px; margin-top: 5px; }

  .path-rail { position: relative; margin: 8px 0 4px; }
  .path-rail::before {
    content: "";
    position: absolute; left: 15px; top: 10px; bottom: 10px; width: 1px;
    background: linear-gradient(180deg, var(--line2), var(--line) 60%, transparent);
  }
  .hop {
    position: relative;
    display: grid; grid-template-columns: 32px 1fr; gap: 12px;
    padding: 14px 4px 14px 0;
  }
  .hop .n {
    position: relative; z-index: 1;
    width: 32px; height: 32px;
    display: grid; place-items: center;
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    color: var(--muted);
    border-radius: 50%;
    background: var(--bg2);
    border: 1px solid var(--line2);
  }
  .hop.ok .n { color: var(--good); border-color: color-mix(in srgb, var(--good) 40%, var(--line)); background: var(--good-dim); }
  .hop.red .n { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); background: var(--bad-dim); }
  .hop.skip .n { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: var(--warn-dim); }
  .hop .name { font-size: 15.5px; font-weight: 500; padding-top: 5px; }
  .hop.red .name { color: var(--bad); }
  .hop .detail { color: var(--muted); font-size: 12.5px; margin-top: 4px; line-height: 1.4; }

  .log .row {
    display: grid; grid-template-columns: 96px 1fr; gap: 14px;
    padding: 13px 2px; border-bottom: 1px solid var(--line);
    align-items: baseline;
  }
  .log .when {
    color: var(--faint); font-family: var(--mono); font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .stamp {
    display: inline-block; font-family: var(--mono);
    font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
    padding: 2px 7px; border-radius: 3px; margin-right: 8px; vertical-align: 1px;
  }
  .stamp.ok { background: var(--good); color: var(--bg); }
  .stamp.fail { background: var(--bad); color: var(--bg); }
  .stamp.skip { background: var(--warn); color: var(--bg); }
  .cond { display: block; color: var(--faint); font-size: 12px; margin-top: 5px; }
  .empty { color: var(--muted); padding: 18px 2px; }
  .foot {
    color: var(--faint); font-size: 12px; margin-top: 48px;
    font-family: var(--mono); letter-spacing: 0.04em;
  }

  [hidden] { display: none !important; }

  @media (prefers-reduced-motion: no-preference) {
    .live {
      animation: pulse 2.4s ease-out infinite;
    }
    .orb.green .ring, .orb.red .ring {
      animation: breath 2.8s ease-in-out infinite;
    }
    .sys, .hop, .log .row {
      animation: rise .38s cubic-bezier(.2,.7,.2,1) both;
    }
    .sys:nth-child(2) { animation-delay: .03s; }
    .sys:nth-child(3) { animation-delay: .06s; }
    .sys:nth-child(4) { animation-delay: .09s; }
    .sys:nth-child(5) { animation-delay: .12s; }
    .sys:nth-child(6) { animation-delay: .15s; }
    .sys:nth-child(7) { animation-delay: .18s; }
    .sys:nth-child(8) { animation-delay: .21s; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--good) 50%, transparent); }
      70% { box-shadow: 0 0 0 8px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @keyframes breath {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.08); opacity: 0.75; }
    }
  }
</style>
</head>
<body>
<div class="wrap" id="app">
  <header class="brand" id="homeHead">
    <div class="eyebrow"><span class="live"></span> Private · live</div>
    <div class="mark">Amari Ops</div>
    <p class="sub">Every watched system. Open a row to see the path and why.</p>
    <div class="status-bar">
      <div class="orb" id="overallOrb"><span class="ring"></span><span class="core"></span></div>
      <div class="status-copy">
        <div class="kicker">Board</div>
        <div class="label" id="overallLabel">Loading…</div>
      </div>
    </div>
    <div class="banner" id="homeBanner" hidden></div>
  </header>

  <div id="view-home"></div>
  <div id="view-path" hidden></div>
  <p class="foot">Alerts on flip · no Fix layer yet · Pacific time</p>
</div>

<script>
(function () {
  var homeView = document.getElementById("view-home");
  var pathView = document.getElementById("view-path");
  var homeHead = document.getElementById("homeHead");
  var homeBanner = document.getElementById("homeBanner");
  var route = parseRoute();

  function parseRoute() {
    var h = (location.hash || "").replace(/^#/, "");
    if (h.charAt(0) === "/") h = h.slice(1);
    if (h.indexOf("path/") === 0) {
      return { view: "path", pathId: decodeURIComponent(h.slice(5).split("?")[0]) };
    }
    return { view: "home" };
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function fmt(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
  }

  async function api(path) {
    var res = await fetch(path, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("load");
    return res.json();
  }

  function setOverall(status, note) {
    var orb = document.getElementById("overallOrb");
    var label = document.getElementById("overallLabel");
    orb.className = "orb " + (status || "unknown");
    label.textContent = note || status || "";
  }

  function renderLog(events, emptyMsg) {
    var html = '<div class="log">';
    if (!events || !events.length) {
      html += '<p class="empty">' + esc(emptyMsg || "No events yet.") + "</p>";
    } else {
      events.slice(0, 30).forEach(function (e) {
        var stamp = e.outcome === "ok" ? "OK" : e.outcome === "fail" ? "FAIL" : "SKIP";
        html += '<div class="row"><div class="when">' + esc(fmt(e.at)) + "</div><div>" +
          '<span class="stamp ' + esc(e.outcome === "fail" ? "fail" : e.outcome) + '">' + stamp + "</span>" +
          esc(e.summary);
        if (e.personLabel) html += ' <span style="color:var(--muted)">· ' + esc(e.personLabel) + "</span>";
        if (e.condition && (e.condition.expected || e.condition.observed)) {
          html += '<span class="cond">expected ' + esc(e.condition.expected || "—") +
            " · saw " + esc(e.condition.observed || "—") + "</span>";
        }
        html += "</div></div>";
      });
    }
    html += "</div>";
    return html;
  }

  async function renderHome() {
    homeHead.hidden = false;
    homeView.hidden = false;
    pathView.hidden = true;
    var data = await api("/api/ops/systems");
    var reds = (data.systems || []).filter(function (s) { return s.status === "red"; }).length;
    var unknowns = (data.systems || []).filter(function (s) { return s.status === "unknown"; }).length;
    setOverall(
      data.overall,
      reds ? (reds + " system" + (reds === 1 ? "" : "s") + " need attention") :
        (data.overall === "green" ? "All live signals green" :
          (unknowns ? unknowns + " waiting / unwatched" : "Checking…"))
    );

    if (!data.configured) {
      homeBanner.hidden = false;
      homeBanner.textContent = data.trail && data.trail.kv
        ? "Trail via KV for now — live worker signals below are real."
        : "Event store not bound — infra signals still load from KV.";
    } else {
      homeBanner.hidden = true;
    }

    var paths = (data.systems || []).filter(function (s) { return s.group === "paths"; });
    var messaging = (data.systems || []).filter(function (s) { return s.group === "messaging"; });
    var deps = (data.systems || []).filter(function (s) { return s.group === "infra" || (!s.group && s.kind === "dependency"); });

    function block(title, rows, hint) {
      if (!rows.length) return "";
      var html = '<div class="section-head"><h2>' + esc(title) + "</h2><small>" + esc(hint || "") + "</small></div>";
      rows.forEach(function (s) {
        html += '<button type="button" class="sys ' + esc(s.status) + '" data-path="' + esc(s.id) + '">' +
          '<span class="dot ' + esc(s.status) + '"></span>' +
          '<span><div class="label">' + esc(s.label) + "</div>" +
          '<div class="meta">' + esc(s.note || s.severity) + "</div></span>" +
          '<span class="state ' + esc(s.status) + '">' + esc(s.status) + "</span></button>";
      });
      return html;
    }

    homeView.innerHTML =
      block("Client paths", paths, "money & booking") +
      block("Messaging", messaging, "wrong-message") +
      block("Dependencies", deps, "live signals");

    homeView.querySelectorAll("[data-path]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        location.hash = "#path/" + btn.getAttribute("data-path");
      });
    });
  }

  async function renderPath(pathId) {
    homeHead.hidden = true;
    homeView.hidden = true;
    pathView.hidden = false;
    var data = await api("/api/ops/systems?pathId=" + encodeURIComponent(pathId));

    var html = '<button type="button" class="back" id="backHome">← All systems</button>';
    html += '<div class="path-hero">';
    html += '<div class="kicker">' + esc(data.severity || "system") + " · " + esc(data.status) + "</div>";
    html += '<div class="path-title">' + esc(data.label) + "</div>";
    html += '<div class="status-bar" style="margin-top:18px">';
    html += '<div class="orb ' + esc(data.status) + '"><span class="ring"></span><span class="core"></span></div>';
    html += '<div class="status-copy"><div class="kicker">Status</div><div class="label">' +
      esc(data.status) + (data.instrumentation ? " · " + esc(data.instrumentation) : "") +
      "</div></div></div>";
    if (data.note || data.why) {
      html += '<p class="why">' + esc(data.why || data.note) + "</p>";
    }
    if (data.id === "call_coach") {
      html += '<p class="why">On-demand only — no auto Whisper/LLM sweep. Staff: POST /api/staff-call-coach-run (or /coach-one per contact). Ops watches readiness, not last-run freshness.</p>';
    }
    html += "</div>";

    if (data.incidents && data.incidents.length) {
      data.incidents.slice(0, 3).forEach(function (inc) {
        html += '<div class="incident"><div class="t">' + esc(inc.title) + "</div>" +
          '<div class="p">' + esc(inc.personLabel || inc.contactId || "") +
          (inc.failedHopId ? " · hop " + esc(inc.failedHopId) : "") +
          " · " + esc(fmt(inc.openedAt)) + "</div></div>";
      });
    }

    if (data.hops && data.hops.length) {
      html += '<div class="section-head"><h2>Path</h2><small>hops in order</small></div>';
      html += '<div class="path-rail">';
      data.hops.forEach(function (h, i) {
        html += '<div class="hop ' + esc(h.state) + '"><div class="n">' + (i + 1) + "</div><div>" +
          '<div class="name">' + esc(h.label) + "</div>";
        if (h.latest) {
          html += '<div class="detail">' + esc(h.latest.summary || h.latest.outcome);
          if (h.latest.at) html += " · " + esc(fmt(h.latest.at));
          if (h.latest.condition && h.latest.condition.observed) {
            html += " · saw " + esc(h.latest.condition.observed);
          }
          html += "</div>";
        } else if (h.state === "unwatched") {
          html += '<div class="detail">not instrumented yet</div>';
        } else {
          html += '<div class="detail">no hop yet</div>';
        }
        html += "</div></div>";
      });
      html += "</div>";
    }

    html += '<div class="section-head"><h2>Log</h2><small>newest first</small></div>';
    html += renderLog(data.events, data.kind === "dependency"
      ? "No signal detail yet for this dependency."
      : "No events yet — the next Assessment purchase will write hops here.");

    if (data.relatedErrors && data.relatedErrors.length) {
      html += '<div class="section-head"><h2>Related failures</h2><small>ops:err</small></div><div class="log">';
      data.relatedErrors.forEach(function (e) {
        html += '<div class="row"><div class="when">' + esc(fmt(e.at)) + "</div><div>" +
          '<span class="stamp fail">FAIL</span>' + esc(e.summary) +
          (e.source ? ' <span style="color:var(--muted)">· ' + esc(e.source) + "</span>" : "") +
          "</div></div>";
      });
      html += "</div>";
    }

    pathView.innerHTML = html;
    document.getElementById("backHome").addEventListener("click", function () {
      location.hash = "";
    });
  }

  async function render() {
    route = parseRoute();
    try {
      if (route.view === "path") await renderPath(route.pathId);
      else await renderHome();
    } catch (e) {
      homeView.innerHTML = '<p class="empty">Could not load systems.</p>';
    }
  }

  window.addEventListener("hashchange", function () { render(); });
  render();
  setInterval(render, 60000);
})();
</script>
</body>
</html>
`;
