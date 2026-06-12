import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, ChevronDown, Trophy, X, User, Check } from 'lucide-react';
import { getFunnel, ApiError, type FunnelData } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// FUNNEL — leads pour in the top, money drops out the bottom.
// Goal: 8 eight-packs/month (64 sessions). Snapshot ships raw events; slice here.

type RangeUnit = 'day' | 'week' | 'month' | 'quarter';
interface Range { unit: RangeUnit; offset: number }
const GOAL_PACKS: Record<RangeUnit, number> = { day: 0, week: 2, month: 8, quarter: 24 };

// Realistic per-MONTH targets to land 8 packs, derived from the deduped 2026-06
// conversion chain: calls→talked 13% · talked→booked 58% · booked→showed 43% ·
// showed→buy ~80%  ⇒  ~300 calls → 40 talks → 23 booked → 10 showed → 8 packs.
const MONTHLY_TARGET = { calls: 300, talk: 40, booked: 23, showed: 10, sales: 8 };
const WORKDAYS_MO = 21;
const workdays = (calDays: number) => Math.max(1, Math.round((calDays * 5) / 7));

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const M3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const COL = {
  bg: '#FBF6EE', card: '#FFFFFF', ink: '#2C2738', inkSoft: '#8B8194', line: '#ECE3D8',
  plum: '#3A2A44', maroon: '#9B3B66', rust: '#C9805A', ember: '#EBA584',
  gold: '#E8B84B', goldDeep: '#CE9A2E', green: '#5C8A6A',
};

const toStr = (d: Date) => d.toLocaleDateString('en-CA');
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function rangeBounds({ unit, offset }: Range): { start: Date; end: Date; label: string } {
  const now = new Date();
  if (unit === 'day') {
    const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), offset);
    return { start, end: addDays(start, 1), label: `${DOW[start.getDay()]}, ${M3[start.getMonth()]} ${start.getDate()}` };
  }
  if (unit === 'week') {
    const dow = (now.getDay() + 6) % 7;
    const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow), offset * 7);
    const end = addDays(start, 7); const last = addDays(end, -1);
    const label = start.getMonth() === last.getMonth()
      ? `${M3[start.getMonth()]} ${start.getDate()}–${last.getDate()}`
      : `${M3[start.getMonth()]} ${start.getDate()} – ${M3[last.getMonth()]} ${last.getDate()}`;
    return { start, end, label };
  }
  if (unit === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1), label: `${MONTHS[start.getMonth()]} ${start.getFullYear()}` };
  }
  const q = Math.floor(now.getMonth() / 3) + offset;
  const start = new Date(now.getFullYear(), q * 3, 1);
  return { start, end: new Date(start.getFullYear(), start.getMonth() + 3, 1), label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}` };
}

function useCountUp(target: number, key: string, dur = 950): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setVal(target * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, key]);
  return val;
}

function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now'; if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`;
}

export default function FunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ unit: 'week', offset: 0 });
  const [boardOpen, setBoardOpen] = useState(false);
  const [stage, setStage] = useState<'calls' | 'talked' | 'booked' | 'showed' | 'sales'>('calls');

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setData(await getFunnel()); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to load funnel'); }
    finally { setIsLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const rangeKey = `${range.unit}:${range.offset}`;

  const view = useMemo(() => {
    if (!data?.calls) return null;
    const { start, end, label } = rangeBounds(range);
    const startStr = toStr(start), endStr = toStr(end);
    const inR = (d: string) => d >= startStr && d < endStr;
    const calls = (data.calls || []).filter((e) => inR(e.d));
    const sessions = (data.sessions || []).filter((e) => inR(e.d));
    const sales = (data.sales || []).filter((e) => inR(e.d));

    const spp = data.goal?.sessionsPerPack ?? 8;
    const isDay = range.unit === 'day';
    const goalPacks = GOAL_PACKS[range.unit];
    const sessionsSold = sales.reduce((t, s) => t + s.s, 0);
    const equivs = sessionsSold / spp;

    const isCurrent = range.offset === 0;
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const elapsed = isCurrent ? Math.min(totalDays, Math.round((Date.now() - start.getTime()) / 86_400_000) + 1) : totalDays;
    const daysLeft = isCurrent ? Math.max(0, totalDays - elapsed + 1) : 0;
    const cpe = data.trailing90?.callsPerEquiv ?? null;
    const remaining = Math.max(0, goalPacks - equivs);
    const needCallsPerDay = !isDay && isCurrent && cpe && remaining > 0 && daysLeft > 0 ? Math.max(1, Math.round((remaining * cpe) / daysLeft)) : null;

    let status = { word: 'ON PACE', dot: COL.green };
    if (isDay) status = { word: '', dot: COL.ember };
    else if (equivs >= goalPacks) status = { word: isCurrent ? 'GOAL HIT' : 'HIT', dot: COL.green };
    else if (!isCurrent) status = { word: 'MISSED', dot: COL.inkSoft };
    else {
      const ratio = goalPacks * (elapsed / totalDays) > 0 ? equivs / (goalPacks * (elapsed / totalDays)) : 1;
      status = ratio >= 1.05 ? { word: 'AHEAD', dot: COL.gold } : ratio >= 0.85 ? { word: 'ON PACE', dot: COL.green } : { word: 'BEHIND', dot: COL.rust };
    }

    const talk = calls.filter((c) => c.o === 'talk').length;
    const vm = calls.filter((c) => c.o === 'vm').length;
    const none = calls.filter((c) => c.o === 'none').length;
    const booked = sessions.length;
    const showed = sessions.filter((s) => s.showed).length;

    const day14: string[] = []; for (let i = 13; i >= 0; i--) day14.push(toStr(addDays(new Date(), -i)));
    const countOn: Record<string, (d: string) => number> = {
      calls: (d) => (data.calls || []).filter((c) => c.d === d).length,
      talked: (d) => (data.calls || []).filter((c) => c.d === d && c.o === 'talk').length,
      booked: (d) => (data.sessions || []).filter((s) => s.d === d).length,
      showed: (d) => (data.sessions || []).filter((s) => s.d === d && s.showed).length,
      sales: (d) => (data.sales || []).filter((s) => s.d === d).length,
    };
    const pulses: Record<string, { d: string; n: number }[]> = {};
    (['calls', 'talked', 'booked', 'showed', 'sales'] as const).forEach((k) => { pulses[k] = day14.map((d) => ({ d, n: countOn[k](d) })); });
    const callsToday = countOn.calls(toStr(new Date()));

    const cohorts = new Map<string, { sold: number; talk: number; booked: number; showed: number; sales: number }>();
    const row = (c: string) => { if (!cohorts.has(c)) cohorts.set(c, { sold: 0, talk: 0, booked: 0, showed: 0, sales: 0 }); return cohorts.get(c)!; };
    calls.forEach((c) => { if (c.o === 'talk') row(c.c).talk++; });
    sessions.forEach((s) => { row(s.c).booked++; if (s.showed) row(s.c).showed++; });
    sales.forEach((s) => { const r = row(s.c); r.sold += s.s; r.sales++; });
    const board = [...cohorts.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sold - a.sold || b.talk - a.talk);
    const repeats = sales.filter((s) => s.r).length;

    // per-stage targets — monthly target (dynamic, from the snapshot) scaled to this range's work-days
    const mt = data.targets || MONTHLY_TARGET;
    const sc = workdays(totalDays) / WORKDAYS_MO;
    const stageTarget = {
      calls: Math.round(mt.calls * sc), talk: Math.round(mt.talk * sc), booked: Math.round(mt.booked * sc),
      showed: Math.round(mt.showed * sc), sales: Math.round((mt.sales ?? goalPacks) * sc),
    };
    const dailyCallsTarget = Math.max(1, Math.round(mt.calls / WORKDAYS_MO));

    return { label, isDay, isCurrent, daysLeft, goalPacks, spp, sessionsSold, equivs, remaining, needCallsPerDay, status,
      callsN: calls.length, none, vm, talk, booked, showed, salesCount: sales.length, repeats, pulses, callsToday, board,
      stageTarget, dailyCallsTarget };
  }, [data, range]);

  const countUp = useCountUp(view?.equivs ?? 0, rangeKey);

  if (isLoading) return <div className="flex min-h-screen items-center justify-center" style={{ background: COL.bg }}><Loader2 className="h-8 w-8 animate-spin" style={{ color: COL.maroon }} /></div>;
  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: COL.bg }}>
      <AlertCircle className="h-8 w-8" style={{ color: COL.inkSoft }} /><p style={{ color: COL.inkSoft }}>{error}</p>
      <button onClick={load} className="rounded-full px-4 py-2 text-sm" style={{ border: `1px solid ${COL.maroon}`, color: COL.ink }}>Try again</button>
    </div>
  );
  if (!data || data.empty || !view || (data.v ?? 0) < 2) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center" style={{ background: COL.bg }}>
      <p className="font-serif text-lg" style={{ color: COL.ink }}>No funnel snapshot yet</p>
      <p className="max-w-xs text-sm" style={{ color: COL.inkSoft }}>Run funnel.mjs and publish to KV.</p>
    </div>
  );

  const v = view;
  const goalHit = !v.isDay && v.equivs >= v.goalPacks;
  const todayStr = toStr(new Date());

  // per-stage drill-in — the tapped ring drives the trend card below (Oura-style)
  const SM: Record<string, { label: string; col: string; count: number; target: number; pulse: { d: string; n: number }[] }> = {
    calls:  { label: 'Calls',  col: COL.plum,   count: v.callsN,     target: v.stageTarget.calls,  pulse: v.pulses.calls },
    talked: { label: 'Talked', col: COL.maroon, count: v.talk,       target: v.stageTarget.talk,   pulse: v.pulses.talked },
    booked: { label: 'Booked', col: COL.rust,   count: v.booked,     target: v.stageTarget.booked, pulse: v.pulses.booked },
    showed: { label: 'Showed', col: COL.ember,  count: v.showed,     target: v.stageTarget.showed, pulse: v.pulses.showed },
    sales:  { label: 'Sales',  col: COL.gold,   count: v.salesCount, target: v.stageTarget.sales,  pulse: v.pulses.sales },
  };
  const sm = SM[stage];
  const smMax = Math.max(1, ...sm.pulse.map((p) => p.n));
  const smHit = sm.target >= 1 && sm.count >= sm.target;
  const smPct = sm.target >= 1 ? Math.min(1, sm.count / sm.target) : 0;
  const RING_R = 18, RING_C = 2 * Math.PI * 18;

  // five funnel rings, widest → narrowest, mapped to the real stages
  const rings = [
    { key: 'calls',  label: 'calls',  n: v.callsN, w: 100, col: COL.plum,   t: v.stageTarget.calls },
    { key: 'talked', label: 'talked', n: v.talk,   w: 82,  col: COL.maroon, t: v.stageTarget.talk },
    { key: 'booked', label: 'booked', n: v.booked, w: 64,  col: COL.rust,   t: v.stageTarget.booked },
    { key: 'showed', label: 'showed', n: v.showed, w: 48,  col: COL.ember,  t: v.stageTarget.showed },
    { key: 'sales',  label: v.salesCount === 1 ? 'sale' : 'sales', n: v.salesCount, w: 34, col: COL.gold, t: v.stageTarget.sales },
  ];
  const winCount = rings.filter((r) => r.t >= 1 && r.n >= r.t).length;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  const drops = [
    { v: pct(v.talk, v.callsN), word: 'of calls were answered', none: 'no calls yet' },
    { v: pct(v.booked, v.talk), word: 'of talks booked a session', none: 'no one answered yet' },
    { v: pct(v.showed, v.booked), word: 'of bookings showed up', none: 'no bookings yet' },
    { v: pct(v.salesCount, v.showed), word: 'of shows bought a pack', none: 'no one has shown yet' },
  ];
  // woodland pool geometry (the funnel stages, narrowing down the trunk)
  const rk: Record<string, typeof rings[number]> = Object.fromEntries(rings.map((r) => [r.key, r]));
  const POOLS = [
    { key: 'calls',  y: 150, rx: 96, ry: 17, fs: 22 },
    { key: 'talked', y: 224, rx: 78, ry: 15, fs: 20 },
    { key: 'booked', y: 298, rx: 60, ry: 13, fs: 18 },
    { key: 'showed', y: 372, rx: 44, ry: 11, fs: 16 },
    { key: 'sales',  y: 446, rx: 30, ry: 10, fs: 15 },
  ];

  return (
    <div className="min-h-screen" style={{ background: COL.bg, color: COL.ink }}>
      <style>{`
        @keyframes fn-pour { 0%{transform:translateY(-18px) scale(.7);opacity:0} 18%{opacity:1} 70%{transform:translateY(26px) scale(1);opacity:1} 100%{transform:translateY(54px) scale(.4);opacity:0} }
        @keyframes fn-coin { 0%{transform:translateY(-6px) rotateY(0deg);opacity:0} 14%{opacity:1} 100%{transform:translateY(62px) rotateY(540deg);opacity:0} }
        @keyframes fn-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes fn-reveal { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
        @keyframes fn-grow { from{transform:scaleX(.85);opacity:0} to{transform:none;opacity:1} }
        .fn-reveal{animation:fn-reveal .55s cubic-bezier(.22,1,.36,1) both}
        .fn-ring{animation:fn-grow .55s cubic-bezier(.22,1,.36,1) both;transform-origin:center}
        .fn-pour{animation:fn-pour 2.6s ease-in infinite}
        .fn-coin{animation:fn-coin 2.4s ease-in infinite}
        .fn-bob{animation:fn-bob 3s ease-in-out infinite}
        @keyframes fn-pop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.3)}100%{transform:scale(1);opacity:1}}
        .fn-pop{animation:fn-pop .5s cubic-bezier(.22,1.5,.4,1) both}
        @keyframes fn-drop{0%{transform:translateY(0);opacity:0}12%{opacity:1}86%{opacity:1}100%{transform:translateY(312px);opacity:0}}
        @keyframes fn-march{to{stroke-dashoffset:-18}}
        .fn-drop{animation:fn-drop 2.6s ease-in infinite}
        .fn-hopline{stroke:#8B8194;stroke-width:1.6;stroke-dasharray:2 7;fill:none;stroke-linecap:round;animation:fn-march 1.1s linear infinite}
        .fn-dash{animation:fn-march 2.2s linear infinite}
      `}</style>

      <div className="mx-auto max-w-2xl px-4 pb-10 pt-5">
        {/* header */}
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold leading-none">The Funnel</h1>
            <p className="mt-1 text-xs" style={{ color: COL.inkSoft }}>leads in the top, packs out the bottom · updated {agoLabel(data.generatedAt)}</p>
          </div>
          <button onClick={load} aria-label="Reload" className="rounded-full p-2.5 active:scale-90" style={{ border: `1px solid ${COL.line}`, color: COL.inkSoft, background: COL.card }}><RefreshCw className="h-4 w-4" /></button>
        </div>

        {/* range control */}
        <div className="mb-4 flex items-center gap-2">
          <button onClick={() => setRange((r) => ({ ...r, offset: r.offset - 1 }))} aria-label="Previous" className="rounded-full p-2 active:scale-90" style={{ border: `1px solid ${COL.line}`, background: COL.card }}><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex flex-1 overflow-hidden rounded-full p-1 text-sm" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
            {(['day','week','month','quarter'] as RangeUnit[]).map((u) => (
              <button key={u} onClick={() => setRange({ unit: u, offset: 0 })} className="flex-1 rounded-full py-1.5 font-medium capitalize transition-all" style={range.unit === u ? { background: COL.ink, color: '#fff' } : { color: COL.inkSoft }}>{u}</button>
            ))}
          </div>
          <button onClick={() => setRange((r) => ({ ...r, offset: Math.min(0, r.offset + 1) }))} aria-label="Next" disabled={range.offset >= 0} className="rounded-full p-2 active:scale-90 disabled:opacity-30" style={{ border: `1px solid ${COL.line}`, background: COL.card }}><ChevronRight className="h-4 w-4" /></button>
        </div>

        {/* pace strip */}
        <div className="fn-reveal mb-4 flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <div className="flex items-baseline gap-1.5">
            {v.isDay ? (
              <><span className="font-serif text-2xl font-bold" style={{ color: COL.maroon }}>{v.sessionsSold}</span><span className="text-sm" style={{ color: COL.inkSoft }}>sessions sold {v.label}</span></>
            ) : (
              <><span className="font-serif text-2xl font-bold tabular-nums" style={{ color: COL.maroon }}>{countUp.toFixed(1)}</span><span className="font-serif text-lg" style={{ color: COL.inkSoft }}>/ {v.goalPacks}</span><span className="text-xs uppercase tracking-widest" style={{ color: COL.inkSoft }}>packs</span></>
            )}
          </div>
          {v.status.word && <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-widest" style={{ background: COL.bg, color: COL.ink }}><span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: v.status.dot }} />{v.status.word}{goalHit && ' 🎉'}</span>}
        </div>
        {v.isCurrent && !v.isDay && !goalHit && (
          <p className="-mt-2 mb-4 text-center text-xs" style={{ color: COL.inkSoft }}><b style={{ color: COL.ink }}>{v.remaining.toFixed(1)}</b> packs to go · <b style={{ color: COL.ink }}>{v.daysLeft}</b> day{v.daysLeft === 1 ? '' : 's'} left · aim <b style={{ color: COL.ink }}>~{v.dailyCallsTarget}</b> calls/day</p>
        )}

        {/* ── THE FUNNEL: a little woodland ── */}
        <div className="fn-reveal relative mb-5 overflow-hidden rounded-3xl" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <svg key={rangeKey} viewBox="0 0 380 540" className="w-full" role="img" aria-label="Woodland funnel — tap a stage to open it">
            <defs>
              <filter id="fn-rough"><feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="5" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" /></filter>
            </defs>

            {/* ground + foliage */}
            <ellipse cx="190" cy="524" rx="168" ry="20" fill="#3C4A39" opacity=".10" />
            <path d="M12 116 q50 -32 92 0 q24 42 -14 72 q-56 22 -92 -14 q-22 -34 14 -58Z" fill="#566B4C" opacity=".16" filter="url(#fn-rough)" />

            {/* tree + rabbits (left) */}
            <g filter="url(#fn-rough)">
              <rect x="34" y="146" width="15" height="116" rx="7" fill="#6B5640" />
              <path d="M42 38 q54 18 42 80 q-6 36 -42 38 q-40 -2 -48 -38 q-14 -62 48 -80Z" fill="#566B4C" />
            </g>
            <g stroke="#332B26" strokeWidth="1.5" fill="#fff" strokeLinecap="round" strokeLinejoin="round" filter="url(#fn-rough)">
              <path d="M30 226 q-8 -14 -4 -26" fill="none" /><path d="M24 226 q-10 -14 -6 -28" fill="none" />
              <circle cx="27" cy="234" r="8" /><circle cx="24" cy="232" r="1.5" fill="#332B26" />
            </g>
            <g transform="translate(94 238) rotate(-16)" stroke="#332B26" strokeWidth="1.5" fill="#fff" strokeLinecap="round" strokeLinejoin="round" filter="url(#fn-rough)">
              <ellipse cx="0" cy="0" rx="13" ry="8" /><circle cx="12" cy="-4" r="5.5" />
              <path d="M15 -7 q3 -14 7 -18" fill="none" /><path d="M10 -8 q0 -14 4 -18" fill="none" />
              <circle cx="15" cy="-5" r="1.3" fill="#332B26" /><circle cx="-12" cy="2" r="2.6" />
            </g>
            <path d="M110 226 q44 -34 92 -20" className="fn-hopline" />

            {/* bear dropping radishes (top-right) */}
            <g filter="url(#fn-rough)">
              <path d="M300 64 q44 0 44 58 q0 44 -44 48 q-46 -4 -46 -48 q0 -58 46 -58Z" fill="#6E5038" />
              <circle cx="262" cy="92" r="28" fill="#6E5038" />
              <circle cx="245" cy="71" r="9" fill="#6E5038" /><circle cx="279" cy="71" r="9" fill="#6E5038" />
              <circle cx="245" cy="71" r="4" fill="#5A4029" /><circle cx="279" cy="71" r="4" fill="#5A4029" />
              <ellipse cx="254" cy="102" rx="12" ry="9" fill="#caa987" /><circle cx="252" cy="99" r="2.4" fill="#2b1b12" />
              <circle cx="252" cy="87" r="1.8" fill="#2b1b12" /><circle cx="267" cy="87" r="1.8" fill="#2b1b12" />
              <path d="M274 116 q-22 12 -54 14" stroke="#6E5038" strokeWidth="10" fill="none" strokeLinecap="round" />
              <path d="M312 116 q26 0 24 24 q-2 18 -24 18 q-22 0 -24 -18 q-2 -24 24 -24Z" fill="#B0884E" />
              <circle cx="304" cy="118" r="5" fill="#C8475A" /><circle cx="320" cy="116" r="5" fill="#C8475A" /><circle cx="330" cy="124" r="4" fill="#C8475A" />
            </g>

            {/* the hollow trunk funnel */}
            <path d="M92 140 C 102 226, 142 296, 158 442 Q 190 458 222 442 C 238 296, 278 226, 288 140 Z" fill="#caa276" opacity=".16" stroke="#8a6a3e" strokeWidth="1.4" filter="url(#fn-rough)" />

            {/* radishes tumbling down */}
            {[{ x: 178, d: '0s' }, { x: 200, d: '0.9s' }, { x: 186, d: '1.8s' }].map((rr, i) => (
              <g key={i} className="fn-drop" style={{ animationDelay: rr.d }}>
                <circle cx={rr.x} cy="124" r="6" fill="#C8475A" />
                <path d={`M${rr.x} 130 q2 6 0 9`} stroke="#9c3344" strokeWidth="1.4" fill="none" />
                <path d={`M${rr.x - 4} 118 q-2 -7 1 -9 M${rr.x} 116 q0 -8 0 -10 M${rr.x + 4} 118 q2 -7 -1 -9`} stroke="#7BA05B" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              </g>
            ))}

            {/* stage pools */}
            {POOLS.map((p) => {
              const r = rk[p.key]; if (!r) return null;
              const hit = r.t >= 1 && r.n >= r.t; const isSel = stage === p.key;
              const lightText = p.key === 'showed' || p.key === 'sales';
              return (
                <g key={p.key} onClick={() => setStage(p.key as typeof stage)} style={{ cursor: 'pointer' }}>
                  {hit && <ellipse cx="190" cy={p.y} rx={p.rx + 9} ry={p.ry + 7} fill="none" stroke={COL.green} strokeWidth="2.4" strokeDasharray="4 8" className="fn-dash" />}
                  {isSel && !hit && <ellipse cx="190" cy={p.y} rx={p.rx + 5} ry={p.ry + 4} fill="none" stroke={COL.ink} strokeWidth="1.8" strokeDasharray="3 4" />}
                  <ellipse cx="190" cy={p.y} rx={p.rx} ry={p.ry} fill={r.col} filter="url(#fn-rough)" />
                  <ellipse cx="190" cy={p.y - p.ry * 0.45} rx={p.rx * 0.9} ry={p.ry * 0.5} fill="#fff" opacity=".15" />
                  <text x="190" y={p.y + p.fs * 0.34} textAnchor="middle" fontFamily="'Bona Nova',serif" fontWeight="700" fontSize={p.fs} fill={lightText ? COL.ink : '#fff'}>
                    {r.n}{r.t >= 1 && <tspan fontSize="11" opacity=".6"> / {r.t}</tspan>}
                  </text>
                  <text x="190" y={p.y + p.ry + 13} textAnchor="middle" fontFamily="'Bona Nova',serif" fontSize="11" fill={COL.inkSoft}>{r.label}</text>
                  {hit && <g transform={`translate(${190 + p.rx - 1} ${p.y - p.ry - 1})`}><circle r="7.5" fill={COL.green} /><path d="M-3.4 0 l2.4 2.8 l4.6 -5.6" stroke="#fff" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>}
                </g>
              );
            })}

            {/* conversion % beside each gap */}
            {POOLS.slice(0, 4).map((p, i) => (
              <text key={i} x={190 + p.rx + 12} y={(p.y + POOLS[i + 1].y) / 2 + 3} fontFamily="'Bona Nova',serif" fontSize="11" fill={COL.inkSoft}>↓ {drops[i].v}</text>
            ))}

            {/* harvest basket + hedgehog */}
            <g filter="url(#fn-rough)">
              <path d="M150 472 q40 -12 80 0 l-9 42 q-31 9 -62 0Z" fill="#B0884E" />
              <path d="M150 472 q40 -12 80 0" fill="none" stroke="#8a6a35" strokeWidth="2.2" />
              <circle cx="170" cy="478" r="7" fill="#C8475A" /><circle cx="192" cy="474" r="8" fill="#C8475A" /><circle cx="212" cy="480" r="6" fill="#C8475A" />
              <path d="M166 471 q-2 -8 2 -12 M190 465 q0 -10 0 -13 M210 471 q3 -8 -2 -12" stroke="#7BA05B" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <g transform="translate(290 498)"><path d="M-18 4 q3 -19 19 -19 q15 0 13 19Z" fill="#7a5c43" /><path d="M-15 -3 l-4 -7 M-7 -9 l-2 -9 M1 -11 l0 -9 M9 -9 l3 -8" stroke="#5a4029" strokeWidth="1.6" strokeLinecap="round" /><circle cx="-16" cy="4" r="4" fill="#caa987" /><circle cx="-18" cy="3" r="1" fill="#2b1b12" /></g>
            </g>
          </svg>

          {/* notes under the scene */}
          <div className="px-4 pb-4 text-center">
            <p className="text-[11px]" style={{ color: COL.inkSoft }}>🚫 {v.none} no answer · 📩 {v.vm} voicemail · <b style={{ color: COL.ink }}>tap a stage</b> to open it</p>
            {winCount > 0 && <p className="fn-pop mt-1 text-sm font-semibold" style={{ color: COL.green }}>✨ {winCount} of 5 goals hit{winCount === 5 ? ' — full harvest!' : ''}</p>}
          </div>
        </div>

        {/* per-stage trend — tap a ring above to switch */}
        <div className="fn-reveal mb-5 rounded-2xl p-4" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest" style={{ color: COL.inkSoft }}>tap a ring above to switch</p>
              <h3 className="font-serif text-lg leading-tight" style={{ color: sm.col }}>{sm.label}</h3>
            </div>
            {sm.target >= 1 && (
              <div className="relative h-14 w-14 shrink-0">
                <svg viewBox="0 0 44 44" className="h-14 w-14 -rotate-90">
                  <circle cx="22" cy="22" r={RING_R} fill="none" stroke="#EBE2D6" strokeWidth="4" />
                  <circle cx="22" cy="22" r={RING_R} fill="none" stroke={smHit ? COL.green : sm.col} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - smPct)} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-serif text-base font-bold leading-none" style={{ color: COL.ink }}>{sm.count}</span>
                  <span className="text-[8px]" style={{ color: COL.inkSoft }}>/ {sm.target}</span>
                </div>
                {smHit && <span className="fn-pop absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: COL.green }}><Check className="h-3 w-3" strokeWidth={3} /></span>}
              </div>
            )}
          </div>
          <div className="flex h-14 items-end gap-[3px]">
            {sm.pulse.map((p) => <div key={p.d} title={`${p.d}: ${p.n}`} className="flex-1 rounded-t-md transition-all" style={{ height: `${Math.max(5, (p.n / smMax) * 100)}%`, background: p.d === todayStr ? sm.col : '#EBE2D6' }} />)}
          </div>
          <div className="mt-1 flex justify-between text-[10px]" style={{ color: COL.inkSoft }}>
            <span>last 14 days</span>
            <span>this {range.unit}: <b style={{ color: COL.ink }}>{sm.count}</b>{sm.target >= 1 && ` / ${sm.target}`}</span>
          </div>
        </div>

        {/* scoreboard */}
        <button onClick={() => setBoardOpen(true)} className="fn-reveal flex w-full items-center justify-between rounded-2xl p-4 active:scale-[.99]" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <span className="flex items-center gap-2 text-sm font-semibold"><Trophy className="h-4 w-4" style={{ color: COL.gold }} /> Cohort scoreboard</span>
          <span className="text-xs" style={{ color: COL.inkSoft }}>{v.board[0]?.sold ? `${v.board[0].name} leads →` : 'view →'}</span>
        </button>
        {v.repeats > 0 && <p className="mt-3 text-center text-xs" style={{ color: COL.inkSoft }}>↻ {v.repeats} repeat purchase{v.repeats === 1 ? '' : 's'} this period</p>}
      </div>

      {boardOpen && (
        <div className="fixed inset-0 z-50" style={{ background: 'rgba(44,39,56,.45)' }} onClick={() => setBoardOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 max-h-[78vh] overflow-y-auto rounded-t-3xl p-5 pb-10" style={{ background: COL.bg }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold"><Trophy className="h-5 w-5" style={{ color: COL.gold }} /> Scoreboard · {v.label}</h2>
              <button onClick={() => setBoardOpen(false)} aria-label="Close" className="rounded-full p-1.5" style={{ color: COL.inkSoft }}><X className="h-5 w-5" /></button>
            </div>
            {v.board.length === 0 && <p className="py-6 text-center text-sm" style={{ color: COL.inkSoft }}>No activity this period.</p>}
            <div className="space-y-3">
              {v.board.map((c, i) => {
                const lead = Math.max(1, v.board[0]?.sold || 0); const medal = c.sold > 0 ? ['🥇','🥈','🥉'][i] ?? '·' : '·';
                return (
                  <div key={c.name} className="rounded-2xl p-3" style={{ border: `1px solid ${i === 0 && c.sold > 0 ? COL.gold : COL.line}`, background: i === 0 && c.sold > 0 ? COL.card : 'transparent' }}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-semibold"><span className="w-5 text-base">{medal}</span>{c.name}</span>
                      <span className="text-sm tabular-nums"><b className="font-serif text-lg">{c.sold}</b><span className="text-xs" style={{ color: COL.inkSoft }}> sold</span></span>
                    </div>
                    <div className="mb-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: '#EBE2D6' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(c.sold / lead) * 100}%`, background: `linear-gradient(90deg, ${COL.ember}, ${COL.maroon})` }} />
                    </div>
                    <p className="text-[11px]" style={{ color: COL.inkSoft }}>{c.talk} talked · {c.booked} booked · {c.showed} showed · {c.sales} sale{c.sales === 1 ? '' : 's'}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
