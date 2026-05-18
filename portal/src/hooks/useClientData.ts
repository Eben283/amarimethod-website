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

export function useClientData(): UseClientDataReturn {
  const { isAuthenticated, logout } = useAuth();
  const [data, setData] = useState<PortalDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getPortalData();
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) {
            // Token invalid/expired — log out
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
