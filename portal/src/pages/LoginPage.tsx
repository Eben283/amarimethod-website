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
    <div className="sa-screen">
      <aside className="sa-context" aria-label="Amari Method client portal">
        <a href="/" className="sa-context-mark"><img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" /></a>
        <span className="sa-context-label">Client<br />portal</span>
      </aside>
      <main className="sa-main">
        <a href="/" className="sa-wordmark">
          <img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" />
        </a>
        <span className="sa-eyebrow">Client portal</span>
        <h1 className="sa-title">
          {status === 'sent' ? (
            <>Check your email.</>
          ) : (
            <>Sign in.</>
          )}
        </h1>
        <p className="sa-lead">
          {status === 'sent'
            ? 'Open the login link we just sent — it takes you straight into your portal.'
            : "Use the email from your booking confirmation. We'll send a one-time login link."}
        </p>

        {sessionEvicted && (
          <div className="sa-notice">
            <p className="sa-notice-k">Session ended</p>
            <p className="sa-notice-v">
              You signed in on another device. Request a new login link to continue here.
            </p>
          </div>
        )}

        {status === 'sent' ? (
          <div className="sa-sent">
            <p className="sa-sent-email">
              Sent to <strong>{email}</strong>.
            </p>
            <p className="sa-sent-note">
              Check spam if it isn&apos;t there in a minute. The link works once and expires in 24 hours.
            </p>
            <div className="sa-actions">
              {countdown !== null && countdown > 0 ? (
                <span className="sa-countdown">
                  Resend in {Math.ceil(countdown / 60)}m {String(countdown % 60).padStart(2, '0')}s
                </span>
              ) : (
                <button
                  type="button"
                  className="sa-link"
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
                className="sa-link"
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
          <form className="sa-form" onSubmit={handleSubmit}>
            <div className="sa-field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                disabled={status === 'loading'}
                autoComplete="email"
              />
            </div>

            {status === 'error' && errorMessage && (
              <p className="sa-error">{errorMessage}</p>
            )}

            <button
              type="submit"
              className="sa-btn"
              disabled={status === 'loading' || !email.trim() || (countdown !== null && countdown > 0)}
            >
              {status === 'loading'
                ? 'Sending…'
                : countdown !== null && countdown > 0
                  ? `Wait ${Math.ceil(countdown / 60)}m`
                  : 'Email me a login link'}
            </button>
          </form>
        )}

        <p className="sa-footer">
          New here? <a href="/assessment-booking">Book an Amari Assessment</a>
        </p>
      </main>
    </div>
  );
}
