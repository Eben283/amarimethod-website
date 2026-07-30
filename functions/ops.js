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
<style>
  :root {
    --bg: #1C1712;
    --bg2: #2A221C;
    --line: #3D3229;
    --ink: #F3EBE0;
    --muted: #B6A692;
    --accent: #E8A07A;
    --good: #8FBC8F;
    --bad: #D97B6C;
    --warn: #C4A35A;
    --idle: #6E6256;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100vh;
    color: var(--ink);
    font: 15px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
    background:
      radial-gradient(1200px 600px at 10% -10%, #3a2a22 0%, transparent 55%),
      radial-gradient(900px 500px at 100% 0%, #2a3328 0%, transparent 50%),
      var(--bg);
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 18px 72px; }
  header.brand { margin-bottom: 22px; }
  header.brand .mark {
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(2rem, 5vw, 2.75rem);
    font-weight: 400;
    letter-spacing: 0.01em;
    line-height: 1.1;
  }
  header.brand .sub {
    margin-top: 8px;
    color: var(--muted);
    max-width: 46ch;
  }
  .overall {
    display: inline-flex; align-items: center; gap: 8px;
    margin-top: 16px; font-size: 13px; color: var(--muted);
  }
  .banner {
    margin: 14px 0 4px; padding: 10px 12px;
    border-left: 3px solid var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--muted); font-size: 13px;
  }
  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--idle);
  }
  .dot.green { background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 25%, transparent); }
  .dot.red { background: var(--bad); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bad) 25%, transparent); }
  .dot.unknown { background: var(--warn); }

  h2 {
    font-family: Georgia, serif; font-weight: 400; font-size: 1.15rem;
    margin: 28px 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line);
  }
  h2 small { color: var(--muted); font-size: 12px; font-family: inherit; margin-left: 8px; }

  .sys {
    display: grid; grid-template-columns: 14px 1fr auto; gap: 12px;
    align-items: center; width: 100%;
    padding: 14px 4px; border-bottom: 1px solid var(--line);
    background: none; border-left: 0; border-right: 0; border-top: 0;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .sys:hover, .sys:focus-visible { background: color-mix(in srgb, var(--bg2) 80%, transparent); outline: none; }
  .sys .label { font-size: 16px; }
  .sys .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .sys .state {
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--muted);
  }
  .sys .state.red { color: var(--bad); }
  .sys .state.green { color: var(--good); }
  .sys .state.unknown { color: var(--warn); }

  .back {
    background: none; border: 0; color: var(--muted); font: inherit;
    cursor: pointer; padding: 0; margin-bottom: 18px;
  }
  .back:hover { color: var(--accent); }

  .path-title {
    font-family: Georgia, serif; font-size: 1.6rem; font-weight: 400;
  }
  .why {
    margin: 14px 0 8px; color: var(--muted); font-size: 14px; max-width: 52ch;
  }
  .incident {
    margin: 14px 0 10px; padding: 12px 14px;
    border-left: 3px solid var(--bad);
    background: color-mix(in srgb, var(--bad) 10%, transparent);
  }
  .incident .t { font-weight: 600; }
  .incident .p { color: var(--muted); font-size: 13px; margin-top: 4px; }

  .hop {
    display: grid; grid-template-columns: 28px 1fr; gap: 10px;
    padding: 10px 2px; border-bottom: 1px solid var(--line);
  }
  .hop .n {
    font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; padding-top: 3px;
  }
  .hop .name { font-size: 15px; }
  .hop .detail { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .hop.red .name { color: var(--bad); }
  .hop.ok .mark { color: var(--good); }
  .hop.red .mark { color: var(--bad); }
  .hop.skip .mark { color: var(--warn); }
  .hop .mark { font-size: 12px; margin-right: 6px; }

  .log .row {
    display: grid; grid-template-columns: 92px 1fr; gap: 12px;
    padding: 11px 2px; border-bottom: 1px solid var(--line);
    align-items: baseline;
  }
  .log .when { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .stamp {
    display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
    padding: 1px 6px; border-radius: 3px; margin-right: 7px; vertical-align: 1px;
  }
  .stamp.ok { background: var(--good); color: var(--bg); }
  .stamp.fail { background: var(--bad); color: var(--bg); }
  .stamp.skip { background: var(--warn); color: var(--bg); }
  .cond { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
  .empty { color: var(--muted); padding: 16px 2px; }
  .foot { color: var(--muted); font-size: 12px; margin-top: 36px; }

  [hidden] { display: none !important; }

  @media (prefers-reduced-motion: no-preference) {
    .sys, .hop, .log .row { animation: rise .28s ease both; }
    @keyframes rise { from { opacity: 0; transform: translateY(4px); } }
  }
</style>
</head>
<body>
<div class="wrap" id="app">
  <header class="brand" id="homeHead">
    <div class="mark">Amari Ops</div>
    <p class="sub">Watched systems. Open anything to see the path and why.</p>
    <div class="overall"><span class="dot" id="overallDot"></span><span id="overallLabel">Loading…</span></div>
    <div class="banner" id="homeBanner" hidden></div>
  </header>

  <div id="view-home"></div>
  <div id="view-path" hidden></div>
  <p class="foot">Alerts on flip · no Fix layer yet</p>
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
    var dot = document.getElementById("overallDot");
    var label = document.getElementById("overallLabel");
    dot.className = "dot " + (status || "unknown");
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
      reds ? (reds + " red") :
        (data.overall === "green" ? "All live signals green" :
          (unknowns ? unknowns + " unwatched / waiting" : "Checking…"))
    );

    if (!data.configured) {
      homeBanner.hidden = false;
      homeBanner.textContent = data.trail && data.trail.kv
        ? "Trail via KV (Pages D1 not bound yet). Live worker signals below are real."
        : "Event store not bound — infra signals still load from KV.";
    } else {
      homeBanner.hidden = true;
    }

    var paths = (data.systems || []).filter(function (s) { return (s.group || s.kind) === "paths" || (s.kind === "path" && s.group !== "messaging"); });
    var messaging = (data.systems || []).filter(function (s) { return s.group === "messaging"; });
    var deps = (data.systems || []).filter(function (s) { return s.group === "infra" || (s.kind === "dependency" && s.group !== "messaging"); });

    function block(title, rows, hint) {
      if (!rows.length) return "";
      var html = "<h2>" + esc(title) + (hint ? "<small>" + esc(hint) + "</small>" : "") + "</h2>";
      rows.forEach(function (s) {
        html += '<button type="button" class="sys" data-path="' + esc(s.id) + '">' +
          '<span class="dot ' + esc(s.status) + '"></span>' +
          '<span><div class="label">' + esc(s.label) + "</div>" +
          '<div class="meta">' + esc(s.note || s.severity) + "</div></span>" +
          '<span class="state ' + esc(s.status) + '">' + esc(s.status) + "</span></button>";
      });
      return html;
    }

    homeView.innerHTML =
      block("Client paths", paths, "money & booking") +
      block("Messaging", messaging, "wrong-message watch") +
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
    html += '<div class="path-title">' + esc(data.label) + "</div>";
    html += '<div class="overall" style="margin-top:10px"><span class="dot ' + esc(data.status) + '"></span>' +
      '<span>' + esc(data.status) + " · " + esc(data.severity) + "</span></div>";
    if (data.note || data.why) {
      html += '<p class="why">' + esc(data.why || data.note) + "</p>";
    }

    if (data.incidents && data.incidents.length) {
      data.incidents.slice(0, 3).forEach(function (inc) {
        html += '<div class="incident"><div class="t">' + esc(inc.title) + "</div>" +
          '<div class="p">' + esc(inc.personLabel || inc.contactId || "") +
          (inc.failedHopId ? " · hop " + esc(inc.failedHopId) : "") +
          " · " + esc(fmt(inc.openedAt)) + "</div></div>";
      });
    }

    if (data.hops && data.hops.length) {
      html += "<h2>Path</h2>";
      data.hops.forEach(function (h, i) {
        var mark = h.state === "ok" ? "●" : h.state === "red" ? "!" : h.state === "skip" ? "–" : "○";
        html += '<div class="hop ' + esc(h.state) + '"><div class="n">' + (i + 1) + "</div><div>" +
          '<div class="name"><span class="mark">' + mark + "</span>" + esc(h.label) + "</div>";
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
    }

    html += '<h2>Log <small>newest first</small></h2>';
    html += renderLog(data.events, data.kind === "dependency"
      ? "No signal detail yet for this dependency."
      : "No events yet — the next Assessment purchase will write hops here.");

    if (data.relatedErrors && data.relatedErrors.length) {
      html += "<h2>Related failures <small>ops:err</small></h2><div class='log'>";
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
