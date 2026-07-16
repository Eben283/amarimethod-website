import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PURCHASE_URL =
  'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd';

export default function CourseUpsell() {
  const navigate = useNavigate();

  return (
    <div className="lp-upsell">
      <div>
        <p className="lp-eyebrow" style={{ marginBottom: '1rem' }}>
          Living Practice
        </p>
        <h1>Living Practice</h1>

        <p>
          The complete video program for building your at-home Amari Method practice.
          11 modules, 43 guided videos.
        </p>

        <p style={{ fontSize: '12px', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Included with the 8-session series, or available standalone for $347.
        </p>

        <div className="lp-actions">
          <a
            href={PURCHASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-btn lp-btn-primary"
          >
            Get Living Practice — $347
          </a>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="lp-btn lp-btn-outline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
