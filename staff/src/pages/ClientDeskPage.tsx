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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open Practice Member Desk');
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="ops-hub">
      <header className="ops-hub__head">
        <Link to="/" className="ops-hub__back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div><p>Practice member relationships</p><h1>Practice Member Desk</h1><span>Recent communication and practice member context, read-only.</span></div>
      </header>
      <section className="ops-hub__frame" aria-label="Practice Member Desk">
        {error ? <div className="ops-hub__status ops-hub__status--error" role="alert">{error}</div> : null}
        {src ? <iframe title="Practice Member Desk" src={src} /> : !error ? <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected Practice Member Desk…</div> : null}
      </section>
    </main>
  );
}
