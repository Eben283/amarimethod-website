import { ChevronLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getCrmMirrorAccessUrl } from '../lib/api';

export default function ClientDeskPage() {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCrmMirrorAccessUrl('client-desk')
      .then(({ url }) => {
        if (cancelled) return;
        const deskUrl = new URL(url);
        deskUrl.searchParams.set('embed', '1');
        deskUrl.searchParams.set('parent_origin', window.location.origin);
        setSrc(deskUrl.toString());
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open Practice Member Desk');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!src) return;
    const deskOrigin = new URL(src).origin;
    const receiveDeskNavigation = (event: MessageEvent) => {
      if (event.origin !== deskOrigin) return;
      if (event.data?.type !== 'amari:staff-navigate' || typeof event.data.path !== 'string') return;
      const destination = new URL(event.data.path, window.location.origin);
      if (destination.origin !== window.location.origin || destination.pathname !== '/staff/pos') return;
      navigate(`/pos${destination.search}`);
    };
    window.addEventListener('message', receiveDeskNavigation);
    return () => window.removeEventListener('message', receiveDeskNavigation);
  }, [navigate, src]);

  return (
    <main className="ops-hub">
      <header className="ops-hub__head">
        <Link to="/" className="ops-hub__back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div><p>Practice member relationships</p><h1>Practice Member Desk</h1><span>Recent communication and practice member context, read-only.</span></div>
      </header>
      <section className="ops-hub__frame" aria-label="Practice Member Desk">
        {error ? <div className="ops-hub__status ops-hub__status--error" role="alert">{error}</div> : null}
        {src ? <iframe ref={frameRef} title="Practice Member Desk" src={src} /> : !error ? <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected Practice Member Desk…</div> : null}
      </section>
    </main>
  );
}
