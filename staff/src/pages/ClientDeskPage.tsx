import { ChevronLeft, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCrmMirrorAccessUrl } from '../lib/api';

export default function ClientDeskPage() {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCrmMirrorAccessUrl('client-desk')
      .then(({ url }) => {
        if (!cancelled) setSrc(url.includes('?') ? `${url}&embed=1` : `${url}?embed=1`);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open Client Desk');
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="ops-hub">
      <header className="ops-hub__head">
        <Link to="/" className="ops-hub__back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div><p>Client relationships</p><h1>Client Desk</h1><span>Recent communication and client context, read-only.</span></div>
      </header>
      <section className="ops-hub__frame" aria-label="Client Desk">
        {error ? <div className="ops-hub__status ops-hub__status--error" role="alert">{error}</div> : null}
        {src ? <iframe title="Client Desk" src={src} /> : !error ? <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected Client Desk…</div> : null}
      </section>
    </main>
  );
}
