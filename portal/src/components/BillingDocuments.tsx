import { useState, type CSSProperties } from 'react';
import { getReimbursementPacketHtml, ApiError } from '../lib/api';

// "Billing & documents" card. The client picks a date range, then generates an
// insurance reimbursement packet (cover letter + letter of services + the paid
// invoices in that range) as a print-ready page they save as a PDF.
const todayStr = () => new Date().toISOString().slice(0, 10);
const yearStartStr = () => `${new Date().getFullYear()}-01-01`;

const dateInputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
  background: '#fff',
};

export default function BillingDocuments() {
  const [from, setFrom] = useState(yearStartStr());
  const [to, setTo] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    // Open the window synchronously inside the click so popup blockers allow it;
    // fill it once the HTML comes back.
    const win = window.open('', '_blank');
    try {
      const html = await getReimbursementPacketHtml(from, to);
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      } else {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        window.open(url, '_blank');
      }
    } catch (err) {
      if (win) win.close();
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not generate your packet. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="cp-actions">
      <div className="cp-section-head">
        <h3 className="cp-section-h">Billing &amp; documents</h3>
      </div>
      <div
        style={{
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 12,
          padding: 18,
          background: 'rgba(0,0,0,0.015)',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
          Insurance reimbursement packet
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 14, opacity: 0.8, maxWidth: 560 }}>
          A cover letter, a letter of services, and your paid invoices for the dates you choose —
          ready to submit to your insurer or HSA/FSA.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span>From</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span>To</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={dateInputStyle} />
          </label>
          <button
            type="button"
            className="cp-btn cp-btn-primary"
            onClick={handleGenerate}
            disabled={loading}
            data-testid="reimbursement-packet"
          >
            <span>{loading ? 'Preparing…' : 'Generate packet'}</span>
            {!loading && <span className="cp-arrow">→</span>}
          </button>
        </div>
        {error && <p style={{ color: '#b4452f', fontSize: 14, marginTop: 12 }}>{error}</p>}
      </div>
    </section>
  );
}
