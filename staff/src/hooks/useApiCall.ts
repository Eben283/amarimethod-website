import { useState, useEffect, useCallback } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export interface UseApiCallResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// Generic data-fetch hook: loads once on mount, handles 401 auto-logout,
// cancels stale responses on unmount or refetch, and exposes refetch().
//
// Pass a stable fetcher (wrap in useCallback if it has deps).
export function useApiCall<T>(fetcher: () => Promise<T>): UseApiCallResult<T> {
  const { logout } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetcher()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) { logout(); return; }
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [fetcher, epoch, logout]);

  const refetch = useCallback(() => setEpoch((n) => n + 1), []);
  return { data, isLoading, error, refetch };
}
