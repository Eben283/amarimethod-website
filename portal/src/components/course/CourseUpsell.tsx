import { Play, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PURCHASE_URL =
  'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd';

export default function CourseUpsell() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-amari-light-sand flex items-center justify-center mx-auto mb-6">
          <Play className="w-8 h-8 text-amari-charcoal" />
        </div>

        <h1 className="font-serif text-2xl font-bold text-amari-charcoal mb-3">
          Living Practice
        </h1>

        <p className="text-sm text-amari-text-secondary mb-2">
          The complete video program for building your at-home Amari Method practice.
          11 modules, 43 guided videos.
        </p>

        <p className="text-xs text-amari-text-muted mb-6">
          Included with the 8-session series, or available standalone for $347.
        </p>

        <div className="flex flex-col gap-3">
          <a
            href={PURCHASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="portal-btn-primary no-underline"
          >
            Get Living Practice — $347
          </a>
          <button
            onClick={() => navigate('/')}
            className="portal-btn-secondary"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
