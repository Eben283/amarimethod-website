import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2, ExternalLink, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getPartnerProspects, ApiError } from '../lib/api';
import type {
  PartnerProspect,
  PartnerCategoryFilter,
  PartnerCategory,
} from '../types/staff';

const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ghlContactUrl = (contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;

// v0: outcomes are UI-only stubs. Slice 2 wires real GHL writes.
const OUTCOME_OPTIONS: { id: string; label: string }[] = [
  { id: 'no-answer', label: 'No answer' },
  { id: 'voicemail', label: 'Voicemail' },
  { id: 'talked', label: 'Talked' },
  { id: 'booked', label: 'Booked' },
  { id: 'not-interested', label: 'Not interested' },
];

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

function relativeTime(iso: string | null): string {
  if (!iso) return 'never touched';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never touched';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function ProspectCard({ prospect, onTap }: { prospect: PartnerProspect; onTap: () => void }) {
  const badgeClass = CATEGORY_BADGE[prospect.category];
  // Stop propagation on inner actions so taps don't bubble to row navigation.
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="staff-card-tap w-full border-l-2 border-l-amari-light-sand">
      <button
        onClick={onTap}
        className="w-full flex items-start gap-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-amari-charcoal truncate">
              {prospect.fullName}
            </p>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${badgeClass}`}
            >
              {prospect.category === 'trainer' ? 'PT' : prospect.category}
            </span>
            {prospect.isActivePartner && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amari-light-sand text-amari-charcoal">
                Active partner
              </span>
            )}
          </div>
          <p className="text-xs text-amari-text-muted mt-0.5">
            Last touch: {relativeTime(prospect.lastActivityAt)}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-amari-text-muted shrink-0 mt-1" />
      </button>

      {/* Open in GHL — Garrett does the actual outreach in GHL so the activity gets logged */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <a
          href={ghlContactUrl(prospect.contactId)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopProp}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amari-charcoal text-white text-xs font-medium hover:opacity-90"
        >
          Open in GHL
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Outcome buttons — UI stubs in v0; slice 2 wires writes to GHL custom field */}
      <div className="mt-2">
        <p className="text-[10px] uppercase tracking-wide text-amari-text-muted mb-1">
          Log outcome
        </p>
        <div className="flex flex-wrap gap-1.5">
          {OUTCOME_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={stopProp}
              disabled
              title="Coming in slice 2 — needs GHL custom fields"
              className="px-2 py-1 rounded text-xs border border-amari-border text-amari-text-muted hover:bg-amari-light-sand/40 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PartnersPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<PartnerCategoryFilter>('all');
  const [prospects, setProspects] = useState<PartnerProspect[]>([]);
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

  const filterCount = (f: PartnerCategoryFilter): number => {
    if (f === 'all') return total;
    return counts[f as PartnerCategory] ?? 0;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center justify-between mb-3">
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

      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
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

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {isLoading && prospects.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-amari-text-muted animate-spin" />
        </div>
      ) : prospects.length === 0 ? (
        <p className="text-sm text-amari-text-muted text-center py-12">
          No prospects in this category.
        </p>
      ) : (
        <div className="space-y-2">
          {prospects.map((p) => (
            <ProspectCard
              key={p.contactId}
              prospect={p}
              onTap={() => navigate(`/client/${p.contactId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
