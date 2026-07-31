// GET /ops — Amari Ops board. Click and see. No PIN / login gate.
import { OPS_SURFACE_NAV_CSS, opsEmbedBootScript, opsSurfaceNavHtml } from "./lib/ops-surface-nav.js";

export async function onRequestGet() {
  const html = OPS_HTML
    .replace("/*__OPS_SURFACE_NAV_CSS__*/", OPS_SURFACE_NAV_CSS)
    .replace("__OPS_SURFACE_NAV__", opsSurfaceNavHtml("systems"))
    .replace("__OPS_EMBED_BOOT__", opsEmbedBootScript());
  return new Response(html, {
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
  /*
    Color theory — cool split-complementary ops board
    Dominant: slate-blue field (calm scan surface)
    Accent: teal (analogous “watching / healthy”)
    Alerts: coral (sick) + amber (stuck) — warm complements against cool base
    Not brown, not cream/terracotta, not purple
  */
  :root {
    --bg: #eef2f6;
    --bg2: #e4ebf2;
    --panel: #f7fafc;
    --line: #c9d4e0;
    --line2: #aebccb;
    --ink: #122033;
    --muted: #4a5d73;
    --faint: #7a8ea3;
    --accent: #0b7f86;
    --accent-dim: color-mix(in srgb, var(--accent) 12%, transparent);
    --good: #1a8f6a;
    --good-dim: color-mix(in srgb, var(--good) 12%, transparent);
    --bad: #d64545;
    --bad-dim: color-mix(in srgb, var(--bad) 12%, transparent);
    --warn: #c47a14;
    --warn-dim: color-mix(in srgb, var(--warn) 14%, transparent);
    --idle: #8a9bb0;
    --on-bright: #ffffff;
    --serif: "Fraunces", Georgia, serif;
    --sans: "IBM Plex Sans", "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  html { color-scheme: light; }
  body {
    min-height: 100vh;
    color: var(--ink);
    font: 15px/1.5 var(--sans);
    background:
      radial-gradient(900px 520px at 6% -10%, #c8e8ea 0%, transparent 55%),
      radial-gradient(720px 480px at 100% 0%, #d5e2f4 0%, transparent 50%),
      radial-gradient(640px 420px at 70% 110%, #dce8ef 0%, transparent 52%),
      linear-gradient(180deg, #f5f8fb 0%, var(--bg) 40%, #e8eef5 100%);
  }
  body::before {
    content: "";
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap {
    position: relative; z-index: 1;
    max-width: 760px; margin: 0 auto; padding: 36px 20px 88px;
  }

  .top-nav {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-bottom: 22px;
  }
  .home-link {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--muted); text-decoration: none;
    font: 500 13px/1 var(--sans);
  }
  .home-link:hover { color: var(--accent); }

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
  .orb.green .core, .orb.healthy .core, .orb.map_ok .core { background: var(--good); }
  .orb.red .core, .orb.sick .core { background: var(--bad); }
  .orb.stuck .core, .orb.unknown .core { background: var(--warn); }
  .orb.idle .core, .orb.blind .core { background: var(--idle); }
  .orb.green .ring, .orb.healthy .ring, .orb.map_ok .ring { border-color: color-mix(in srgb, var(--good) 55%, var(--line)); }
  .orb.red .ring, .orb.sick .ring { border-color: color-mix(in srgb, var(--bad) 55%, var(--line)); }
  .orb.stuck .ring { border-color: color-mix(in srgb, var(--warn) 55%, var(--line)); }
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
  .sys.red, .sys.sick, .sys.stuck, .sys.map_bad {
    background: linear-gradient(90deg, var(--bad-dim), transparent 70%);
  }
  .sys.stuck {
    background: linear-gradient(90deg, var(--warn-dim), transparent 70%);
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
  .sys .state.red, .sys .state.sick { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); background: var(--bad-dim); }
  .sys .state.stuck { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: var(--warn-dim); }
  .sys .state.green, .sys .state.healthy, .sys .state.map_ok { color: var(--good); border-color: color-mix(in srgb, var(--good) 35%, var(--line)); background: var(--good-dim); }
  .sys .state.unknown, .sys .state.idle, .sys .state.blind { color: var(--faint); border-color: var(--line); background: transparent; }

  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--idle);
  }
  .dot.green, .dot.healthy, .dot.map_ok { background: var(--good); box-shadow: 0 0 0 3px var(--good-dim); }
  .dot.red, .dot.sick, .dot.map_bad { background: var(--bad); box-shadow: 0 0 0 3px var(--bad-dim); }
  .dot.stuck { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-dim); }
  .dot.unknown, .dot.idle, .dot.blind { background: var(--idle); }

  .hot-strip {
    margin-top: 22px; padding: 16px 16px 14px;
    border: 1px solid var(--line2); border-radius: 12px;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--panel)), var(--panel) 55%, transparent);
  }
  .hot-strip .hs-title {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint);
  }
  .hot-strip .hs-head {
    margin-top: 8px; font-family: var(--serif); font-size: 1.35rem;
    letter-spacing: -0.02em; line-height: 1.15;
  }
  .hot-strip.stuck .hs-head { color: var(--warn); }
  .hot-strip.sick .hs-head { color: var(--bad); }
  .hot-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .hot-pill {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase;
    padding: 5px 9px; border-radius: 4px; border: 1px solid var(--line);
    color: var(--muted);
  }
  .hot-pill.ok { color: var(--good); border-color: color-mix(in srgb, var(--good) 35%, var(--line)); }
  .hot-pill.fail { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
  .hot-pill.stuck { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
  .hot-people { margin-top: 12px; }
  .hot-people button {
    display: block; width: 100%; text-align: left;
    background: none; border: 0; color: var(--ink); font: inherit;
    padding: 8px 0; cursor: pointer; border-top: 1px solid var(--line);
  }
  .hot-people button .p { font-weight: 500; }
  .hot-people button .d { color: var(--muted); font-size: 12.5px; margin-top: 2px; }

  .person-card {
    margin: 18px 0; padding: 16px;
    border: 1px solid var(--line2); border-radius: 12px;
    background: color-mix(in srgb, var(--panel) 92%, #ffffff);
  }
  .person-card .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .pill {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase;
    padding: 4px 8px; border-radius: 4px; border: 1px solid var(--line);
    color: var(--muted);
  }
  .pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); background: var(--bad-dim); }
  .pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: var(--warn-dim); }
  .hop-row {
    display: grid; grid-template-columns: 56px 1fr; gap: 10px;
    padding: 10px 0; border-bottom: 1px solid var(--line);
  }
  .hop-row .mark {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); padding-top: 3px;
  }
  .hop-row.ok .mark { color: var(--good); }
  .hop-row.fail .mark { color: var(--bad); }
  .hop-row.stuck .mark, .hop-row.pending .mark, .hop-row.skip .mark { color: var(--warn); }
  .hop-row .name { font-weight: 500; }
  .hop-row .detail { color: var(--muted); font-size: 12.5px; margin-top: 3px; line-height: 1.4; }
  .change-box {
    margin-top: 14px; padding: 12px 14px;
    border-left: 2px solid var(--accent);
    background: linear-gradient(90deg, var(--accent-dim), transparent 90%);
  }
  .change-box .t { font-weight: 600; margin-bottom: 4px; }
  .change-box .d { color: var(--muted); font-size: 13px; line-height: 1.45; }

  .fix-box {
    margin: 18px 0 8px; padding: 14px 16px;
    border-left: 2px solid var(--accent);
    background: linear-gradient(90deg, var(--accent-dim), transparent 92%);
    border-radius: 0 8px 8px 0;
  }
  .fix-box .t { font-weight: 600; letter-spacing: -0.01em; }
  .fix-box .d { color: var(--muted); font-size: 13px; margin-top: 6px; line-height: 1.45; }
  .fix-box .meta {
    margin-top: 8px; font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.04em; color: var(--faint);
  }
  .fix-box a { color: var(--accent); text-decoration: none; }
  .fix-box a:hover { text-decoration: underline; }
  .fix-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
  .fix-btn {
    font: 600 13px/1 var(--sans); color: var(--on-bright);
    background: var(--accent); border: 0; border-radius: 6px;
    padding: 10px 14px; cursor: pointer;
  }
  .fix-btn:hover { filter: brightness(1.06); }
  .fix-btn:disabled { opacity: 0.55; cursor: default; filter: none; }
  .fix-btn.ghost {
    background: transparent; color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
  }
  .fix-msg { font-size: 13px; color: var(--muted); }
  .fix-msg.err { color: var(--bad); }
  .sys .fix-chip {
    display: inline-block; margin-left: 6px;
    font-family: var(--mono); font-size: 9.5px; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--accent); vertical-align: 1px;
  }

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
  .hop.red .n, .hop.fail .n, .hop.stuck .n { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); background: var(--bad-dim); }
  .hop.stuck .n { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); background: var(--warn-dim); }
  .hop.skip .n, .hop.pending .n { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: var(--warn-dim); }
  .hop .name { font-size: 15.5px; font-weight: 500; padding-top: 5px; }
  .hop.red .name, .hop.fail .name, .hop.stuck .name { color: var(--bad); }
  .hop.stuck .name { color: var(--warn); }
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
  .stamp.ok { background: var(--good); color: var(--on-bright); }
  .stamp.fail { background: var(--bad); color: var(--on-bright); }
  .stamp.skip { background: var(--warn); color: var(--on-bright); }
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
    .orb.green .ring, .orb.red .ring, .orb.sick .ring, .orb.healthy .ring {
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
  /*__OPS_SURFACE_NAV_CSS__*/
</style>
</head>
<body>
<script>__OPS_EMBED_BOOT__</script>
<div class="wrap" id="app">
  __OPS_SURFACE_NAV__
  <nav class="top-nav ops-embed-hide" aria-label="Ops">
    <a class="home-link" href="/staff">← Staff home</a>
  </nav>
  <header class="brand" id="homeHead">
    <div class="eyebrow"><span class="live"></span> Private · live</div>
    <div class="mark">Amari Ops</div>
    <p class="sub">Hot paths first. Open a person for site → automation → why → change.</p>
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
  <p class="foot" id="opsFoot">Alerts on flip · Fix layer · Pacific time</p>
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
    if (h.indexOf("person/") === 0) {
      var pq = h.indexOf("?");
      var ppath = pq >= 0 ? h.slice(0, pq) : h;
      var pquery = pq >= 0 ? h.slice(pq + 1) : "";
      var prest = ppath.slice(7);
      var pparts = prest.split("/").filter(Boolean);
      var kind = /(?:^|&)k=corr(?:&|$)/.test(pquery) ? "corr" : "contact";
      return {
        view: "person",
        pathId: decodeURIComponent(pparts[0] || ""),
        personKey: pparts[1] ? decodeURIComponent(pparts[1]) : "",
        personKind: kind,
      };
    }
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

  function rowState(s) {
    return String((s && (s.state || s.status)) || "idle").toLowerCase();
  }

  function stateLabel(st) {
    var map = {
      healthy: "healthy", sick: "sick", stuck: "stuck", idle: "idle", blind: "blind",
      map_ok: "map ok", map_bad: "map bad",
      green: "ok", red: "red", unknown: "idle"
    };
    return map[st] || st;
  }

  function setOverall(status, note) {
    var orb = document.getElementById("overallOrb");
    var label = document.getElementById("overallLabel");
    orb.className = "orb " + (status || "idle");
    label.textContent = note || status || "";
  }

  function changeSurfaceHtml(cs) {
    if (!cs || !cs.touch) return "";
    var blast = Array.isArray(cs.blastRadius) ? cs.blastRadius : [];
    return (
      '<div class="change-box">' +
        '<div class="t">Change surface</div>' +
        '<div class="d">' + esc(cs.touch) + '</div>' +
        (blast.length
          ? '<div class="d" style="margin-top:6px">Blast radius: ' + blast.map(function (b) { return esc(b); }).join(" · ") + "</div>"
          : "") +
        (cs.talkHint ? '<div class="d" style="margin-top:6px">' + esc(cs.talkHint) + "</div>" : "") +
      "</div>"
    );
  }

  function fixStatusLabel(job) {
    if (!job) return "";
    var st = String(job.status || "");
    if (st === "shadow") return "shadow · would launch";
    if (st === "launching") return "launching agent…";
    if (st === "launched" || st === "running") return "agent launched";
    if (st === "error") return "fixer error";
    return st;
  }

  function fixPanelHtml(data) {
    if (!data || !data.autoFix) return "";
    var job = data.fix || null;
    var mode = data.fixMode || "";
    var html = '<div class="fix-box" id="fixPanel">';
    html += '<div class="t">Fixer</div>';
    if (job) {
      html += '<div class="d">' + esc(fixStatusLabel(job));
      if (job.note) html += " — " + esc(job.note);
      html += "</div>";
      if (job.agentUrl) {
        html += '<div class="d"><a href="' + esc(job.agentUrl) + '" target="_blank" rel="noopener">Open agent</a></div>';
      }
      if (job.error) html += '<div class="d" style="color:var(--bad)">' + esc(job.error) + "</div>";
      if (job.launchedAt) {
        html += '<div class="meta">' + esc(fmt(job.launchedAt));
        if (job.mode) html += " · mode " + esc(job.mode);
        html += "</div>";
      }
    } else {
      html += '<div class="d">Queues a bounded Cursor agent (change surface only). Cron picks it up within ~15m.</div>';
      if (mode) html += '<div class="meta">Board mode: ' + esc(mode) + "</div>";
    }
    html += '<div class="fix-actions">';
    html += '<button type="button" class="fix-btn" id="requestFix"' +
      (job && (job.status === "launching" || job.status === "launched" || job.status === "running") ? " disabled" : "") +
      ">Request fix</button>";
    html += '<span class="fix-msg" id="fixMsg"></span>';
    html += "</div></div>";
    return html;
  }

  async function requestFix(pathId) {
    var btn = document.getElementById("requestFix");
    var msg = document.getElementById("fixMsg");
    if (btn) btn.disabled = true;
    if (msg) { msg.className = "fix-msg"; msg.textContent = "Queuing…"; }
    try {
      var res = await fetch("/api/ops/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "request", pathId: pathId }),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok || !body.queued) {
        var reason = body.reason || body.error || "failed";
        if (reason === "already-running") {
          if (msg) msg.textContent = "Already in flight — see agent above.";
        } else if (reason === "not-fixable") {
          if (msg) { msg.className = "fix-msg err"; msg.textContent = "This path is not auto-fixable."; }
        } else {
          if (msg) { msg.className = "fix-msg err"; msg.textContent = String(reason); }
        }
        if (btn && reason !== "already-running") btn.disabled = false;
        return;
      }
      if (msg) msg.textContent = "Queued — fixer will pick this up on the next sweep.";
    } catch (e) {
      if (msg) { msg.className = "fix-msg err"; msg.textContent = "Could not queue."; }
      if (btn) btn.disabled = false;
    }
  }

  function hopMark(status) {
    if (status === "ok") return "ok";
    if (status === "fail") return "fail";
    if (status === "stuck") return "stuck";
    if (status === "pending") return "next";
    if (status === "skip") return "skip";
    return "—";
  }

  function renderPersonHops(list) {
    if (!list || !list.length) return '<p class="empty">No hops in this trail.</p>';
    return list.map(function (h) {
      var st = String(h.status || "idle");
      return (
        '<div class="hop-row ' + esc(st) + '">' +
          '<div class="mark">' + esc(hopMark(st)) + "</div>" +
          "<div>" +
            '<div class="name">' + esc(h.label || h.hopId) + "</div>" +
            (h.detail || h.at
              ? '<div class="detail">' + esc(h.detail || "") +
                (h.at ? (h.detail ? " · " : "") + esc(fmt(h.at)) : "") +
                "</div>"
              : "") +
          "</div>" +
        "</div>"
      );
    }).join("");
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
    var attention = Number(data.attentionCount || 0);
    var overallNote = attention
      ? attention + " path" + (attention === 1 ? "" : "s") + " need attention"
      : (data.overall === "green" ? "Hot paths quiet" : "Watching…");
    setOverall(attention ? "sick" : (data.overall || "idle"), overallNote);
    var foot = document.getElementById("opsFoot");
    if (foot) {
      var fm = data.fixMode || "shadow";
      foot.textContent = "Alerts on flip · Fix " + fm + " · Pacific time";
    }

    if (!data.configured) {
      homeBanner.hidden = false;
      homeBanner.textContent = data.trail && data.trail.kv
        ? "Trail via KV for now — live worker signals below are real."
        : "Event store not bound — infra signals still load from KV.";
    } else {
      homeBanner.hidden = true;
    }

    var hot = data.hotStrip || null;
    var hotHtml = "";
    if (hot) {
      hotHtml =
        '<div class="hot-strip ' + esc(hot.tone || "") + '">' +
          '<div class="hs-title">Hot · pay → book → confirm</div>' +
          '<div class="hs-head">' + esc(hot.headline || "") + "</div>" +
          '<div class="hot-pills">' +
            '<span class="hot-pill ' + esc(hot.checkout || "idle") + '">checkout ' + esc(hot.checkout || "idle") + "</span>" +
            '<span class="hot-pill ' + esc(hot.payment || "idle") + '">payment ' + esc(hot.payment || "idle") + "</span>" +
            '<span class="hot-pill ' + esc(hot.paidToBook || "idle") + '">paid→book ' + esc(hot.paidToBook || "idle") + "</span>" +
          "</div>";
      if (hot.people && hot.people.length) {
        hotHtml += '<div class="hot-people">';
        hot.people.forEach(function (p) {
          var kind = p.contactId ? "contact" : (p.correlationId ? "corr" : "");
          var key = p.contactId || p.correlationId || "";
          if (!key || !p.pathId || !kind) return;
          hotHtml +=
            '<button type="button" data-person-path="' + esc(p.pathId) + '" data-person-id="' + esc(key) + '" data-person-kind="' + kind + '">' +
              '<div class="p">' + esc(p.personLabel || key) + "</div>" +
              '<div class="d">' + esc(p.title || "") + "</div>" +
            "</button>";
        });
        hotHtml += "</div>";
      }
      hotHtml += "</div>";
    }

    var paths = (data.systems || []).filter(function (s) { return s.group === "paths"; });
    var messaging = (data.systems || []).filter(function (s) { return s.group === "messaging"; });
    var deps = (data.systems || []).filter(function (s) { return s.group === "infra" || (!s.group && s.kind === "dependency"); });

    function block(title, rows, hint) {
      if (!rows.length) return "";
      var html = '<div class="section-head"><h2>' + esc(title) + "</h2><small>" + esc(hint || "") + "</small></div>";
      rows.forEach(function (s) {
        var st = rowState(s);
        var fixChip = s.fix
          ? '<span class="fix-chip">' + esc(fixStatusLabel(s.fix)) + "</span>"
          : "";
        html += '<button type="button" class="sys ' + esc(st) + '" data-path="' + esc(s.id) + '">' +
          '<span class="dot ' + esc(st) + '"></span>' +
          '<span><div class="label">' + esc(s.label) + fixChip + "</div>" +
          '<div class="meta">' + esc(s.note || s.severity || "") + "</div></span>" +
          '<span class="state ' + esc(st) + '">' + esc(stateLabel(st)) + "</span></button>";
      });
      return html;
    }

    homeView.innerHTML =
      hotHtml +
      block("Client paths", paths, "money & booking") +
      block("Messaging", messaging, "quiet unless collision") +
      block("Dependencies", deps, "blast-radius map");

    homeView.querySelectorAll("[data-path]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        location.hash = "#path/" + btn.getAttribute("data-path");
      });
    });
    homeView.querySelectorAll("[data-person-path]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-person-kind") || "contact";
        location.hash = "#person/" + encodeURIComponent(btn.getAttribute("data-person-path")) +
          "/" + encodeURIComponent(btn.getAttribute("data-person-id")) +
          (kind === "corr" ? "?k=corr" : "");
      });
    });
  }

  async function renderPath(pathId) {
    homeHead.hidden = true;
    homeView.hidden = true;
    pathView.hidden = false;
    var data = await api("/api/ops/systems?pathId=" + encodeURIComponent(pathId));
    var st = rowState(data);

    var html = '<button type="button" class="back" id="backHome">← All systems</button>';
    html += '<div class="path-hero">';
    html += '<div class="kicker">' + esc(data.severity || "system") + " · " + esc(stateLabel(st));
    if (data.boardRole) html += " · " + esc(data.boardRole);
    html += "</div>";
    html += '<div class="path-title">' + esc(data.label) + "</div>";
    html += '<div class="status-bar" style="margin-top:18px">';
    html += '<div class="orb ' + esc(st) + '"><span class="ring"></span><span class="core"></span></div>';
    html += '<div class="status-copy"><div class="kicker">Status</div><div class="label">' +
      esc(stateLabel(st)) + (data.instrumentation ? " · " + esc(data.instrumentation) : "") +
      "</div></div></div>";
    if (data.note || data.why) {
      html += '<p class="why">' + esc(data.why || data.note) + "</p>";
    }
    if (data.id === "call_coach") {
      html += '<p class="why">On-demand only — no auto Whisper/LLM sweep. Staff: POST /api/staff-call-coach-run (or /coach-one per contact). Ops watches readiness, not last-run freshness.</p>';
    }
    html += changeSurfaceHtml(data.changeSurface);
    html += fixPanelHtml(data);
    html += "</div>";

    if (data.incidents && data.incidents.length) {
      data.incidents.slice(0, 3).forEach(function (inc) {
        html += '<div class="incident"><div class="t">' + esc(inc.title) + "</div>" +
          '<div class="p">' + esc(inc.personLabel || inc.contactId || "") +
          (inc.failedHopId ? " · hop " + esc(inc.failedHopId) : "") +
          " · " + esc(fmt(inc.openedAt)) + "</div></div>";
      });
    }

    if (data.people && data.people.length) {
      html += '<div class="section-head"><h2>People</h2><small>open a timeline</small></div>';
      html += '<div class="hot-people">';
      data.people.forEach(function (p) {
        var kind = p.contactId ? "contact" : (p.correlationId ? "corr" : "");
        var key = p.contactId || p.correlationId;
        if (!key || !kind) return;
        html +=
          '<button type="button" data-person-id="' + esc(key) + '" data-person-kind="' + kind + '">' +
            '<div class="p">' + esc(p.personLabel || key) +
            (p.pill ? ' <span class="pill ' + (p.pill.indexOf("stuck") >= 0 || p.pill === "fail" || p.pill === "collision" ? "bad" : "") + '">' + esc(p.pill) + "</span>" : "") +
            "</div>" +
            '<div class="d">' + esc(p.title || "") + (p.openedAt ? " · " + esc(fmt(p.openedAt)) : "") + "</div>" +
          "</button>";
      });
      html += "</div>";
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
    var fixBtn = document.getElementById("requestFix");
    if (fixBtn) {
      fixBtn.addEventListener("click", function () { requestFix(pathId); });
    }
    pathView.querySelectorAll("[data-person-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-person-kind") || "contact";
        location.hash = "#person/" + encodeURIComponent(pathId) + "/" +
          encodeURIComponent(btn.getAttribute("data-person-id")) +
          (kind === "corr" ? "?k=corr" : "");
      });
    });
  }

  async function renderPerson(pathId, personKey, personKind) {
    homeHead.hidden = true;
    homeView.hidden = true;
    pathView.hidden = false;
    var param = personKind === "corr" ? "correlationId" : "contactId";
    var qs = "pathId=" + encodeURIComponent(pathId) + "&" + param + "=" + encodeURIComponent(personKey);
    var data = await api("/api/ops/systems?" + qs);

    var html = '<button type="button" class="back" id="backPath">← ' + esc(data.pathLabel || "Path") + "</button>";
    html += '<div class="person-card">';
    html += '<div class="pills">';
    if (data.pill) {
      var pillTone = data.pill === "ok" ? "" : (data.pill.indexOf("stuck") >= 0 || data.pill === "fail" || data.pill === "collision" ? "bad" : "warn");
      html += '<span class="pill ' + pillTone + '">' + esc(data.pill) + "</span>";
    }
    html += '<span class="pill">' + esc(data.pathLabel || pathId) + "</span>";
    html += "</div>";
    html += '<div class="path-title" style="font-size:1.7rem">' + esc(data.personLabel || personKey || "Person") + "</div>";
    if (data.contactId) {
      html += '<p class="why" style="margin-top:8px">' + esc(data.contactId) + "</p>";
    }

    html += '<div class="section-head" style="margin-top:22px"><h2>Site</h2><small>what they did</small></div>';
    html += renderPersonHops(data.site);

    html += '<div class="section-head"><h2>Automation</h2><small>what fired</small></div>';
    html += renderPersonHops(data.automation);

    if (data.why) {
      html += '<div class="section-head"><h2>Why</h2><small>this matters</small></div>';
      html += '<p class="why">' + esc(data.why) + "</p>";
    }
    if (data.nextIfUnchanged) {
      html += '<div class="section-head"><h2>If nothing changes</h2><small>next</small></div>';
      html += '<p class="why">' + esc(data.nextIfUnchanged) + "</p>";
    }
    html += changeSurfaceHtml(data.changeSurface);
    html += "</div>";

    pathView.innerHTML = html;
    document.getElementById("backPath").addEventListener("click", function () {
      location.hash = "#path/" + encodeURIComponent(pathId);
    });
  }

  async function render() {
    route = parseRoute();
    try {
      if (route.view === "person") await renderPerson(route.pathId, route.personKey, route.personKind);
      else if (route.view === "path") await renderPath(route.pathId);
      else await renderHome();
    } catch (e) {
      homeHead.hidden = false;
      homeView.hidden = false;
      pathView.hidden = true;
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
