export type DataReadState = 'loading' | 'ready' | 'partial' | 'unavailable';

export function resolveDataReadState({
  loading,
  error,
  hasData,
}: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
}): DataReadState {
  if (loading) return 'loading';
  if (error) return hasData ? 'partial' : 'unavailable';
  return 'ready';
}
