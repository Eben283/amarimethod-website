import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { verifyToken, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const hasVerified = useRef(false);

  useEffect(() => {
    // Guard against React's effect double-fire — magic link tokens are
    // one-time use and the second call would always fail.
    if (hasVerified.current) return;
    hasVerified.current = true;

    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setErrorMessage('No login token found. Please request a new login link.');
      return;
    }

    async function verify() {
      try {
        const result = await verifyToken(token!);
        login(result.sessionToken, result.contactId, result.email);
        setStatus('success');
        setTimeout(() => navigate('/', { replace: true }), 900);
      } catch (err) {
        setStatus('error');
        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 410) {
            setErrorMessage('This login link has expired. Please request a new one.');
          } else if (err.status === 404) {
            setErrorMessage('This login link is no longer valid. Please request a new one.');
          } else {
            setErrorMessage('Something went wrong. Please try again.');
          }
        } else {
          setErrorMessage('Something went wrong. Please try again.');
        }
      }
    }

    verify();
    // Empty dep array intentional — token is captured in closure, guard
    // above prevents double-run regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sa-screen">
      <aside className="sa-context" aria-label="Amari Method client portal">
        <a href="/" className="sa-context-mark"><img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" /></a>
        <span className="sa-context-label">Client<br />portal</span>
      </aside>
      <main className="sa-main">
        <a href="/" className="sa-wordmark">
          <img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" />
        </a>

        {status === 'verifying' && (
          <>
            <span className="sa-verify-spinner" aria-hidden="true" />
            <h1 className="sa-title" style={{ marginTop: 28 }}>
              Signing you in.
            </h1>
            <p className="sa-lead">One moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <span className="sa-eyebrow">You&apos;re in</span>
            <h1 className="sa-title">
              Taking you to your portal.
            </h1>
            <p className="sa-lead">Hang tight — almost there.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <span className="sa-eyebrow">Link unavailable</span>
            <h1 className="sa-title">
              We couldn&apos;t sign you in.
            </h1>
            <p className="sa-lead">{errorMessage}</p>
            <div className="sa-verify-actions">
              <a href="/portal/login" className="sa-btn">
                Request a new link
              </a>
              <a href="mailto:hello@amarimethod.com" className="sa-btn-ghost">
                Email us
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
