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
    <div className="cp-screen" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '40px 20px' }}>
      <main style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: '64px 24px' }}>
        {status === 'verifying' && (
          <>
            <span className="cp-verify-spinner" aria-hidden="true"></span>
            <h1 style={{ fontFamily: 'var(--cp-display)', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 28 }}>
              Signing you <em style={{ fontStyle: 'italic', color: 'var(--cp-accent)' }}>in.</em>
            </h1>
            <p style={{ fontFamily: 'var(--cp-display)', fontStyle: 'italic', fontSize: 18, color: 'var(--cp-ink-2)', marginTop: 12 }}>
              One moment.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontFamily: 'var(--cp-display)', fontStyle: 'italic', fontSize: 64, color: 'var(--cp-accent)', lineHeight: 1 }}>✦</div>
            <h1 style={{ fontFamily: 'var(--cp-display)', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 20 }}>
              You're <em style={{ fontStyle: 'italic', color: 'var(--cp-accent)' }}>in.</em>
            </h1>
            <p style={{ fontFamily: 'var(--cp-display)', fontStyle: 'italic', fontSize: 18, color: 'var(--cp-ink-2)', marginTop: 12 }}>
              Taking you to your portal.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <span className="cp-mono cp-accent" style={{ display: 'block', marginBottom: 8 }}>Link unavailable</span>
            <h1 style={{ fontFamily: 'var(--cp-display)', fontSize: 36, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.1, textWrap: 'balance' }}>
              We couldn't <em style={{ fontStyle: 'italic', color: 'var(--cp-accent)' }}>sign you in.</em>
            </h1>
            <p style={{ fontFamily: 'var(--cp-display)', fontStyle: 'italic', fontSize: 18, color: 'var(--cp-ink-2)', marginTop: 14, maxWidth: '36ch', marginLeft: 'auto', marginRight: 'auto' }}>
              {errorMessage}
            </p>
            <div style={{ marginTop: 26, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/portal/login" className="cp-btn cp-btn-primary">
                <span>Request a new link</span><span className="cp-arrow">→</span>
              </a>
              <a href="mailto:hello@amarimethod.com" className="cp-btn cp-btn-ghost">
                Contact Dr. Garrett
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
