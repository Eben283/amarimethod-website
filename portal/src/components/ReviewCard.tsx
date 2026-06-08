// A gentle Google-review ask on the dashboard. Shows once a client has had a
// session. Opens the practice's Google review link in a new tab.
const REVIEW_URL = 'https://g.page/r/Cd5GNnATe8p_EBM/review';

export default function ReviewCard() {
  return (
    <div
      style={{
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 12,
        padding: 20,
        background: 'rgba(235,165,132,0.07)',
      }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600 }}>Enjoying your sessions?</h3>
      <p style={{ margin: '0 0 16px', fontSize: 14, opacity: 0.8, maxWidth: 520 }}>
        If the work has helped you, a quick Google review helps other people find Dr. Garrett. It
        takes a minute, and it means a lot.
      </p>
      <a
        href={REVIEW_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="cp-btn cp-btn-primary"
        data-testid="google-review"
      >
        <span>Leave a Google review</span> <span className="cp-arrow">→</span>
      </a>
    </div>
  );
}
