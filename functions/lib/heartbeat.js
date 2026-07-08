// heartbeat.js — a "did this overnight job actually run and produce output?" beat.
//
// WHY: the /day briefing was empty for ~2 months and nobody noticed. The existing
// system-health check watches known conditions (token expiry, reconcile drift),
// not each job's real OUTPUT. A job can run, throw halfway, and write nothing —
// or a local cron can silently stop firing — and no signal surfaces.
//
// A beat is the smallest honest record a job can leave: { job, ranAt, producedN,
// ok }. `producedN` is a work-volume number (funnel rows, cards produced, contacts
// audited) where 0 means "ran but produced nothing" — suspicious, flagged red.
//
// Beats live in Cloudflare KV (PORTAL_KV) — the shared surface both the website
// repo and ghl-mcp reach. NEVER a local file. WEB workers write via the native KV
// binding (writeBeat below); local/ghl-mcp jobs POST to /api/heartbeat, which
// calls writeBeat server-side. The /day aggregator reads them via GET
// /api/heartbeats and surfaces each job green / red.
//
// ACCEPTED LIMITATION (do not "fix"): because the only surface for this signal is
// /day, it cannot report that /day ITSELF failed to generate. Eben accepted this.
// It DOES catch the empty-output case (a job that ran and produced nothing shows
// red the next morning) and the missing-run case (a registered job with no beat).

const BEAT_PREFIX = "ops:beat:";
const HOUR = 3600 * 1000;

export function beatKey(job) {
  return `${BEAT_PREFIX}${job}`;
}

// The overnight jobs we expect a beat from. A registered job with NO beat in KV
// is flagged red (it should have run and left one). Add a row here when you wire
// a new job's beat. maxAgeH = how long a beat may go without a fresh run before
// it's stale; producedNoun is just for the human-readable note.
export const HEARTBEAT_JOBS = [
  { job: "funnel-refresh", label: "Funnel refresh", maxAgeH: 3, producedNoun: "rows" }, // hourly cron
  { job: "daily-audit", label: "Daily audit", maxAgeH: 26, producedNoun: "contacts audited" }, // daily 11:00 UTC
  { job: "outreach-snapshot", label: "Outreach snapshot", maxAgeH: 26, producedNoun: "cards" }, // daily local cron → upload
];

const JOBS_BY_NAME = Object.fromEntries(HEARTBEAT_JOBS.map((j) => [j.job, j]));

export function isRegisteredJob(job) {
  return Object.prototype.hasOwnProperty.call(JOBS_BY_NAME, job);
}

// Build a beat object. Kept pure (no clock read) so it's testable; writeBeat
// stamps ranAt. Exported for the POST endpoint / tests.
export function makeBeat(job, { producedN, ok = true }, ranAt) {
  return {
    job,
    ranAt: ranAt || new Date().toISOString(),
    producedN: Number.isFinite(producedN) ? producedN : 0,
    ok: ok !== false,
  };
}

// Write a beat via a native KV binding (Workers / Pages Functions). Best-effort:
// a beat write must never break the job it's reporting on, so callers should not
// let a KV hiccup here fail their real work.
export async function writeBeat(kv, job, { producedN, ok = true } = {}) {
  const beat = makeBeat(job, { producedN, ok });
  await kv.put(beatKey(job), JSON.stringify(beat));
  return beat;
}

function ageHours(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / HOUR;
}

function fmtAge(h) {
  if (h == null) return "unknown time";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Judge one job's beat. Three honest states:
//   green   — ran recently, ok, and produced > 0
//   red     — missing / errored / stale / produced nothing (a REAL problem)
//   unknown — the record was unreadable (couldn't verify, not "broken")
export function judgeBeat(cfg, rec) {
  const { job, label, maxAgeH, producedNoun } = cfg;
  if (rec === undefined) {
    // undefined = KV read threw / unparseable → can't verify.
    return { job, label, state: "unknown", note: "couldn't read beat from KV" };
  }
  if (rec === null) {
    // null = no such key → the job never wrote a beat (missing run).
    return { job, label, state: "red", note: "no beat — job hasn't run (or wrote nothing)" };
  }
  const age = ageHours(rec.ranAt);
  if (rec.ok === false) {
    return { job, label, state: "red", note: `last run reported failure (${fmtAge(age)})` };
  }
  const n = Number.isFinite(rec.producedN) ? rec.producedN : 0;
  if (n <= 0) {
    return { job, label, state: "red", note: `ran ${fmtAge(age)} but produced nothing (0 ${producedNoun})` };
  }
  if (age == null || age > maxAgeH) {
    return { job, label, state: "red", note: `stale — last ran ${fmtAge(age)} (expected < ${maxAgeH}h)` };
  }
  return { job, label, state: "green", note: `ran ${fmtAge(age)} · ${n} ${producedNoun}` };
}

// Read + judge every registered job from KV. Returns { overall, checks, generatedAt }.
// A single KV read failure for one job → that job's state is "unknown", never a
// throw that loses the whole section.
export async function readAndJudgeBeats(kv) {
  const checks = await Promise.all(
    HEARTBEAT_JOBS.map(async (cfg) => {
      let rec;
      try {
        rec = await kv.get(beatKey(cfg.job), "json"); // null if missing
      } catch {
        rec = undefined; // unreadable
      }
      return judgeBeat(cfg, rec);
    }),
  );
  const reds = checks.filter((c) => c.state === "red");
  const unknowns = checks.filter((c) => c.state === "unknown");
  const overall = reds.length ? "red" : unknowns.length ? "unknown" : "green";
  return { overall, checks, generatedAt: new Date().toISOString() };
}
