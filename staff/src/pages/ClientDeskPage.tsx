import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, getCrmMirrorAccessUrl, sendFollowupText } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { deskNavigationRoute } from '../lib/desk-navigation';

export default function ClientDeskPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedContact = searchParams.get('contact');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openDesk = useCallback(async () => {
    setError(null);
    setSrc(null);
    try {
      const { url } = await getCrmMirrorAccessUrl('client-desk');
      const deskUrl = new URL(url);
      deskUrl.searchParams.set('embed', '1');
      deskUrl.searchParams.set('parent_origin', window.location.origin);
      if (requestedContact && /^[A-Za-z0-9_-]{1,80}$/.test(requestedContact)) {
        deskUrl.searchParams.set('contact', requestedContact);
      }
      setSrc(deskUrl.toString());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not open Practice Member Desk');
    }
  }, [logout, requestedContact]);

  useEffect(() => {
    void openDesk();
  }, [openDesk]);

  useEffect(() => {
    if (!src) return;
    const deskOrigin = new URL(src).origin;
    const receiveDeskNavigation = (event: MessageEvent) => {
      if (event.origin !== deskOrigin) return;
      if (event.data?.type === 'amari:staff-desk-session-expired') {
        // If the Staff session is still good, mint a new embedded Desk session.
        // If it is not, openDesk logs out and ProtectedRoute shows Staff login.
        void openDesk();
        return;
      }
      if (event.data?.type === 'amari:staff-send-sms') {
        const { requestId, contactId, message } = event.data;
        if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) return;
        if (typeof contactId !== 'string' || !/^[A-Za-z0-9]+$/.test(contactId)) return;
        if (typeof message !== 'string' || !message.trim() || message.trim().length > 720) return;
        void sendFollowupText(contactId, message.trim())
          .then((result) => frameRef.current?.contentWindow?.postMessage({ type: 'amari:staff-send-sms-result', requestId, ok: true, deduped: Boolean(result.deduped) }, deskOrigin))
          .catch((reason: unknown) => frameRef.current?.contentWindow?.postMessage({ type: 'amari:staff-send-sms-result', requestId, ok: false, error: reason instanceof Error ? reason.message : 'Text could not be sent.' }, deskOrigin));
        return;
      }
      if (event.data?.type !== 'amari:staff-navigate' || typeof event.data.path !== 'string') return;
      const destination = new URL(event.data.path, window.location.origin);
      const route = deskNavigationRoute(event.data.path, window.location.origin);
      if (!route) return;
      if (destination.pathname === '/staff/automations') {
        navigate(route);
        return;
      }
      const client = event.data.client;
      const contactId = destination.searchParams.get('contact');
      const deskClient = client && typeof client === 'object' && typeof client.id === 'string' && client.id === contactId
        ? {
            id: client.id,
            name: typeof client.name === 'string' && client.name ? client.name : 'Practice member',
            email: typeof client.email === 'string' ? client.email : null,
            phone: typeof client.phone === 'string' ? client.phone : null,
            isFoundersCircle: false,
          }
        : null;
      navigate(route, { state: deskClient ? { deskClient } : null });
    };
    window.addEventListener('message', receiveDeskNavigation);
    return () => window.removeEventListener('message', receiveDeskNavigation);
  }, [navigate, openDesk, src]);

  return (
    <main className="client-desk-shell">
      <section className="client-desk-shell__frame" aria-label="Practice Member Desk">
        {error ? <div className="client-desk-shell__status client-desk-shell__status--error" role="alert">{error}</div> : null}
        {src ? <iframe ref={frameRef} title="Practice Member Desk" src={src} /> : !error ? <div className="client-desk-shell__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected Practice Member Desk…</div> : null}
      </section>
    </main>
  );
}
