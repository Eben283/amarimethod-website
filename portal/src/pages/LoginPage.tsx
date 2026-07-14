import { useState, useEffect } from 'react';
import { requestMagicLink, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type Status = 'idle' | 'loading' | 'sent' | 'error';

export default function LoginPage() {
  const { sessionEvicted } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Server cooldown is 5 minutes — match the UI so "resend" doesn't 429.
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(
      () => setCountdown((c) => (c !== null && c > 1 ? c - 1 : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('loading');
    setErrorMessage('');

    try {
      await requestMagicLink(email.trim().toLowerCase());
      setStatus('sent');
      setCountdown(300);
    } catch (err) {
      // Anti-enumeration: unknown emails look the same as a real send.
      if (err instanceof ApiError && err.status === 404) {
        setStatus('sent');
        setCountdown(300);
        return;
      }
      setStatus('error');
      if (err instanceof ApiError && err.status === 429) {
        setErrorMessage('Please wait a few minutes before requesting another link.');
        setCountdown(300);
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <div className="cp-screen" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '40px 20px' }}>
      <main style={{ maxWidth: 460, width: '100%', padding: '48px 8px 64px' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <a href="/" className="cp-seal" style={{ justifyContent: 'center', marginBottom: 28, display: 'inline-flex' }}>
            <img src="/images/AmariLogo.avif" alt="Amari Method" className="cp-seal-logo" />
          </a>
          <span className="cp-mono cp-accent" style={{ display: 'block', marginBottom: 10 }}>
            Client portal
          </span>
          <h1
            style={{
              fontFamily: 'var(--cp-display)',
              fontSize: 'clamp(34px, 6vw, 44px)',
              fontWeight: 400,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              textWrap: 'balance',
            }}
          >
            {status === 'sent' ? (
              <>Check your <em>email.</em></>
            ) : (
              <>Sign <em>in.</em></>
            )}
          </h1>
          <p
            style={{
              fontFamily: 'var(--cp-display)',
              fontStyle: 'italic',
              fontSize: 18,
              color: 'var(--cp-ink-2)',
              marginTop: 12,
              maxWidth: '34ch',
              marginLeft: 'auto',
              marginRight: 'auto',
              lineHeight: 1.45,
            }}
          >
            {status === 'sent'
              ? 'Open the login link we just sent — it takes you straight into your portal.'
              : 'Use the email from your booking confirmation. We\'ll send a one-time login link.'}
          </p>
        </div>

        {sessionEvicted && (
          <div
            style={{
              marginBottom: 20,
              padding: '14px 16px',
              border: '1px solid var(--cp-line-2)',
              background: 'var(--cp-paper-2)',
              textAlign: 'left',
            }}
          >
            <p className="cp-mono" style={{ color: 'var(--cp-warn)', marginBottom: 6 }}>Session ended</p>
            <p style={{ fontSize: 14, color: 'var(--cp-ink-2)', lineHeight: 1.45 }}>
              You signed in on another device. Request a new login link to continue here.
            </p>
          </div>
        )}

        {status === 'sent' ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 15, color: 'var(--cp-ink-2)', lineHeight: 1.55, marginBottom: 8 }}>
              Sent to <strong style={{ color: 'var(--cp-ink)', fontWeight: 500 }}>{email}</strong>.
            </p>
            <p style={{ fontSize: 14, color: 'var(--cp-mute)', lineHeight: 1.5, marginBottom: 28 }}>
              Check spam if it isn&apos;t there in a minute. The link works once and expires in 24 hours.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
              {countdown !== null && countdown > 0 ? (
                <span className="cp-mono">
                  Resend in {Math.ceil(countdown / 60)}m {String(countdown % 60).padStart(2, '0')}s
                </span>
              ) : (
                <button
                  type="button"
                  className="cp-btn cp-btn-text"
                  onClick={() => {
                    setStatus('idle');
                    setCountdown(null);
                    setErrorMessage('');
                  }}
                >
                  Resend link
                </button>
              )}
              <button
                type="button"
                className="cp-btn cp-btn-text"
                onClick={() => {
                  setStatus('idle');
                  setEmail('');
                  setCountdown(null);
                  setErrorMessage('');
                }}
              >
                Different email
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="cp-mono" htmlFor="email" style={{ textAlign: 'left' }}>
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              disabled={status === 'loading'}
              style={{
                width: '100%',
                padding: '14px 16px',
                fontSize: 16,
                fontFamily: 'var(--cp-sans)',
                color: 'var(--cp-ink)',
                background: 'var(--cp-paper)',
                border: '1px solid var(--cp-line-2)',
                outline: 'none',
              }}
            />

            {status === 'error' && errorMessage && (
              <p style={{ fontSize: 14, color: 'var(--cp-err)', textAlign: 'left' }}>{errorMessage}</p>
            )}

            <button
              type="submit"
              className="cp-btn cp-btn-primary"
              disabled={status === 'loading' || !email.trim() || (countdown !== null && countdown > 0)}
              style={{ width: '100%', marginTop: 4 }}
            >
              <span>
                {status === 'loading'
                  ? 'Sending…'
                  : countdown !== null && countdown > 0
                    ? `Wait ${Math.ceil(countdown / 60)}m`
                    : 'Email me a login link'}
              </span>
              {status !== 'loading' && !(countdown !== null && countdown > 0) && (
                <span className="cp-arrow">→</span>
              )}
            </button>
          </form>
        )}

        <p
          style={{
            textAlign: 'center',
            fontSize: 14,
            color: 'var(--cp-mute)',
            marginTop: 28,
            lineHeight: 1.5,
          }}
        >
          New here?{' '}
          <a href="/booking" style={{ color: 'var(--cp-ink)', textDecoration: 'underline' }}>
            Book your first session
          </a>
        </p>
      </main>
    </div>
  );
}
