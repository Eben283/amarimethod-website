import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Trophy, X, User } from 'lucide-react';
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

    const pulse: { d: string; n: number }[] = [];
    for (let i = 13; i >= 0; i--) { const d = toStr(addDays(new Date(), -i)); pulse.push({ d, n: (data.calls || []).filter((c) => c.d === d).length }); }
    const callsToday = (data.calls || []).filter((c) => c.d === toStr(new Date())).length;

    const cohorts = new Map<string, { sold: number; talk: number; booked: number; showed: number; sales: number }>();
    const row = (c: string) => { if (!cohorts.has(c)) cohorts.set(c, { sold: 0, talk: 0, booked: 0, showed: 0, sales: 0 }); return cohorts.get(c)!; };
    calls.forEach((c) => { if (c.o === 'talk') row(c.c).talk++; });
    sessions.forEach((s) => { row(s.c).booked++; if (s.showed) row(s.c).showed++; });
    sales.forEach((s) => { const r = row(s.c); r.sold += s.s; r.sales++; });
    const board = [...cohorts.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sold - a.sold || b.talk - a.talk);
    const repeats = sales.filter((s) => s.r).length;

    return { label, isDay, isCurrent, daysLeft, goalPacks, spp, sessionsSold, equivs, remaining, needCallsPerDay, status,
      callsN: calls.length, none, vm, talk, booked, showed, salesCount: sales.length, repeats, pulse, callsToday, board };
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
  const maxPulse = Math.max(1, ...v.pulse.map((p) => p.n));
  const todayStr = toStr(new Date());

  // five funnel rings, widest → narrowest, mapped to the real stages
  const rings = [
    { key: 'calls',  label: 'calls',           n: v.callsN, w: 100, col: COL.plum },
    { key: 'talked', label: 'talked',          n: v.talk,   w: 82,  col: COL.maroon },
    { key: 'booked', label: 'booked',          n: v.booked, w: 64,  col: COL.rust },
    { key: 'showed', label: 'showed',          n: v.showed, w: 48,  col: COL.ember },
    { key: 'sales',  label: v.salesCount === 1 ? 'sale' : 'sales', n: v.salesCount, w: 34, col: COL.gold },
  ];
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
  const drops = [
    { v: pct(v.talk, v.callsN), word: 'of calls were answered', none: 'no calls yet' },
    { v: pct(v.booked, v.talk), word: 'of talks booked a session', none: 'no one answered yet' },
    { v: pct(v.showed, v.booked), word: 'of bookings showed up', none: 'no bookings yet' },
    { v: pct(v.salesCount, v.showed), word: 'of shows bought a pack', none: 'no one has shown yet' },
  ];
  // coins to drop out the bottom = sales (cap visual at 6)
  const coins = Math.min(6, Math.max(v.salesCount, 0));

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
          <p className="-mt-2 mb-4 text-center text-xs" style={{ color: COL.inkSoft }}><b style={{ color: COL.ink }}>{v.remaining.toFixed(1)}</b> packs to go · <b style={{ color: COL.ink }}>{v.daysLeft}</b> day{v.daysLeft === 1 ? '' : 's'} left{v.needCallsPerDay && <> · aim <b style={{ color: COL.ink }}>~{v.needCallsPerDay}</b> calls/day</>}</p>
        )}

        {/* ── THE FUNNEL: people in, money out ── */}
        <div className="fn-reveal relative mb-5 overflow-hidden rounded-3xl px-4 pb-6 pt-3" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          {/* leads pouring in */}
          <div className="relative mx-auto h-14" style={{ width: '60%' }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="fn-pour absolute flex h-7 w-7 items-center justify-center rounded-full"
                style={{ left: `${12 + i * 24}%`, top: 0, background: i % 2 ? COL.gold : COL.plum, color: i % 2 ? COL.plum : '#fff', animationDelay: `${i * 0.65}s` }}>
                <User className="h-4 w-4" strokeWidth={2.4} />
              </span>
            ))}
          </div>

          {/* funnel rings */}
          <div key={rangeKey} className="relative flex flex-col items-center">
            {rings.map((r, i) => (
              <div key={r.key} className="flex w-full flex-col items-center">
                <div className="fn-ring relative flex items-center justify-center" style={{ width: `${r.w}%`, animationDelay: `${i * 110}ms` }}>
                  {/* the band */}
                  <div className="relative w-full" style={{ height: 46 }}>
                    <div className="absolute inset-0 rounded-[50%/22px]" style={{ background: r.col, boxShadow: 'inset 0 -7px 0 rgba(0,0,0,.14), inset 0 5px 0 rgba(255,255,255,.18)' }} />
                    <div className="absolute inset-0 flex items-center justify-center gap-2" style={{ color: r.key === 'showed' || r.key === 'sales' ? COL.ink : '#fff' }}>
                      <span className="font-serif text-2xl font-bold tabular-nums">{r.n}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ opacity: .9 }}>{r.label}</span>
                    </div>
                  </div>
                </div>
                {i === 0 && <div className="py-1 text-[11px]" style={{ color: COL.inkSoft }}>🚫 {v.none} no answer · 📩 {v.vm} voicemail</div>}
                {i < 4 && (
                  <div className="my-1.5 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]" style={{ background: COL.bg, border: `1px solid ${COL.line}` }}>
                    <span aria-hidden style={{ color: COL.maroon }}>↓</span>
                    {drops[i].v === '—'
                      ? <span style={{ color: COL.inkSoft }}>{drops[i].none}</span>
                      : <span><b className="tabular-nums" style={{ color: COL.ink }}>{drops[i].v}</b> <span style={{ color: COL.inkSoft }}>{drops[i].word}</span></span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* money out the bottom */}
          <div className="relative mx-auto mt-1 h-16" style={{ width: '40%' }}>
            {coins === 0 ? (
              <p className="pt-5 text-center text-[11px]" style={{ color: COL.inkSoft }}>no packs out yet this period</p>
            ) : (
              Array.from({ length: coins }).map((_, i) => (
                <span key={i} className="fn-coin absolute flex h-8 w-8 items-center justify-center rounded-full font-bold"
                  style={{ left: `${8 + (i * 17) % 80}%`, top: 0, background: `radial-gradient(circle at 35% 30%, ${COL.gold}, ${COL.goldDeep})`, color: '#7A5A12', border: `1.5px solid ${COL.goldDeep}`, fontSize: 13, animationDelay: `${i * 0.4}s` }}>$</span>
              ))
            )}
          </div>
          <p className="mt-1 text-center text-[10px]" style={{ color: COL.inkSoft }}>{v.salesCount} sale{v.salesCount === 1 ? '' : 's'} · {v.sessionsSold} sessions · booked = bookings made in this period</p>
        </div>

        {/* calls pulse */}
        <div className="fn-reveal mb-5 rounded-2xl p-4" style={{ background: COL.card, border: `1px solid ${COL.line}` }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Calls today</span>
            <span className="text-sm tabular-nums"><b className="font-serif text-xl" style={{ color: COL.maroon }}>{v.callsToday}</b>{v.needCallsPerDay && <span style={{ color: COL.inkSoft }}> / ~{v.needCallsPerDay}</span>}</span>
          </div>
          <div className="flex h-10 items-end gap-[3px]">
            {v.pulse.map((p) => <div key={p.d} title={`${p.d}: ${p.n}`} className="flex-1 rounded-t-md transition-all" style={{ height: `${Math.max(8, (p.n / maxPulse) * 100)}%`, background: p.d === todayStr ? COL.ember : '#EBE2D6' }} />)}
          </div>
          <p className="mt-1 text-right text-[10px]" style={{ color: COL.inkSoft }}>last 14 days</p>
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
