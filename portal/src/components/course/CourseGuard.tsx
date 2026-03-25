import { useClientData } from '../../hooks/useClientData';
import CourseUpsell from './CourseUpsell';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface CourseGuardProps {
  readonly children: React.ReactNode;
}

export default function CourseGuard({ children }: CourseGuardProps) {
  const { data, isLoading, error, refetch } = useClientData();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-serif text-xl font-bold text-amari-charcoal mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-amari-text-secondary mb-4">{error}</p>
          <button onClick={refetch} className="portal-btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data?.client.hasLivingPractice) {
    return <CourseUpsell />;
  }

  return <>{children}</>;
}
