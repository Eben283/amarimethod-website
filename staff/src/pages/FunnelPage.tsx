import { useState, useEffect, useCallback } from 'react';
import { Loader2, TrendingUp, Phone, RefreshCw, AlertCircle } from 'lucide-react';
import { getFunnel, ApiError, type FunnelData, type FunnelCohort } from '../lib/api';

// Snapshot is generated out-of-band (funnel.mjs → KV); this page just renders it.

function fmtPct(n: number | undefined): string {
  return n === undefined ? '—' : `${Math.round(n * 100)}%`;
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Horizontal call bar: dropped (muted) | voicemail (amber) | conversation (green),
// scaled so the busiest cohort fills the track — lets you compare volume at a glance.
function CallBar({ row, scaleMax }: { row: FunnelCohort; scaleMax: number }) {
  const w = (n: number) => (scaleMax ? `${(n / scaleMax) * 100}%` : '0%');
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-amari-light-sand">
      <div className="bg-stone-300" style={{ width: w(row.dropped) }} title={`dropped ${row.dropped}`} />
      <div className="bg-amber-400" style={{ width: w(row.voicemail) }} title={`voicemail ${row.voicemail}`} />
      <div className="bg-emerald-500" style={{ width: w(row.conversation) }} title={`conversation ${row.conversation}`} />
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-xl border border-amari-border bg-white p-3 text-center">
      <div className="text-2xl font-semibold text-amari-charcoal">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-amari-text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-amari-text-muted">{sub}</div>}
    </div>
  );
}

export default function FunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await getFunnel());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load funnel');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amari-charcoal" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-amari-text-muted" />
        <p className="text-amari-text-muted">{error}</p>
        <button onClick={load} className="rounded-lg border border-amari-border px-4 py-2 text-sm text-amari-charcoal">
          Try again
        </button>
      </div>
    );
  }

  if (!data || data.empty || !data.cohorts) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <TrendingUp className="h-8 w-8 text-amari-text-muted" />
        <p className="font-medium text-amari-charcoal">No funnel snapshot yet</p>
        <p className="max-w-xs text-sm text-amari-text-muted">
          Run <code className="rounded bg-amari-light-sand px-1">funnel.mjs</code> and publish it to KV to populate this view.
        </p>
      </div>
    );
  }

  const { dailyPulse = [], cohorts = [], totals, rates, repurchasers, targetMonthly } = data;
  const scaleMax = Math.max(1, ...cohorts.map((c) => c.calls));
  const pulseMax = Math.max(1, ...dailyPulse.map((d) => d.calls));
  const callsTotal = dailyPulse.reduce((s, d) => s + d.calls, 0);
  const perDay = dailyPulse.length ? (callsTotal / dailyPulse.length).toFixed(1) : '0';

  return (
    <div className="mx-auto max-w-2xl px-4 pb-6 pt-5">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-amari-charcoal">
            <TrendingUp className="h-5 w-5" /> Funnel
          </h1>
          <p className="text-xs text-amari-text-muted">
            last {data.windowDays}d · snapshot {fmtAgo(data.generatedAt)}
          </p>
        </div>
        <button onClick={load} className="rounded-lg border border-amari-border p-2 text-amari-text-muted" aria-label="Reload">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* headline: 8-packs vs target */}
      <div className="mb-4 rounded-xl border border-amari-border bg-white p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-semibold text-amari-charcoal">{totals?.eightPack ?? 0}</div>
            <div className="text-xs font-medium uppercase tracking-wide text-amari-text-muted">8-packs · this window</div>
          </div>
          <div className="text-right text-xs text-amari-text-muted">
            target<br />
            <span className="text-sm font-medium text-amari-charcoal">
              {targetMonthly ? `${targetMonthly[0]}–${targetMonthly[1]}/mo` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* daily call pulse */}
      <div className="mb-4 rounded-xl border border-amari-border bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-amari-charcoal">
            <Phone className="h-4 w-4" /> Daily calls
          </span>
          <span className="text-xs text-amari-text-muted">~{perDay}/day · {dailyPulse.length}d</span>
        </div>
        <div className="flex h-16 items-end gap-1">
          {dailyPulse.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.calls}`}>
              <div
                className="w-full rounded-sm bg-amari-accent-warm"
                style={{ height: `${Math.max(3, (d.calls / pulseMax) * 56)}px` }}
              />
              <span className="text-[9px] text-amari-text-muted">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* cohort funnel */}
      <div className="mb-4 rounded-xl border border-amari-border bg-white p-4">
        <h2 className="mb-1 text-sm font-medium text-amari-charcoal">Cohorts</h2>
        <div className="mb-3 flex items-center gap-3 text-[10px] text-amari-text-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-stone-300" /> dropped</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> voicemail</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> conversation</span>
        </div>
        <div className="space-y-3">
          {cohorts.map((c) => (
            <div key={c.cohort} className={c.calls === 0 && c.giftedBooked === 0 && c.eightPack === 0 ? 'opacity-40' : ''}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-amari-charcoal">{c.cohort}</span>
                <span className="text-amari-text-muted">
                  {c.calls} calls · {c.conversation} convo →{' '}
                  <span className="text-amari-charcoal">{c.giftedShowed} sess</span> →{' '}
                  <span className="font-semibold text-emerald-700">{c.eightPack} 8pk</span>
                </span>
              </div>
              <CallBar row={c} scaleMax={scaleMax} />
            </div>
          ))}
        </div>
      </div>

      {/* key rates */}
      <div className="flex gap-2">
        <StatTile label="call → convo" value={fmtPct(rates?.callToConvo)} sub={`${totals?.conversation ?? 0}/${totals?.calls ?? 0}`} />
        <StatTile label="show rate" value={fmtPct(rates?.bookedToShowed)} sub={`${totals?.giftedShowed ?? 0}/${totals?.giftedBooked ?? 0}`} />
        <StatTile label="sess → 8pk" value={fmtPct(rates?.showedToEightPack)} sub={`${totals?.eightPack ?? 0}/${totals?.giftedShowed ?? 0}`} />
      </div>
      {repurchasers !== undefined && (
        <p className="mt-3 text-center text-xs text-amari-text-muted">{repurchasers} repurchaser{repurchasers === 1 ? '' : 's'} (2+ series)</p>
      )}
    </div>
  );
}
