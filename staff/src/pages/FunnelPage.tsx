import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Loader2, TrendingUp, RefreshCw, AlertCircle, ChevronLeft, ChevronRight,
  Phone, Trophy, X,
} from 'lucide-react';
import {
  getFunnel, ApiError,
  type FunnelData, type FunnelCallEvent, type FunnelSessionEvent, type FunnelSaleEvent,
} from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// FUNNEL v2 — "are we on pace?" scoreboard.
// Goal: 8 eight-packs/month, measured in SESSIONS SOLD (64/mo). Every sale
// fills the boxes proportionally: 8-pack = 1 box, 4-pack = ½, single = ⅛.
// Snapshot ships raw events; all range slicing happens here.

type RangeUnit = 'week' | 'month' | 'quarter';
interface Range { unit: RangeUnit; offset: number }

const GOAL_PACKS: Record<RangeUnit, number> = { week: 2, month: 8, quarter: 24 };

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── date helpers (local time; events carry Pacific YYYY-MM-DD strings) ──────
const toStr = (d: Date) => d.toLocaleDateString('en-CA');
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function rangeBounds({ unit, offset }: Range): { start: Date; end: Date; label: string } {
  const now = new Date();
  if (unit === 'week') {
    const dow = (now.getDay() + 6) % 7; // Monday-start
    const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow), offset * 7);
    const end = addDays(start, 7);
    const last = addDays(end, -1);
    const label = start.getMonth() === last.getMonth()
      ? `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}–${last.getDate()}`
      : `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTHS_SHORT[last.getMonth()]} ${last.getDate()}`;
    return { start, end, label };
  }
  if (unit === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end, label: `${MONTHS[start.getMonth()]} ${start.getFullYear()}` };
  }
  const q = Math.floor(now.getMonth() / 3) + offset;
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
  return { start, end, label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}` };
}

// ── tiny count-up for the hero number ────────────────────────────────────────
function useCountUp(target: number, replayKey: string, dur = 900): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf: number;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, replayKey]);
  return val;
}

function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── confetti (hand-rolled, fires once when the goal is hit) ─────────────────
function Confetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.6 + Math.random() * 1.2,
      color: ['#EBA584', '#2E9E6E', '#F0C95C', '#fff', '#D98E5F'][i % 5],
      size: 6 + Math.random() * 6,
      spin: Math.random() > 0.5 ? 1 : -1,
    })), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="fn-confetti absolute block"
          style={{
            left: `${p.left}%`, top: '-12px',
            width: p.size, height: p.size * 0.45,
            background: p.color, borderRadius: 2,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ['--spin' as string]: `${p.spin * (360 + Math.random() * 360)}deg`,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ unit: 'month', offset: 0 });
  const [boardOpen, setBoardOpen] = useState(false);
  const [filled, setFilled] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setData(await getFunnel()); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to load funnel'); }
    finally { setIsLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rangeKey = `${range.unit}:${range.offset}`;

  // replay the box-fill animation whenever the range (or data) changes
  useEffect(() => {
    setFilled(false);
    const t = setTimeout(() => setFilled(true), 80);
    return () => clearTimeout(t);
  }, [rangeKey, data]);

  // ── slice events into the selected range ──────────────────────────────────
  const view = useMemo(() => {
    if (!data?.calls) return null;
    const { start, end, label } = rangeBounds(range);
    const startStr = toStr(start), endStr = toStr(end);
    const inR = (d: string) => d >= startStr && d < endStr;

    const calls = (data.calls || []).filter((e) => inR(e.d));
    const sessions = (data.sessions || []).filter((e) => inR(e.d));
    const sales = (data.sales || []).filter((e) => inR(e.d));

    const spp = data.goal?.sessionsPerPack ?? 8;
    const goalPacks = GOAL_PACKS[range.unit];
    const sessionsSold = sales.reduce((t, s) => t + s.s, 0);
    const equivs = sessionsSold / spp;

    const todayStr = toStr(new Date());
    const isCurrent = range.offset === 0;
    const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const elapsedDays = isCurrent
      ? Math.min(totalDays, Math.round((Date.now() - start.getTime()) / 86_400_000) + 1)
      : totalDays;
    const daysLeft = isCurrent ? Math.max(0, totalDays - elapsedDays + 1) : 0;

    const cpe = data.trailing90?.callsPerEquiv ?? null;
    const remaining = Math.max(0, goalPacks - equivs);
    const needCallsPerDay = isCurrent && cpe && remaining > 0 && daysLeft > 0
      ? Math.max(1, Math.round((remaining * cpe) / daysLeft)) : null;

    // pace status
    let status: { word: string; dot: string; text: string };
    if (equivs >= goalPacks) status = { word: isCurrent ? 'GOAL HIT' : 'HIT', dot: '#34d399', text: 'text-emerald-300' };
    else if (!isCurrent) status = { word: 'MISSED', dot: '#a8a29e', text: 'text-stone-400' };
    else {
      const expected = goalPacks * (elapsedDays / totalDays);
      const ratio = expected > 0 ? equivs / expected : 1;
      if (ratio >= 1.05) status = { word: 'AHEAD', dot: '#F0C95C', text: 'text-yellow-300' };
      else if (ratio >= 0.85) status = { word: 'ON PACE', dot: '#34d399', text: 'text-emerald-300' };
      else status = { word: 'BEHIND', dot: '#fbbf24', text: 'text-amber-300' };
    }

    // funnel stages
    const talk = calls.filter((c) => c.o === 'talk').length;
    const vm = calls.filter((c) => c.o === 'vm').length;
    const none = calls.filter((c) => c.o === 'none').length;
    const booked = sessions.length;
    const showed = sessions.filter((s) => s.showed).length;

    // last-14-days pulse + today
    const pulse: { d: string; n: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = toStr(addDays(new Date(), -i));
      pulse.push({ d, n: (data.calls || []).filter((c) => c.d === d).length });
    }
    const callsToday = pulse[pulse.length - 1]?.n ?? 0;

    // cohort scoreboard
    const cohorts = new Map<string, { sold: number; talk: number; booked: number; showed: number; sales: number }>();
    const row = (c: string) => {
      if (!cohorts.has(c)) cohorts.set(c, { sold: 0, talk: 0, booked: 0, showed: 0, sales: 0 });
      return cohorts.get(c)!;
    };
    calls.forEach((c) => { if (c.o === 'talk') row(c.c).talk++; });
    sessions.forEach((s) => { row(s.c).booked++; if (s.showed) row(s.c).showed++; });
    sales.forEach((s) => { const r = row(s.c); r.sold += s.s; r.sales++; });
    const board = [...cohorts.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.sold - a.sold || b.talk - a.talk);

    const repeats = sales.filter((s) => s.r).length;

    return {
      label, isCurrent, daysLeft, goalPacks, spp,
      sessionsSold, equivs, remaining, needCallsPerDay, status,
      calls: calls.length, none, vm, talk, booked, showed,
      salesCount: sales.length, repeats, pulse, callsToday, board, todayStr,
    };
  }, [data, range]);

  const countUp = useCountUp(view?.equivs ?? 0, rangeKey);

  // ── states ────────────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-amari-charcoal" />
    </div>
  );
  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="h-8 w-8 text-amari-text-muted" />
      <p className="text-amari-text-muted">{error}</p>
      <button onClick={load} className="rounded-lg border border-amari-border px-4 py-2 text-sm text-amari-charcoal">Try again</button>
    </div>
  );
  if (!data || data.empty || !view || (data.v ?? 0) < 2) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <TrendingUp className="h-8 w-8 text-amari-text-muted" />
      <p className="font-medium text-amari-charcoal">No funnel snapshot yet</p>
      <p className="max-w-xs text-sm text-amari-text-muted">Run <code className="rounded bg-amari-light-sand px-1">funnel.mjs</code> and publish to KV.</p>
    </div>
  );

  const v = view;
  const goalHit = v.equivs >= v.goalPacks;
  const boxCols = v.goalPacks > 8 ? 8 : v.goalPacks;
  const maxPulse = Math.max(1, ...v.pulse.map((p) => p.n));

  // funnel bands: width %, color, text color
  const bands = [
    { label: 'calls', n: v.calls, w: 100, bg: '#3A3A3A', fg: '#fff' },
    { label: 'talked', n: v.talk, w: 77, bg: '#75655A', fg: '#fff' },
    { label: 'sessions booked', n: v.booked, w: 59, bg: '#C9805A', fg: '#fff' },
    { label: 'showed', n: v.showed, w: 45, bg: '#EBA584', fg: '#3A3A3A' },
    { label: v.salesCount === 1 ? 'sale' : 'sales', n: v.salesCount, w: 34, bg: '#2E9E6E', fg: '#fff' },
  ];
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  const dropNotes = [
    `${pct(v.talk, v.calls)} talked`,
    `${pct(v.booked, v.talk)} booked`,
    `${pct(v.showed, v.booked)} showed`,
    `${pct(v.salesCount, v.showed)} bought`,
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-5">
      <style>{`
        @keyframes fn-band-in { from { opacity: 0; transform: translateY(10px) scaleX(.9); } to { opacity: 1; transform: none; } }
        @keyframes fn-pop { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
        @keyframes fn-glowpulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes fn-fall {
          0% { transform: translateY(-12px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(420px) rotate(var(--spin, 540deg)); opacity: 0; }
        }
        .fn-confetti { animation: fn-fall linear forwards; }
        .fn-band { animation: fn-band-in .5s cubic-bezier(.22,1,.36,1) both; }
        .fn-box-full { animation: fn-pop .45s ease-out both; }
        .fn-partial { animation: fn-glowpulse 2.2s ease-in-out infinite; }
      `}</style>

      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-amari-charcoal">Funnel</h1>
          <p className="text-xs text-amari-text-muted">updated {agoLabel(data.generatedAt)} · refreshes every morning</p>
        </div>
        <button onClick={load} aria-label="Reload" className="rounded-xl border border-amari-border bg-white p-2.5 text-amari-text-muted active:scale-95">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* range control */}
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => setRange((r) => ({ ...r, offset: r.offset - 1 }))} aria-label="Previous period"
          className="rounded-xl border border-amari-border bg-white p-2 text-amari-charcoal active:scale-95">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 overflow-hidden rounded-xl border border-amari-border bg-white text-sm">
          {(['week', 'month', 'quarter'] as RangeUnit[]).map((u) => (
            <button key={u} onClick={() => setRange({ unit: u, offset: 0 })}
              className={`flex-1 py-2 font-medium capitalize transition-colors ${range.unit === u ? 'bg-amari-charcoal text-white' : 'text-amari-text-muted'}`}>
              {u}
            </button>
          ))}
        </div>
        <button onClick={() => setRange((r) => ({ ...r, offset: Math.min(0, r.offset + 1) }))} aria-label="Next period"
          disabled={range.offset >= 0}
          className="rounded-xl border border-amari-border bg-white p-2 text-amari-charcoal disabled:opacity-30 active:scale-95">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── HERO: the boxes ── */}
      <div ref={heroRef} className="relative mb-4 overflow-hidden rounded-3xl p-5 shadow-lg"
        style={{ background: 'linear-gradient(150deg, #2E2A26 0%, #3A3A3A 70%, #443C33 100%)' }}>
        {goalHit && v.isCurrent && <Confetti />}

        <div className="mb-1 flex items-start justify-between">
          <span className="font-serif text-sm tracking-wide text-stone-400">{v.label}</span>
          <span className={`flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold tracking-widest ${v.status.text}`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: v.status.dot }} />
            {v.status.word}{goalHit && ' 🎉'}
          </span>
        </div>

        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-serif text-6xl font-bold leading-none text-white tabular-nums">
            {countUp.toFixed(1)}
          </span>
          <span className="font-serif text-2xl text-stone-400">/ {v.goalPacks}</span>
          <span className="mb-0.5 self-end text-xs font-medium uppercase tracking-widest text-stone-400">packs</span>
        </div>

        {/* the boxes */}
        <div className="mb-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${boxCols}, minmax(0, 1fr))` }}>
          {Array.from({ length: v.goalPacks }, (_, i) => {
            const fill = Math.max(0, Math.min(1, v.equivs - i));
            const full = fill >= 0.999;
            const partial = fill > 0 && !full;
            return (
              <div key={`${rangeKey}-${i}`}
                className={`relative aspect-square overflow-hidden rounded-lg ${full && filled ? 'fn-box-full' : ''}`}
                style={{
                  border: full ? '1px solid rgba(235,165,132,.9)' : '1px solid rgba(255,255,255,.18)',
                  background: 'rgba(255,255,255,.05)',
                  animationDelay: `${i * 90}ms`,
                  boxShadow: full ? '0 0 14px rgba(235,165,132,.35)' : 'none',
                }}>
                <div className={`absolute inset-x-0 bottom-0 ${partial ? 'fn-partial' : ''}`}
                  style={{
                    height: filled ? `${fill * 100}%` : '0%',
                    background: 'linear-gradient(180deg, #F2BD9C 0%, #EBA584 45%, #D98E5F 100%)',
                    transition: 'height .7s cubic-bezier(.22,1,.36,1)',
                    transitionDelay: `${i * 90}ms`,
                  }} />
              </div>
            );
          })}
        </div>

        <p className="mb-3 text-center text-[11px] text-stone-400">
          {v.sessionsSold} of {v.goalPacks * v.spp} sessions sold · each box = one 8-pack
        </p>

        {(v.isCurrent && !goalHit) && (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-white/[.07] px-3 py-2.5 text-center text-sm text-stone-200">
            <span><b className="text-white">{v.remaining.toFixed(1)}</b> to go</span>
            <span className="text-stone-500">·</span>
            <span><b className="text-white">{v.daysLeft}</b> day{v.daysLeft === 1 ? '' : 's'} left</span>
            {v.needCallsPerDay && (<>
              <span className="text-stone-500">·</span>
              <span>~<b className="text-white">{v.needCallsPerDay}</b> calls/day</span>
            </>)}
          </div>
        )}
        {goalHit && (
          <div className="rounded-xl bg-emerald-500/15 px-3 py-2.5 text-center text-sm font-medium text-emerald-300">
            Goal hit — every box full. 🏆
          </div>
        )}
      </div>

      {/* ── calls today ── */}
      <div className="mb-4 rounded-2xl border border-amari-border bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amari-charcoal">
            <Phone className="h-4 w-4 text-amari-accent-warm" /> Calls today
          </span>
          <span className="text-sm tabular-nums">
            <b className="text-xl font-serif text-amari-charcoal">{v.callsToday}</b>
            {v.needCallsPerDay && <span className="text-amari-text-muted"> / ~{v.needCallsPerDay}</span>}
          </span>
        </div>
        {v.needCallsPerDay && (
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-amari-light-sand">
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, (v.callsToday / v.needCallsPerDay) * 100)}%`,
                background: v.callsToday >= v.needCallsPerDay ? '#2E9E6E' : '#EBA584',
              }} />
          </div>
        )}
        <div className="flex h-9 items-end gap-[3px]">
          {v.pulse.map((p) => (
            <div key={p.d} title={`${p.d}: ${p.n}`}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(8, (p.n / maxPulse) * 100)}%`,
                background: p.d === v.todayStr ? '#EBA584' : '#E8DFD4',
              }} />
          ))}
        </div>
        <p className="mt-1 text-right text-[10px] text-amari-text-muted">last 14 days</p>
      </div>

      {/* ── the funnel ── */}
      <div className="mb-4 rounded-2xl border border-amari-border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-amari-charcoal">{v.label} flow</h2>
        <div key={rangeKey} className="flex flex-col items-center">
          {bands.map((b, i) => {
            const next = bands[i + 1];
            const ratio = next ? next.w / b.w : 0.82;
            const inset = ((1 - ratio) / 2) * 100;
            return (
              <div key={b.label} className="flex w-full flex-col items-center">
                <div className="fn-band flex items-center justify-center gap-2 py-2.5"
                  style={{
                    width: `${b.w}%`, background: b.bg, color: b.fg,
                    clipPath: `polygon(0 0, 100% 0, ${100 - inset}% 100%, ${inset}% 100%)`,
                    animationDelay: `${i * 110}ms`,
                  }}>
                  <span className="font-serif text-lg font-bold tabular-nums">{b.n}</span>
                  <span className="text-[11px] font-medium uppercase tracking-wider opacity-90">{b.label}</span>
                </div>
                {i === 0 && (
                  <div className="fn-band flex gap-2 py-1 text-[11px] text-amari-text-muted" style={{ animationDelay: '60ms' }}>
                    <span>🚫 {v.none} no answer</span>
                    <span>·</span>
                    <span>📩 {v.vm} voicemail</span>
                  </div>
                )}
                {next && (
                  <div className="fn-band py-0.5 text-[11px] font-medium text-amari-text-muted" style={{ animationDelay: `${i * 110 + 55}ms` }}>
                    ↓ {dropNotes[i]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-center text-[10px] text-amari-text-muted">
          sales include direct & repeat buyers · calls = tracked GHL line
        </p>
      </div>

      {/* ── scoreboard launcher ── */}
      <button onClick={() => setBoardOpen(true)}
        className="flex w-full items-center justify-between rounded-2xl border border-amari-border bg-white p-4 active:scale-[.99]">
        <span className="flex items-center gap-2 text-sm font-semibold text-amari-charcoal">
          <Trophy className="h-4 w-4 text-amari-accent-warm" /> Cohort scoreboard
        </span>
        <span className="text-xs text-amari-text-muted">
          {v.board[0]?.sold ? `${v.board[0].name} leads →` : 'view →'}
        </span>
      </button>

      {v.repeats > 0 && (
        <p className="mt-3 text-center text-xs text-amari-text-muted">↻ {v.repeats} repeat purchase{v.repeats === 1 ? '' : 's'} in this period</p>
      )}

      {/* ── scoreboard sheet ── */}
      {boardOpen && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setBoardOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 max-h-[75vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 safe-area-bottom"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-amari-charcoal">
                <Trophy className="h-5 w-5 text-amari-accent-warm" /> Scoreboard · {v.label}
              </h2>
              <button onClick={() => setBoardOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-amari-text-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            {v.board.length === 0 && <p className="py-6 text-center text-sm text-amari-text-muted">No activity in this period.</p>}
            <div className="space-y-3">
              {v.board.map((c, i) => {
                const lead = Math.max(1, v.board[0]?.sold || 0);
                const medal = c.sold > 0 ? ['🥇', '🥈', '🥉'][i] ?? '·' : '·';
                return (
                  <div key={c.name} className={`rounded-2xl border p-3 ${i === 0 && c.sold > 0 ? 'border-amari-accent-warm bg-amari-light-sand' : 'border-amari-border'}`}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-semibold text-amari-charcoal">
                        <span className="w-5 text-base">{medal}</span>{c.name}
                      </span>
                      <span className="text-sm tabular-nums text-amari-charcoal">
                        <b className="font-serif text-lg">{c.sold}</b>
                        <span className="text-xs text-amari-text-muted"> sessions sold</span>
                      </span>
                    </div>
                    <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-amari-light-sand">
                      <div className="h-full rounded-full bg-gradient-to-r from-amari-accent-warm to-[#D98E5F] transition-all duration-700"
                        style={{ width: `${(c.sold / lead) * 100}%` }} />
                    </div>
                    <p className="text-[11px] text-amari-text-muted">
                      {c.talk} talked · {c.booked} booked · {c.showed} showed · {c.sales} sale{c.sales === 1 ? '' : 's'}
                    </p>
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
