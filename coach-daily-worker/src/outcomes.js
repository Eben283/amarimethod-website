// Cloud port of coach-outcomes.mjs.
// Pure computation — reads records + cadence from memory, writes KV.

export async function runOutcomes(env, records, cadence) {
  const byId = new Map((cadence.prospects || []).map((p) => [p.contactId, p]));

  let acted = 0, replied = 0, pending = 0, unknown = 0;
  const movers = [];

  for (const r of records) {
    const cur = byId.get(r.contactId);
    if (!cur) { unknown++; continue; }
    const genMs = Date.parse(r.generatedAt) || 0;
    const lastMs = cur.lastTouch || 0;
    if (lastMs > genMs && cur.lastDir === "in") { replied++; movers.push({ name: r.name, what: "replied" }); }
    else if (lastMs > genMs && cur.lastDir === "out") { acted++; movers.push({ name: r.name, what: "acted" }); }
    else pending++;
  }

  const summary = {
    generatedAt: new Date().toISOString().slice(0, 10),
    surfaced: records.length,
    acted, replied, pending, unknown,
    note: "acted/replied are vs the coach record's generatedAt. Money-in is the Funnel dashboard.",
    movers: movers.slice(0, 40),
  };

  await env.PORTAL_KV.put("coach:outcomes:summary", JSON.stringify(summary));
  console.error(`[outcomes] surfaced ${summary.surfaced} | acted ${acted} | replied ${replied} | pending ${pending}`);
  return summary;
}
