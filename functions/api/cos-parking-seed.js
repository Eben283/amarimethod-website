// One-shot seeder for the SF Public Works street-sweeping schedule.
// Pulls the canonical dataset (yhqp-riqs) from DataSF, compacts each row,
// and writes the full index to KV at cos:sf-sweep-index.
//
// Auth: POST with header `X-Service-Key: ${env.COS_SERVICE_KEY}`.
//
// Idempotent — safe to re-run. Each call replaces the index.

import { writeSfSweepIndex, getSfSweepIndexMeta } from "../lib/cos-parking.js";

const DATASF_URL = "https://data.sfgov.org/resource/yhqp-riqs.json";
const PAGE_SIZE = 5000;
const MAX_PAGES = 12; // 60k row ceiling — dataset is ~30-35k

function compactRow(row) {
  return {
    s: row.corridor || "",
    l: row.limits || "",
    b: row.blockside || "",
    d: row.fullname || row.weekday || "",
    fh: row.fromhour !== undefined ? Number(row.fromhour) : null,
    th: row.tohour !== undefined ? Number(row.tohour) : null,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Auth
  const provided = request.headers.get("X-Service-Key") || "";
  if (!env.COS_SERVICE_KEY || provided !== env.COS_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const rows = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${DATASF_URL}?$limit=${PAGE_SIZE}&$offset=${page * PAGE_SIZE}`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return new Response(JSON.stringify({
        error: "datasf_fetch_failed",
        status: resp.status,
        page,
        detail: errText.slice(0, 400),
      }), { status: 422, headers: { "content-type": "application/json" } });
    }
    const batch = await resp.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const row of batch) {
      const compact = compactRow(row);
      // Skip rows missing the essentials we'd actually search on
      if (!compact.s || !compact.l) continue;
      rows.push(compact);
    }
    if (batch.length < PAGE_SIZE) break; // last page
  }

  const writeResult = await writeSfSweepIndex(env, rows);
  const meta = await getSfSweepIndexMeta(env);

  return new Response(JSON.stringify({
    ok: true,
    seeded: writeResult.count,
    duration_ms: Date.now() - startedAt,
    meta,
  }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// GET returns metadata — lets you check whether the seed is loaded
// without re-running it.
export async function onRequestGet(context) {
  const { request, env } = context;
  const provided = request.headers.get("X-Service-Key") || "";
  if (!env.COS_SERVICE_KEY || provided !== env.COS_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const meta = await getSfSweepIndexMeta(env);
  return new Response(JSON.stringify({ ok: true, meta }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
