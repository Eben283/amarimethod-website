import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Trophy, X, Check } from 'lucide-react';
import { getFunnel, ApiError, type FunnelData } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// FUNNEL — a little woodland: the bear ladles radishes (leads) into the hollow
// tree; they tumble down five pools (calls → talked → booked → showed → sold);
// the hedgehog gathers the harvest. Data lives in legible chips ABOVE the art —
// clarity never depends on the picture.
//
// Art: layered painted PNGs from /staff/funnel-art/* (see public/funnel-art/
// README.md). Until those exist, built-in SVG stand-ins render in the same
// slots — the page probes each file at runtime and upgrades automatically.
// Motion: CSS keyframes only (transform/opacity loops — no animation deps).

type RangeUnit = 'day' | 'week' | 'month' | 'quarter';
interface Range { unit: RangeUnit; offset: number }
const GOAL_PACKS: Record<RangeUnit, number> = { day: 0, week: 2, month: 8, quarter: 24 };

// Fallback monthly targets when the snapshot doesn't carry measured ones —
// chain: calls→talked 13% · talked→booked 58% · booked→showed 43% · showed→buy ~80%.
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
  bear: '#6E5038', trunk: '#6B5640', leaf: '#566B4C', radish: '#C8475A', basket: '#B0884E',
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

// ── painted-art loader: probe /staff/funnel-art/<file>; fall back to SVG ────
type ArtName = 'bear' | 'trunk' | 'bowl' | 'rabbitHop' | 'rabbitSit' | 'hedgehog' | 'radish' | 'leaf' | 'ground';
const ART_FILES: Record<ArtName, string> = {
  bear: 'bear-ladle.png', trunk: 'tree-trunk.png', bowl: 'pool-bowl.png',
  rabbitHop: 'rabbit-hop.png', rabbitSit: 'rabbit-sit.png', hedgehog: 'hedgehog-basket.png',
  radish: 'radish.png', leaf: 'leaf.png', ground: 'ground-bank.png',
};
const artUrl = (n: ArtName) => `${import.meta.env.BASE_URL}funnel-art/${ART_FILES[n]}`;
const artProbe = new Map<ArtName, Promise<boolean>>();
function probeArt(n: ArtName): Promise<boolean> {
  if (!artProbe.has(n)) {
    artProbe.set(n, new Promise((res) => {
      const img = new Image();
      img.onload = () => res(true); img.onerror = () => res(false);
      img.src = artUrl(n);
    }));
  }
  return artProbe.get(n)!;
}
function useArt(): Record<ArtName, boolean> {
  const [ok, setOk] = useState<Record<ArtName, boolean>>(() => {
    const o = {} as Record<ArtName, boolean>;
    (Object.keys(ART_FILES) as ArtName[]).forEach((k) => { o[k] = false; });
    return o;
  });
  useEffect(() => {
    let live = true;
    (Object.keys(ART_FILES) as ArtName[]).forEach((k) =>
      probeArt(k).then((v) => { if (live && v) setOk((s) => (s[k] ? s : { ...s, [k]: true })); }));
    return () => { live = false; };
  }, []);
  return ok;
}

// ── SVG stand-ins (same slots; replaced automatically when PNGs land) ───────
const Rough = ({ id }: { id: string }) => (
  <filter id={id}><feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="5" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" /></filter>
);
const SvgBear = () => (
  <svg viewBox="0 0 120 120" className="h-full w-full"><defs><Rough id="fr-bear" /></defs>
    <g filter="url(#fr-bear)">
      <path d="M70 28 q34 0 34 44 q0 34 -34 38 q-36 -4 -36 -38 q0 -44 36 -44Z" fill={COL.bear} />
      <circle cx="40" cy="48" r="22" fill={COL.bear} />
      <circle cx="27" cy="32" r="7.5" fill={COL.bear} /><circle cx="53" cy="32" r="7.5" fill={COL.bear} />
      <circle cx="27" cy="32" r="3.4" fill="#5A4029" /><circle cx="53" cy="32" r="3.4" fill="#5A4029" />
      <ellipse cx="34" cy="56" rx="10" ry="7.5" fill="#caa987" /><circle cx="32" cy="53" r="2" fill="#2b1b12" />
      <circle cx="33" cy="44" r="1.6" fill="#2b1b12" /><circle cx="45" cy="44" r="1.6" fill="#2b1b12" />
      <path d="M52 72 q-18 9 -40 10" stroke={COL.bear} strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d="M2 84 q14 -8 26 0 q2 9 -12 11 q-15 -1 -14 -11Z" fill="#8a6a3e" />
      <path d="M26 84 l16 -5" stroke="#8a6a3e" strokeWidth="4" strokeLinecap="round" />
      <circle cx="8" cy="84" r="4.4" fill={COL.radish} /><circle cx="18" cy="82" r="4.8" fill={COL.radish} />
    </g>
  </svg>
);
const SvgTrunk = () => (
  <svg viewBox="0 0 100 240" preserveAspectRatio="none" className="h-full w-full"><defs><Rough id="fr-trunk" /></defs>
    <g filter="url(#fr-trunk)">
      <path d="M8 10 C 14 70, 30 130, 36 224 Q 50 232 64 224 C 70 130, 86 70, 92 10 Q 50 -4 8 10Z" fill="#b8956b" />
      <path d="M8 10 C 14 70, 30 130, 36 224 Q 50 232 64 224 C 70 130, 86 70, 92 10 Q 50 -4 8 10Z" fill="#caa276" opacity=".55" stroke="#8a6a3e" strokeWidth="1.6" />
      <ellipse cx="50" cy="11" rx="40" ry="9" fill="#4a3826" />
      <ellipse cx="50" cy="9.4" rx="40" ry="8" fill="none" stroke="#566B4C" strokeWidth="2.4" opacity=".8" />
      <path d="M22 60 q4 14 0 26 M78 60 q-4 14 0 26 M30 130 q3 10 0 20" stroke="#8a6a3e" strokeWidth="1.6" fill="none" opacity=".6" />
    </g>
  </svg>
);
const SvgBowl = ({ tint }: { tint: string }) => (
  <svg viewBox="0 0 120 44" preserveAspectRatio="none" className="h-full w-full">
    <ellipse cx="60" cy="22" rx="58" ry="19" fill={tint} />
    <ellipse cx="60" cy="15" rx="52" ry="11" fill="#fff" opacity=".16" />
    <ellipse cx="60" cy="22" rx="58" ry="19" fill="none" stroke="#8a6a3e" strokeWidth="2" opacity=".55" />
  </svg>
);
const SvgRabbit = ({ hop }: { hop?: boolean }) => (
  <svg viewBox="0 0 60 60" className="h-full w-full"><defs><Rough id="fr-rab" /></defs>
    <g stroke="#332B26" strokeWidth="1.5" fill="#fff" strokeLinecap="round" strokeLinejoin="round" filter="url(#fr-rab)"
      transform={hop ? 'translate(30 34) rotate(-14)' : 'translate(30 36)'}>
      {hop ? (<>
        <ellipse cx="0" cy="0" rx="14" ry="8.5" /><circle cx="13" cy="-4" r="6" />
        <path d="M16 -8 q3 -14 7 -18" fill="none" /><path d="M11 -9 q0 -14 4 -18" fill="none" />
        <circle cx="16" cy="-5" r="1.4" fill="#332B26" /><circle cx="-13" cy="2" r="2.8" />
      </>) : (<>
        <ellipse cx="0" cy="2" rx="9" ry="11" />
        <path d="M-3 -8 q-7 -16 -3 -26" fill="none" /><path d="M3 -8 q7 -16 3 -26" fill="none" />
        <circle cx="0" cy="-10" r="7" /><circle cx="2.4" cy="-11" r="1.3" fill="#332B26" />
      </>)}
    </g>
  </svg>
);
const SvgHedgehog = () => (
  <svg viewBox="0 0 130 90" className="h-full w-full"><defs><Rough id="fr-hog" /></defs>
    <g filter="url(#fr-hog)">
      <path d="M8 38 q34 -11 68 0 l-8 38 q-26 8 -52 0Z" fill={COL.basket} />
      <path d="M8 38 q34 -11 68 0" fill="none" stroke="#8a6a35" strokeWidth="2.2" />
      <path d="M20 50 q22 -7 44 0 M17 62 q24 -7 50 0" stroke="#8a6a35" strokeWidth="1.4" fill="none" opacity=".7" />
      <circle cx="26" cy="36" r="6.5" fill={COL.radish} /><circle cx="44" cy="32" r="7.5" fill={COL.radish} /><circle cx="62" cy="37" r="6" fill={COL.radish} />
      <path d="M23 29 q-2 -7 2 -11 M44 23 q0 -9 0 -12 M60 30 q3 -7 -2 -11" stroke="#7BA05B" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <g transform="translate(102 70)">
        <path d="M-20 4 q4 -22 21 -22 q17 0 15 22Z" fill="#7a5c43" />
        <path d="M-16 -4 l-5 -8 M-8 -11 l-2 -10 M1 -13 l0 -10 M10 -11 l4 -9" stroke="#5a4029" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="-18" cy="4" r="4.4" fill="#caa987" /><circle cx="-20" cy="3" r="1.1" fill="#2b1b12" />
      </g>
    </g>
  </svg>
);
const SvgRadish = () => (
  <svg viewBox="0 0 24 28" className="h-full w-full">
    <circle cx="12" cy="16" r="7" fill={COL.radish} />
    <path d="M12 23 q2 4 0 5" stroke="#9c3344" strokeWidth="1.4" fill="none" />
    <path d="M8 10 q-2 -7 1 -9 M12 9 q0 -8 0 -9 M16 10 q2 -7 -1 -9" stroke="#7BA05B" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
);
const SvgLeaf = () => (
  <svg viewBox="0 0 20 20" className="h-full w-full">
    <path d="M3 17 Q2 6 17 3 Q16 16 5 17 Z" fill={COL.leaf} opacity=".85" />
    <path d="M5 15 Q10 10 15 5" stroke="#FBF6EE" strokeWidth="1" fill="none" opacity=".7" />
  </svg>
);
const SvgGround = () => (
  <svg viewBox="0 0 380 90" preserveAspectRatio="none" className="h-full w-full"><defs><Rough id="fr-gr" /></defs>
    <path d="M0 38 Q70 14 160 30 Q270 46 380 24 L380 90 L0 90 Z" fill={COL.leaf} opacity=".30" filter="url(#fr-gr)" />
    <path d="M0 56 Q100 36 200 50 Q300 62 380 46 L380 90 L0 90 Z" fill={COL.green} opacity=".32" filter="url(#fr-gr)" />
    <circle cx="60" cy="58" r="2.4" fill={COL.gold} /><circle cx="320" cy="52" r="2.2" fill={COL.maroon} opacity=".8" /><circle cx="130" cy="66" r="1.8" fill={COL.gold} />
  </svg>
);

function Art({ name, ok, alt = '', className = '', style, tint }: {
  name: ArtName; ok: Record<ArtName, boolean>; alt?: string; className?: string; style?: React.CSSProperties; tint?: string;
}) {
  if (ok[name]) return <img src={artUrl(name)} alt={alt} draggable={false} className={className} style={{ width: '100%', height: '100%', objectFit: name === 'trunk' || name === 'bowl' || name === 'ground' ? 'fill' : 'contain', ...style }} />;
  switch (name) {
    case 'bear': return <SvgBear />;
    case 'trunk': return <SvgTrunk />;
    case 'bowl': return <SvgBowl tint={tint || COL.rust} />;
    case 'rabbitHop': return <SvgRabbit hop />;
    case 'rabbitSit': return <SvgRabbit />;
    case 'hedgehog': return <SvgHedgehog />;
    case 'radish': return <SvgRadish />;
    case 'leaf': return <SvgLeaf />;
    case 'ground': return <SvgGround />;
  }
}

// scene geometry (percent of the scene box) — five pool rows down the trunk
const TRUNK_AXIS = 35; // % from left
const ROWS: { key: 'calls' | 'talked' | 'booked' | 'showed' | 'sales'; y: number; w: number }[] = [
  { key: 'calls',  y: 26.5, w: 40 },
  { key: 'talked', y: 40,   w: 33 },
  { key: 'booked', y: 53.5, w: 26.5 },
  { key: 'showed', y: 67,   w: 21 },
  { key: 'sales',  y: 80.5, w: 16.5 },
];

export default function FunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ unit: 'week', offset: 0 });
  const [boardOpen, setBoardOpen] = useState(false);
  const [stage, setStage] = useState<'calls' | 'talked' | 'booked' | 'showed' | 'sales'>('calls');
  const art = useArt();

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

  // per-stage drill-in — the tapped pool drives the trend card below
  const SM: Record<string, { label: string; col: string; count: number; target: number; pulse: { d: string; n: number }[] }> = {
    calls:  { label: 'Calls',  col: COL.plum,   count: v.callsN,     target: v.stageTarget.calls,  pulse: v.pulses.calls },
    talked: { label: 'Talked', col: COL.maroon, count: v.talk,       target: v.stageTarget.talk,   pulse: v.pulses.talked },
    booked: { label: 'Booked', col: COL.rust,   count: v.booked,     target: v.stageTarget.booked, pulse: v.pulses.booked },
    showed: { label: 'Showed', col: COL.ember,  count: v.showed,     target: v.stageTarget.showed, pulse: v.pulses.showed },
    sales:  { label: 'Sales',  col: COL.goldDeep, count: v.salesCount, target: v.stageTarget.sales, pulse: v.pulses.sales },
  };
  const sm = SM[stage];
  const smMax = Math.max(1, ...sm.pulse.map((p) => p.n));
  const smHit = sm.target >= 1 && sm.count >= sm.target;
  const smPct = sm.target >= 1 ? Math.min(1, sm.count / sm.target) : 0;
  const RING_R = 18, RING_C = 2 * Math.PI * 18;

  // five funnel stages, widest → narrowest
  const rings = [
    { key: 'calls',  label: 'calls',  n: v.callsN, col: COL.plum,   t: v.stageTarget.calls },
    { key: 'talked', label: 'talked', n: v.talk,   col: COL.maroon, t: v.stageTarget.talk },
    { key: 'booked', label: 'booked', n: v.booked, col: COL.rust,   t: v.stageTarget.booked },
    { key: 'showed', label: 'showed', n: v.showed, col: COL.ember,  t: v.stageTarget.showed },
    { key: 'sales',  label: v.salesCount === 1 ? 'sale' : 'sales', n: v.salesCount, col: COL.goldDeep, t: v.stageTarget.sales },
  ];
  const winCount = rings.filter((r) => r.t >= 1 && r.n >= r.t).length;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  const drops = [
    { v: pct(v.talk, v.callsN), word: 'of calls were answered', none: 'no calls yet' },
    { v: pct(v.booked, v.talk), word: 'of talks booked a session', none: 'no one answered yet' },
    { v: pct(v.showed, v.booked), word: 'of bookings showed up', none: 'no bookings yet' },
    { v: pct(v.salesCount, v.showed), word: 'of shows bought a pack', none: 'no one has shown yet' },
  ];
  const rk: Record<string, typeof rings[number]> = Object.fromEntries(rings.map((r) => [r.key, r]));
  const burst = goalHit || winCount === 5;

  return (
    <div className="min-h-screen" style={{ background: COL.bg, color: COL.ink }}>
      <style>{`
        @keyframes fn-reveal { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
        .fn-reveal{animation:fn-reveal .55s cubic-bezier(.22,1,.36,1) both}
        @keyframes fn-pop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.3)}100%{transform:scale(1);opacity:1}}
        .fn-pop{animation:fn-pop .5s cubic-bezier(.22,1.5,.4,1) both}
        @keyframes fn-bob{0%,100%{transform:rotate(0deg) translateY(0)}50%{transform:rotate(-2.5deg) translateY(-4px)}}
        .fn-bob{animation:fn-bob 3.4s ease-in-out infinite;transform-origin:70% 90%}
        @keyframes fn-pour{0%{transform:translate(2px,-6px) rotate(0deg) scale(.85);opacity:0}14%{opacity:1}80%{opacity:1}100%{transform:translate(-14px,46px) rotate(190deg) scale(1);opacity:0}}
        .fn-pour{animation:fn-pour 2.4s ease-in infinite}
        @keyframes fn-tumble{0%{top:1%;transform:rotate(0deg) translateX(0)}25%{transform:rotate(140deg) translateX(5px)}50%{transform:rotate(280deg) translateX(-5px)}90%{opacity:1}100%{top:95%;transform:rotate(540deg) translateX(0);opacity:0}}
        .fn-tumble{animation:fn-tumble 5.2s cubic-bezier(.45,.1,.6,.9) infinite}
        @keyframes fn-hop{0%{left:4%;opacity:0}6%{opacity:1}12%{transform:translateY(-9px)}18%{transform:translateY(0)}24%{transform:translateY(-9px)}30%{transform:translateY(0)}36%{transform:translateY(-8px)}42%{left:26%;transform:translateY(0);opacity:1}48%{opacity:0;left:27%}100%{left:27%;opacity:0}}
        .fn-hop{animation:fn-hop 7.5s ease-in-out infinite}
        @keyframes fn-twitch{0%,90%,100%{transform:rotate(0)}93%{transform:rotate(-4deg)}96%{transform:rotate(3deg)}}
        .fn-twitch{animation:fn-twitch 5s ease-in-out infinite;transform-origin:50% 90%}
        @keyframes fn-leafdrift{0%{transform:translate(0,-8px) rotate(0deg);opacity:0}10%{opacity:.85}90%{opacity:.7}100%{transform:translate(-34px,360px) rotate(300deg);opacity:0}}
        .fn-leafdrift{animation:fn-leafdrift 11s linear infinite}
        @keyframes fn-glow{0%,100%{filter:drop-shadow(0 0 2px rgba(232,184,75,.0))}50%{filter:drop-shadow(0 0 7px rgba(232,184,75,.75))}}
        .fn-glow{animation:fn-glow 2.4s ease-in-out infinite}
        @keyframes fn-march{to{stroke-dashoffset:-18}}
        .fn-hopline{stroke:#8B8194;stroke-width:1.6;stroke-dasharray:2 7;fill:none;stroke-linecap:round;animation:fn-march 1.1s linear infinite}
        @keyframes fn-fall{0%{transform:translateY(-12px) rotate(0deg);opacity:1}100%{transform:translateY(430px) rotate(var(--spin,540deg));opacity:0}}
        .fn-fall{animation:fn-fall linear forwards}
        @media (prefers-reduced-motion: reduce){
          .fn-bob,.fn-pour,.fn-tumble,.fn-hop,.fn-twitch,.fn-leafdrift,.fn-glow,.fn-hopline,.fn-fall{animation:none !important}
          .fn-pour,.fn-tumble,.fn-fall{opacity:0}
        }
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

        {/* pace banner — the 5-second answer */}
        <div className="fn-reveal mb-4 rounded-2xl px-4 py-3" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-1.5">
              {v.isDay ? (
                <><span className="font-serif text-3xl font-bold" style={{ color: COL.maroon }}>{v.sessionsSold}</span><span className="text-sm" style={{ color: COL.inkSoft }}>sessions sold {v.label}</span></>
              ) : (
                <><span className="font-serif text-3xl font-bold tabular-nums" style={{ color: COL.maroon }}>{countUp.toFixed(1)}</span><span className="font-serif text-xl" style={{ color: COL.inkSoft }}>/ {v.goalPacks}</span><span className="text-xs uppercase tracking-widest" style={{ color: COL.inkSoft }}>packs · {v.label}</span></>
              )}
            </div>
            {v.status.word && <span className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold tracking-widest" style={{ background: COL.bg, color: COL.ink, border: `1px solid ${COL.line}` }}><span className="h-2 w-2 animate-pulse rounded-full" style={{ background: v.status.dot }} />{v.status.word}{goalHit && ' 🎉'}</span>}
          </div>
          {v.isCurrent && !v.isDay && !goalHit && (
            <p className="mt-2 border-t pt-2 text-center text-sm" style={{ borderColor: COL.line, color: COL.inkSoft }}>
              <b style={{ color: COL.ink }}>{v.remaining.toFixed(1)}</b> packs to go · <b style={{ color: COL.ink }}>{v.daysLeft}</b> day{v.daysLeft === 1 ? '' : 's'} left · aim <b style={{ color: COL.ink }}>~{v.dailyCallsTarget}</b> calls/day
            </p>
          )}
        </div>

        {/* ── THE WOODLAND ── */}
        <div className="fn-reveal relative mx-auto mb-5 max-w-[460px] overflow-hidden rounded-3xl" style={{ background: `linear-gradient(180deg, #FDF9F1 0%, ${COL.bg} 55%, #F4ECDD 100%)`, border: `1px solid ${COL.line}` }}>
          <div key={rangeKey} className="relative w-full" style={{ aspectRatio: '380 / 640' }} role="img" aria-label="Woodland funnel — tap a stage to inspect it">

            {/* goal-hit burst */}
            {burst && (
              <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
                {Array.from({ length: 26 }, (_, i) => (
                  <span key={i} className="fn-fall absolute block" style={{
                    left: `${4 + (i * 37) % 92}%`, top: '-14px', width: i % 3 === 0 ? 16 : 9, height: i % 3 === 0 ? 18 : 9,
                    animationDelay: `${(i * 73) % 900}ms`, animationDuration: `${1.7 + ((i * 41) % 100) / 80}s`,
                    ['--spin' as string]: `${(i % 2 ? 1 : -1) * (360 + (i * 67) % 360)}deg`,
                  }}>
                    {i % 3 === 0 ? <SvgRadish /> : i % 3 === 1 ? <SvgLeaf /> : <span className="block h-full w-full rounded-full" style={{ background: COL.gold }} />}
                  </span>
                ))}
              </div>
            )}

            {/* drifting leaves */}
            {[{ l: '12%', d: '0s' }, { l: '58%', d: '4s' }, { l: '84%', d: '8s' }].map((p, i) => (
              <span key={i} className="fn-leafdrift pointer-events-none absolute z-10 block h-4 w-4" style={{ left: p.l, top: '4%', animationDelay: p.d }}><Art name="leaf" ok={art} /></span>
            ))}

            {/* back tree + rabbits hopping in */}
            <div className="absolute" style={{ left: '-2%', top: '5%', width: '30%', height: '24%' }}>
              <svg viewBox="0 0 100 140" className="h-full w-full"><defs><Rough id="fr-btree" /></defs>
                <g filter="url(#fr-btree)">
                  <rect x="42" y="86" width="13" height="52" rx="6" fill={COL.trunk} />
                  <path d="M48 6 q44 14 35 64 q-5 30 -35 32 q-33 -2 -39 -32 q-11 -50 39 -64Z" fill={COL.leaf} opacity=".9" />
                </g>
              </svg>
            </div>
            <div className="fn-twitch absolute z-10" style={{ left: '3.5%', top: '24%', width: '11%', height: '7%' }}><Art name="rabbitSit" ok={art} /></div>
            <div className="fn-hop absolute z-10" style={{ top: '25.5%', width: '12%', height: '7%' }}><Art name="rabbitHop" ok={art} /></div>
            <svg className="pointer-events-none absolute" style={{ left: '6%', top: '24%', width: '32%', height: '8%' }} viewBox="0 0 120 48"><path d="M4 40 q56 -34 112 -20" className="fn-hopline" /></svg>

            {/* bear ladling radishes (top-right) */}
            <div className="fn-bob absolute z-10" style={{ right: '2%', top: '0.5%', width: '37%', height: '21%' }}><Art name="bear" ok={art} alt="" /></div>
            {[{ d: '0s' }, { d: '0.8s' }, { d: '1.6s' }].map((p, i) => (
              <span key={i} className="fn-pour absolute z-10 block" style={{ right: '34%', top: '12%', width: '5.5%', height: '4%', animationDelay: p.d }}><Art name="radish" ok={art} /></span>
            ))}

            {/* hollow trunk funnel */}
            <div className="absolute" style={{ left: `${TRUNK_AXIS - 23}%`, top: '8.5%', width: '46%', height: '85%' }}><Art name="trunk" ok={art} /></div>

            {/* radishes tumbling down the trunk */}
            <div className="pointer-events-none absolute" style={{ left: `${TRUNK_AXIS - 4}%`, top: '24%', width: '8%', height: '58%' }}>
              {[{ d: '0s', x: '0%' }, { d: '1.7s', x: '40%' }, { d: '3.4s', x: '15%' }].map((p, i) => (
                <span key={i} className="fn-tumble absolute block" style={{ left: p.x, width: '60%', aspectRatio: '24/28', animationDelay: p.d }}><Art name="radish" ok={art} /></span>
              ))}
            </div>

            {/* ground + harvest */}
            <div className="absolute bottom-0 left-0 right-0" style={{ height: '13%' }}><Art name="ground" ok={art} /></div>
            <div className="absolute z-10" style={{ right: '3%', bottom: '1%', width: '36%', height: '15%' }}><Art name="hedgehog" ok={art} alt="" /></div>

            {/* ── DATA LAYER: pools + chips + plain-language conversions ── */}
            {ROWS.map((p, i) => {
              const r = rk[p.key]; if (!r) return null;
              const hit = r.t >= 1 && r.n >= r.t; const isSel = stage === p.key;
              const next = i < 4 ? ROWS[i + 1] : null;
              return (
                <div key={p.key}>
                  {/* pool (art) */}
                  <div className={`absolute ${hit ? 'fn-glow' : ''}`} style={{ left: `${TRUNK_AXIS - p.w / 2}%`, top: `${p.y - 3.2}%`, width: `${p.w}%`, height: '6.4%' }}>
                    <Art name="bowl" ok={art} tint={r.col} />
                    {art.bowl && <div className="absolute inset-0 rounded-[50%]" style={{ background: r.col, opacity: .28, mixBlendMode: 'multiply' }} />}
                  </div>
                  {/* tap row: pool + chip in one big target */}
                  <button onClick={() => setStage(p.key)} aria-pressed={isSel}
                    aria-label={`${r.label}: ${r.n}${r.t >= 1 ? ` of ${r.t} target` : ''} — tap to inspect`}
                    className="absolute z-20 flex items-center justify-end"
                    style={{ left: '2%', right: '2.5%', top: `${p.y - 5.6}%`, height: '11.2%', background: 'transparent' }}>
                    <span className="flex w-[44%] items-center justify-between rounded-2xl px-3 py-2 text-left transition-transform active:scale-95"
                      style={{
                        background: 'rgba(251,246,238,.95)', backdropFilter: 'blur(2px)',
                        border: isSel ? `2px solid ${r.col}` : `1px solid rgba(44,39,56,.14)`,
                        boxShadow: isSel ? `0 2px 12px ${r.col}44` : '0 1px 6px rgba(44,39,56,.08)',
                      }}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: r.col }}>
                          {r.label}
                          {hit && <span className="fn-pop inline-flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: COL.green }}><Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} /></span>}
                        </span>
                        <span className="block font-serif text-[22px] font-bold leading-tight tabular-nums" style={{ color: COL.ink }}>
                          {r.n}{r.t >= 1 && <span className="text-xs font-normal" style={{ color: COL.inkSoft }}> / {r.t}</span>}
                        </span>
                        {p.key === 'calls' && (
                          <span className="block text-[9.5px] leading-tight" style={{ color: COL.inkSoft }}>🚫 {v.none} no answer · 📩 {v.vm} vm</span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: isSel ? r.col : COL.inkSoft, opacity: .8 }} />
                    </span>
                  </button>
                  {/* plain-language conversion to the next stage */}
                  {next && (
                    <p className="pointer-events-none absolute z-10 w-[44%] text-right text-[10.5px] leading-tight"
                      style={{ right: '2.5%', top: `${(p.y + next.y) / 2 + (i === 0 ? 0.5 : -1.4)}%`, color: COL.inkSoft }}>
                      {drops[i].v === '—'
                        ? <i>{drops[i].none}</i>
                        : <><b style={{ color: COL.ink }}>{drops[i].v}</b> {drops[i].word}</>}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* under the scene */}
          <div className="px-4 pb-4 text-center">
            <p className="text-[11px]" style={{ color: COL.inkSoft }}><b style={{ color: COL.ink }}>tap a pool</b> to see its 14-day trend below</p>
            {winCount > 0 && <p className="fn-pop mt-1 text-sm font-semibold" style={{ color: COL.green }}>✨ {winCount} of 5 goals hit{winCount === 5 ? ' — full harvest!' : ''}</p>}
          </div>
        </div>

        {/* per-stage trend — tap a pool above to switch */}
        <div className="fn-reveal mb-5 rounded-2xl p-4" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest" style={{ color: COL.inkSoft }}>tap a pool above to switch</p>
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
          <span className="flex items-center gap-2 text-sm font-semibold"><Trophy className="h-4 w-4" style={{ color: COL.goldDeep }} /> Cohort scoreboard</span>
          <span className="text-xs" style={{ color: COL.inkSoft }}>{v.board[0]?.sold ? `${v.board[0].name} leads →` : 'view →'}</span>
        </button>
        {v.repeats > 0 && <p className="mt-3 text-center text-xs" style={{ color: COL.inkSoft }}>↻ {v.repeats} repeat purchase{v.repeats === 1 ? '' : 's'} this period</p>}
      </div>

      {boardOpen && (
        <div className="fixed inset-0 z-50" style={{ background: 'rgba(44,39,56,.45)' }} onClick={() => setBoardOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 max-h-[78vh] overflow-y-auto rounded-t-3xl p-5 pb-10" style={{ background: COL.bg }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold"><Trophy className="h-5 w-5" style={{ color: COL.goldDeep }} /> Scoreboard · {v.label}</h2>
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
