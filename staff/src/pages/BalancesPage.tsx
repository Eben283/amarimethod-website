import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2, ChevronRight, AlertTriangle, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getBalances, getOwedList, getOwedStatus, ApiError, type OwedRow } from '../lib/api';
import type { BalanceRow } from '../types/staff';
import LedgerWarning from '../components/LedgerWarning';

type SortKey = 'remaining' | 'recent' | 'name';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'remaining', label: 'Remaining' },
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name' },
];

// Freshness badge — same "updated Xh/Xd ago" pattern as FunnelPage, so a
// broken/unloaded balances cache (staff:balances:v1, 5-min TTL — see
// staff-balances.js) is visible instead of silently showing an old number
// with no way to tell. This data shows literal money/session counts, so a
// stale-with-no-indicator display was the highest-priority gap found in the
// 2026-07-01 cron-job architecture audit.
function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function agoColorClass(iso: string | null | undefined): string {
  if (!iso) return 'text-red-500';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h >= 24) return 'text-red-500';
  if (h >= 6) return 'text-amber-600';
  return 'text-amari-text-muted';
}

function relativeDate(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function seriesLabel(seriesType: string): string {
  const map: Record<string, string> = {
    '4-session': '4-series',
    '8-session': '8-series',
    Single: 'Single',
    none: '—',
  };
  return map[seriesType] || seriesType;
}

export default function BalancesPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [ledgerSource, setLedgerSource] = useState<string>('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('remaining');
  const [query, setQuery] = useState('');
  // Stripe-grounded "who owes for sessions taken" — loads independently so a
  // Stripe hiccup never blocks the balances list.
  const [owedRows, setOwedRows] = useState<OwedRow[]>([]);
  const [owedLoading, setOwedLoading] = useState(true);
  const [owedError, setOwedError] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setIsLoading(true);
      setError('');
      try {
        const data = await getBalances(refresh);
        setRows(data.rows);
        setTotalRemaining(data.totalRemaining);
        setLedgerSource(data.ledgerSource);
        setGeneratedAt(data.generatedAt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setIsLoading(false);
      }
    },
    [logout],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { roster } = await getOwedList();
        // Resolve each client's owed status via the accurate (email-grounded)
        // per-client endpoint — each is its own request, so no single request
        // blows the subrequest budget.
        const resolved = await Promise.all(
          (roster || []).map(async (r) => {
            try {
              const o = await getOwedStatus(r.contactId);
              // Prefer the contact's real GHL name from the resolve over the
              // roster's title-parsed name (which can fall back to a contactId).
              return { ...r, ...o, name: o.name || r.name } as OwedRow;
            } catch {
              return { ...r, status: 'unavailable' } as OwedRow;
            }
          }),
        );
        if (!cancelled) setOwedRows(resolved);
      } catch {
        if (!cancelled) setOwedError(true);
      } finally {
        if (!cancelled) setOwedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const owing = useMemo(() => owedRows.filter((r) => r.status === 'owed'), [owedRows]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            (r.name ?? '').toLowerCase().includes(q) ||
            (r.email ?? '').toLowerCase().includes(q) ||
            (r.phone ?? '').toLowerCase().includes(q),
        )
      : rows;

    const sorted = [...filtered];
    if (sort === 'remaining') {
      sorted.sort((a, b) => b.remaining - a.remaining);
    } else if (sort === 'recent') {
      sorted.sort((a, b) => {
        const aD = a.lastSessionDate ? new Date(a.lastSessionDate).getTime() : 0;
        const bD = b.lastSessionDate ? new Date(b.lastSessionDate).getTime() : 0;
        return bD - aD;
      });
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [rows, query, sort]);

  const lowConfidenceCount = rows.filter((r) => r.confidence === 'low').length;

  return (
    <div className="px-4 pt-6 pb-4">
      <div className="staff-pagehead flex items-center justify-between">
        <h1 className="text-xl font-serif text-amari-charcoal">Balances</h1>
        <div className="flex items-center gap-2">
          {!isLoading && (
            <span className={`text-[11px] ${agoColorClass(generatedAt)}`}>
              {generatedAt ? `updated ${agoLabel(generatedAt)}` : 'no data yet'}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={isLoading}
            className="p-2 rounded-lg hover:bg-amari-light-sand min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-amari-text-muted ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary card */}
      <div className="staff-card mb-4 flex items-center justify-between">
        <div>
          <p className="staff-mlabel">Prepaid clients</p>
          <p className="text-2xl font-serif text-amari-charcoal">{rows.length}</p>
        </div>
        <div className="text-right">
          <p className="staff-mlabel">Sessions owed</p>
          <p className="text-2xl font-serif text-amari-accent-warm">{totalRemaining}</p>
        </div>
      </div>

      {/* Clients who owe for sessions they've taken — Stripe-grounded */}
      <div className="staff-card mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-amari-charcoal">Hasn't paid for a session</p>
          {owedLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-amari-text-muted" />
          ) : !owedError && owedRows.length > 0 ? (
            <span className="text-[11px] text-amari-text-muted">{owing.length} of {owedRows.length} clients</span>
          ) : null}
        </div>
        {owedLoading ? (
          <p className="text-xs text-amari-text-muted">Checking payments…</p>
        ) : owedError ? (
          <p className="text-xs text-amber-700">Couldn't check payments right now — try refreshing.</p>
        ) : owedRows.length === 0 ? (
          <p className="text-xs text-amari-text-muted">No recent clients to check.</p>
        ) : owing.length === 0 ? (
          <p className="text-xs text-amari-text-muted">All {owedRows.length} recent clients are paid up.</p>
        ) : (
          <div className="space-y-1">
            {owing.map((r) => (
              <button
                key={r.contactId}
                onClick={() => navigate(`/client/${r.contactId}`)}
                className="w-full text-left flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-amari-light-sand"
              >
                <span className="text-sm text-amari-charcoal truncate">{r.name}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-semibold text-red-600">
                    {r.shortBy} unpaid{r.confidence === 'medium' ? '?' : ''}
                  </span>
                  <ChevronRight className="w-4 h-4 text-amari-text-muted" />
                </span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-amari-text-muted mt-2">From Stripe · “?” = paid for some, double-check · tap a name for the breakdown</p>
      </div>

      {ledgerSource === 'custom-field-fallback' && lowConfidenceCount > 0 && (
        <div className="staff-card mb-4 flex items-start gap-2 bg-amber-50 border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800">
            Accurate ledger unavailable — showing values from custom fields. Numbers may be stale for{' '}
            <strong>{lowConfidenceCount}</strong> clients.
          </div>
        </div>
      )}

      {/* Search + sort */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-amari-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone"
            className="w-full pl-9 pr-3 py-2 text-sm border border-amari-border rounded-lg focus:outline-none focus:border-amari-accent-warm"
          />
        </div>
        <div className="flex bg-amari-light-sand rounded-lg p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                sort === s.id ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
        </div>
      ) : error ? (
        <div className="staff-card text-center py-8">
          <p className="text-red-500 text-sm mb-3">{error}</p>
          <button onClick={() => load(true)} className="staff-btn-secondary text-sm">
            Try Again
          </button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="staff-card text-center py-12">
          <p className="text-amari-text-muted text-sm">
            {query ? 'No matches' : 'No prepaid balances'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map((row) => (
            <BalanceRowCard
              key={row.id}
              row={row}
              onTap={() => navigate(`/client/${row.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BalanceRowCard({ row, onTap }: { row: BalanceRow; onTap: () => void }) {
  const highlight = row.remaining === 0 ? 'border-l-red-400' : row.remaining <= 2 ? 'border-l-amber-400' : 'border-l-amari-accent-warm';

  return (
    <button
      onClick={onTap}
      className={`staff-card-tap w-full text-left flex items-center gap-3 border-l-2 ${highlight}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-amari-charcoal truncate">{row.name}</p>
          {row.prepaidOverride && (
            <span className="staff-mlabel bg-amari-light-sand px-1.5 py-px rounded">
              manual
            </span>
          )}
          <LedgerWarning
            confidence={row.confidence}
            ambiguities={row.ambiguities}
            manualLock={row.manualLock}
            displaySource={row.displaySource}
            displayedRemaining={row.remaining}
            purchased={row.purchased ?? undefined}
            attended={row.attended}
          />
          {/* derivedRemaining is not exposed in the BalancesPage row shape
              because the API returns the display values directly. The
              hover still shows the displayed value + package math. */}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-amari-text-muted">
          <span>{seriesLabel(row.seriesType)}</span>
          <span>·</span>
          <span>last: {relativeDate(row.lastSessionDate)}</span>
          {row.purchased !== null && (
            <>
              <span>·</span>
              <span>
                {row.attended}/{row.purchased}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-lg font-serif text-amari-charcoal leading-none">{row.remaining}</p>
        <p className="staff-mlabel">left</p>
      </div>
      <ChevronRight className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
    </button>
  );
}
