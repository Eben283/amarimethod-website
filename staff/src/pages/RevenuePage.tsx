import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStaffRevenue } from '../lib/api';
import type { StaffRevenueData, StaffRevenueMonth } from '../lib/api';

const periods = [6, 12, 24] as const;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const moneyExact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthLabel(month: string, withYear = false) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', ...(withYear ? { year: '2-digit' } : {}) })
    .format(new Date(`${month}-15T12:00:00Z`));
}

function chartGeometry(trend: StaffRevenueMonth[]) {
  const width = Math.max(680, trend.length * 58);
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 58;
  const height = 306;
  const max = Math.max(...trend.map((point) => point.gross), 1);
  const roundedMax = Math.ceil(max / 500) * 500;
  const x = (index: number) => left + ((width - left - right) * index) / Math.max(1, trend.length - 1);
  const y = (amount: number) => top + (height - top - bottom) * (1 - amount / roundedMax);
  return { width, height, left, right, top, bottom, max: roundedMax, x, y };
}

export default function RevenuePage() {
  const navigate = useNavigate();
  const [months, setMonths] = useState<(typeof periods)[number]>(12);
  const [data, setData] = useState<StaffRevenueData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (period: number) => {
    try {
      setLoading(true);
      setError(false);
      const next = await getStaffRevenue(period);
      setData(next);
      setSelectedMonth(next.thisMonth.month);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(months); }, [load, months]);

  const selected = data?.trend.find((point) => point.month === selectedMonth) || data?.thisMonth;
  const chart = useMemo(() => data ? chartGeometry(data.trend) : null, [data]);
  const line = useMemo(() => data && chart
    ? data.trend.map((point, index) => `${index ? 'L' : 'M'} ${chart.x(index).toFixed(2)} ${chart.y(point.gross).toFixed(2)}`).join(' ')
    : '', [data, chart]);
  const area = useMemo(() => chart && line ? `${line} L ${chart.x(data!.trend.length - 1)} ${chart.height - chart.bottom} L ${chart.x(0)} ${chart.height - chart.bottom} Z` : '', [chart, data, line]);

  function changePeriod(period: (typeof periods)[number]) {
    setMonths(period);
  }

  return (
    <main className="staff-revenue-page">
      <header className="staff-revenue-page__header">
        <button type="button" onClick={() => navigate('/')} className="staff-revenue-page__back"><ArrowLeft aria-hidden="true" /> Operations</button>
        <div>
          <p>Stripe revenue</p>
          <h1>Sales over time</h1>
          <span>Successful charges, grouped in Pacific time.</span>
        </div>
        <div className="staff-revenue-page__range" aria-label="Revenue chart period">
          {periods.map((period) => <button key={period} type="button" onClick={() => changePeriod(period)} aria-pressed={months === period}>{period} mo</button>)}
        </div>
      </header>

      {loading ? (
        <section className="staff-revenue-page__state"><Loader2 aria-hidden="true" /> Loading Stripe revenue…</section>
      ) : error || !data || !selected || !chart ? (
        <section className="staff-revenue-page__state staff-revenue-page__state--error">
          <span>Stripe revenue is unavailable.</span>
          <button type="button" onClick={() => void load(months)}><RefreshCw aria-hidden="true" /> Try again</button>
        </section>
      ) : (
        <>
          <section className="staff-revenue-hero" aria-label={`${monthLabel(selected.month, true)} Stripe revenue`}>
            <div>
              <p>{monthLabel(selected.month, true)} gross sales</p>
              <strong>{money.format(selected.gross)}</strong>
              <span>Select any point on the chart for that month’s details.</span>
            </div>
            <dl>
              <div><dt>Successful charges</dt><dd>{selected.chargeCount}</dd></div>
              <div><dt>Stripe fees</dt><dd>{moneyExact.format(selected.fees)}</dd></div>
              <div><dt>Net revenue</dt><dd>{moneyExact.format(selected.net)}</dd></div>
            </dl>
          </section>

          <section className="staff-revenue-plot" aria-label="Monthly gross Stripe revenue chart">
            <div className="staff-revenue-plot__scroll">
              <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${months}-month gross-sales chart. Select a month point for its exact amount.`}>
                {[chart.max, chart.max / 2, 0].map((amount) => (
                  <g key={amount}>
                    <line x1={chart.left} x2={chart.width - chart.right} y1={chart.y(amount)} y2={chart.y(amount)} className="staff-revenue-plot__grid" />
                    <text x={chart.left - 12} y={chart.y(amount) + 4} className="staff-revenue-plot__axis" textAnchor="end">{money.format(amount)}</text>
                  </g>
                ))}
                <path d={area} className="staff-revenue-plot__area" />
                <path d={line} className="staff-revenue-plot__line" />
                {data.trend.map((point, index) => {
                  const active = selected.month === point.month;
                  return <g key={point.month} className={`staff-revenue-plot__point${active ? ' is-active' : ''}`} role="button" tabIndex={0}
                    aria-label={`${monthLabel(point.month, true)}: ${moneyExact.format(point.gross)} gross`} onClick={() => setSelectedMonth(point.month)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedMonth(point.month); } }}>
                    <circle cx={chart.x(index)} cy={chart.y(point.gross)} r="14" className="staff-revenue-plot__hit" />
                    <circle cx={chart.x(index)} cy={chart.y(point.gross)} r={active ? 6 : 4.5} className="staff-revenue-plot__dot" />
                    <title>{`${monthLabel(point.month, true)} · ${moneyExact.format(point.gross)} gross`}</title>
                    <text x={chart.x(index)} y={chart.height - 24} className="staff-revenue-plot__month" textAnchor="middle">{monthLabel(point.month, months > 12)}</text>
                  </g>;
                })}
              </svg>
            </div>
          </section>

          <section className="staff-revenue-table" aria-label="Monthly Stripe revenue">
            <header><p>Month by month</p><span>Gross · fees · net</span></header>
            <div>{data.trend.slice().reverse().map((point) => <button key={point.month} type="button" className={selected.month === point.month ? 'is-active' : ''} onClick={() => setSelectedMonth(point.month)}>
              <span>{monthLabel(point.month, true)}</span><strong>{moneyExact.format(point.gross)}</strong><small>{moneyExact.format(point.fees)} fees · {moneyExact.format(point.net)} net</small>
            </button>)}</div>
          </section>
        </>
      )}
    </main>
  );
}
