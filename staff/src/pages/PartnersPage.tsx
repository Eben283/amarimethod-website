import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getPartnerProspects, ApiError } from '../lib/api';
import type {
  PartnerProspect,
  PartnerCategoryFilter,
  PartnerCategory,
  PartnerPipelineStage,
} from '../types/staff';

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

// Stale threshold for non-Partner cards (in days). Easy to tune here.
const STALE_DAYS_THRESHOLD = 14;

// Pipeline stages that count as "still in outreach" — staleness flag applies.
// "Partner" / "Future Potential" / "Not Interested" are endpoint stages.
const OUTREACH_STAGE_NAMES = new Set([
  'Unstaged',
  'New Lead',
  'Messaged',
  'Discovery Call Booked',     // TODO: rename in GHL UI to "Partner Call Booked"
  'Discovery Call Attended',   // TODO: rename in GHL UI to "Partner Call Held"
  'Partner Session Booked',
]);

const ENDPOINT_STAGE_NAMES = new Set([
  'Partner',
  'Future Potential',
  'Not Interested',
]);

const FILTERS: { id: PartnerCategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'golf', label: 'Golf' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'trainer', label: 'Personal Trainer' },
];

const CATEGORY_BADGE: Record<PartnerCategory, string> = {
  golf: 'bg-emerald-100 text-emerald-900',
  tennis: 'bg-amber-100 text-amber-900',
  trainer: 'bg-sky-100 text-sky-900',
  unknown: 'bg-gray-100 text-gray-700',
};

// v0: outcomes are UI-only stubs. Slice 2 wires real GHL writes.
const OUTCOME_OPTIONS: { id: string; label: string }[] = [
  { id: 'no-answer', label: 'No answer' },
  { id: 'voicemail', label: 'Voicemail' },
  { id: 'talked', label: 'Talked' },
  { id: 'booked', label: 'Booked' },
  { id: 'not-interested', label: 'Not interested' },
];

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function touchLabel(iso: string | null): string {
  if (!iso) return 'never touched';
  const d = daysSince(iso);
  if (d === null) return 'never touched';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function ProspectCard({ prospect }: { prospect: PartnerProspect }) {
  const badgeClass = CATEGORY_BADGE[prospect.category];
  const stageName = prospect.pipelineStageName || 'Unstaged';
  const days = daysSince(prospect.lastActivityAt);
  const isOutreachStage = OUTREACH_STAGE_NAMES.has(stageName);
  const isStale =
    isOutreachStage &&
    (days === null || days >= STALE_DAYS_THRESHOLD);
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={`bg-white rounded-md border p-2.5 shadow-sm space-y-1.5 ${
        isStale ? 'border-red-300 border-l-2 border-l-red-500' : 'border-amari-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-amari-charcoal leading-tight">
          {prospect.fullName}
        </p>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${badgeClass}`}
        >
          {prospect.category === 'trainer' ? 'PT' : prospect.category}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-amari-text-muted">
        {isStale && (
          <span className="inline-flex items-center gap-0.5 text-red-700 font-medium">
            <AlertCircle className="w-3 h-3" />
            stale
          </span>
        )}
        <span className={isStale ? 'text-red-700' : ''}>{touchLabel(prospect.lastActivityAt)}</span>
      </div>

      <a
        href={ghlContactUrl(prospect.contactId)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopProp}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amari-charcoal text-white text-[11px] font-medium hover:opacity-90"
      >
        Open in GHL
        <ExternalLink className="w-2.5 h-2.5" />
      </a>

      <div className="flex flex-wrap gap-1 pt-1">
        {OUTCOME_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={stopProp}
            disabled
            title="Coming in slice 2 — needs GHL custom fields"
            className="px-1.5 py-0.5 rounded text-[10px] border border-amari-border text-amari-text-muted disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StageColumn({
  stage,
  prospects,
  isEndpoint,
}: {
  stage: PartnerPipelineStage;
  prospects: PartnerProspect[];
  isEndpoint: boolean;
}) {
  return (
    <div
      className={`shrink-0 w-64 rounded-lg p-2 ${
        isEndpoint ? 'bg-amari-light-sand/50' : 'bg-amari-light-sand'
      }`}
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <h3
          className={`text-xs font-semibold uppercase tracking-wide ${
            isEndpoint ? 'text-amari-text-muted' : 'text-amari-charcoal'
          }`}
        >
          {stage.name}
        </h3>
        <span className="text-[10px] text-amari-text-muted bg-white rounded-full px-1.5 py-0.5">
          {prospects.length}
        </span>
      </div>
      <div className="space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
        {prospects.length === 0 ? (
          <p className="text-[11px] text-amari-text-muted italic px-1 py-2">
            empty
          </p>
        ) : (
          prospects.map((p) => <ProspectCard key={p.contactId} prospect={p} />)
        )}
      </div>
    </div>
  );
}

export default function PartnersPage() {
  const { logout } = useAuth();

  const [filter, setFilter] = useState<PartnerCategoryFilter>('all');
  const [prospects, setProspects] = useState<PartnerProspect[]>([]);
  const [stages, setStages] = useState<PartnerPipelineStage[]>([]);
  const [counts, setCounts] = useState<Record<PartnerCategory, number>>({
    golf: 0,
    tennis: 0,
    trainer: 0,
    unknown: 0,
  });
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (f: PartnerCategoryFilter) => {
      setIsLoading(true);
      setError('');
      try {
        const data = await getPartnerProspects(f);
        setProspects(data.prospects);
        setStages(data.stages);
        setCounts(data.countsByCategory);
        setTotal(data.total);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load partners');
      } finally {
        setIsLoading(false);
      }
    },
    [logout],
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  // Group prospects by pipelineStageId (null = Unstaged).
  const prospectsByStage = useMemo(() => {
    const map = new Map<string | null, PartnerProspect[]>();
    for (const p of prospects) {
      const key = p.pipelineStageId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [prospects]);

  const filterCount = (f: PartnerCategoryFilter): number => {
    if (f === 'all') return total;
    return counts[f as PartnerCategory] ?? 0;
  };

  return (
    <div className="px-3 pt-3 pb-8">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-serif text-amari-charcoal">Partners</h1>
        <button
          onClick={() => load(filter)}
          disabled={isLoading}
          className="flex items-center gap-1 text-xs text-amari-text-muted hover:text-amari-charcoal disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-amari-charcoal text-white'
                  : 'bg-amari-light-sand text-amari-charcoal hover:bg-amari-light-sand/70'
              }`}
            >
              {f.label}
              {!isLoading && (
                <span className="ml-1.5 opacity-70">({filterCount(f.id)})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stale-threshold legend */}
      <p className="text-[11px] text-amari-text-muted mb-2 px-1">
        Cards in outreach stages with no activity in {STALE_DAYS_THRESHOLD}+ days are flagged{' '}
        <span className="inline-flex items-center gap-0.5 text-red-700 font-medium">
          <AlertCircle className="w-3 h-3" />
          stale
        </span>
        .
      </p>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {isLoading && prospects.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-amari-text-muted animate-spin" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-3 px-3">
          {stages.map((stage) => {
            const list = prospectsByStage.get(stage.id) || [];
            const isEndpoint = ENDPOINT_STAGE_NAMES.has(stage.name);
            return (
              <StageColumn
                key={stage.id ?? 'unstaged'}
                stage={stage}
                prospects={list}
                isEndpoint={isEndpoint}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
