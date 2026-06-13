import { useState, useEffect } from 'react';
import { getPortalData, ApiError } from '../lib/api';
import type { PortalDataResponse } from '../types/portal';
import { useAuth } from '../contexts/AuthContext';
import { getPreviewState, getPreviewData } from '../lib/preview';

interface UseClientDataReturn {
  data: PortalDataResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// Shared module-level cache so that several components mounting in the same
// view (e.g. CourseGuard + CoursePage), or navigating between portal pages,
// collapse into a single portal-data (GHL) fetch instead of one request per
// useClientData() consumer per mount. refetch() always bypasses the cache, so
// post-action freshness (booking/cancel call refetch) is unchanged.
const CACHE_TTL_MS = 30_000;
let cachedData: PortalDataResponse | null = null;
let cachedAt = 0;
let inFlight: Promise<PortalDataResponse> | null = null;

function cacheIsFresh(): boolean {
  return cachedData !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

/** Fetch portal data, sharing a fresh cache entry / in-flight request across
 *  callers. `force` skips both and always hits the network. */
function fetchPortalDataDeduped(force: boolean): Promise<PortalDataResponse> {
  if (!force && cacheIsFresh()) {
    return Promise.resolve(cachedData as PortalDataResponse);
  }
  if (!force && inFlight) {
    return inFlight;
  }

  const request = getPortalData()
    .then(result => {
      cachedData = result;
      cachedAt = Date.now();
      return result;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });

  inFlight = request;
  return request;
}

/** Drop the shared cache — called on logout / 401 so a different login can't
 *  read a prior session's data. */
export function clearPortalDataCache(): void {
  cachedData = null;
  cachedAt = 0;
  inFlight = null;
}

export function useClientData(): UseClientDataReturn {
  const { isAuthenticated, logout } = useAuth();

  // Seed from a fresh cache entry to avoid a loading flash when re-mounting
  // (e.g. CourseGuard renders, then hands off to CoursePage). Preview mode
  // never uses the live cache.
  const seedFromCache = !getPreviewState() && cacheIsFresh() ? cachedData : null;

  const [data, setData] = useState<PortalDataResponse | null>(seedFromCache);
  const [isLoading, setIsLoading] = useState(seedFromCache === null);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    // Preview mode: synthetic data, no auth, no fetch.
    const preview = getPreviewState();
    if (preview) {
      if (preview === 'loading') {
        setIsLoading(true);
        setError(null);
        return;
      }
      if (preview === 'error') {
        setIsLoading(false);
        setError('Preview mode — simulated connection error.');
        return;
      }
      setData(getPreviewData(preview));
      setIsLoading(false);
      setError(null);
      return;
    }

    if (!isAuthenticated) {
      clearPortalDataCache();
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        // refetchKey only advances via refetch(); a non-zero value means an
        // explicit refresh was requested, so bypass the cache.
        const result = await fetchPortalDataDeduped(refetchKey > 0);
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) {
            // Token invalid/expired — log out
            clearPortalDataCache();
            logout();
          } else {
            setError(
              err instanceof Error
                ? err.message
                : 'Having trouble loading your data. Please try again.'
            );
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, refetchKey, logout]);

  function refetch() {
    setRefetchKey(prev => prev + 1);
  }

  return { data, isLoading, error, refetch };
}
