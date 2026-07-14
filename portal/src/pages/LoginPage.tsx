import { useState, useEffect, useRef } from 'react';
import { requestMagicLink, verifyLoginCode, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type Status = 'idle' | 'loading' | 'sent' | 'verifying' | 'error';

export default function LoginPage() {
  const { sessionEvicted, login } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Server cooldown is 5 minutes — match the UI so "resend" doesn't 429.
  const [countdown, setCountdown] = useState<number | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(
      () => setCountdown((c) => (c !== null && c > 1 ? c - 1 : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (status === 'sent') {
      codeRef.current?.focus();
    }
  }, [status]);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('loading');
    setErrorMessage('');

    try {
      await requestMagicLink(email.trim().toLowerCase());
      setStatus('sent');
      setCode('');
      setCountdown(300);
    } catch (err) {
      // Anti-enumeration: unknown emails look the same as a real send.
      if (err instanceof ApiError && err.status === 404) {
        setStatus('sent');
        setCode('');
        setCountdown(300);
        return;
      }
      setStatus('error');
      if (err instanceof ApiError && err.status === 429) {
        setErrorMessage('Please wait a few minutes before requesting another code.');
        setCountdown(300);
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(trimmed)) {
      setErrorMessage('Enter the 6-digit code from your email.');
      setStatus('error');
      return;
    }

    setStatus('verifying');
    setErrorMessage('');

    try {
      const result = await verifyLoginCode(email.trim().toLowerCase(), trimmed);
      login(result.sessionToken, result.contactId, result.email);
      window.location.assign('/portal/');
    } catch (err) {
      setStatus('sent');
      if (err instanceof ApiError) {
        setErrorMessage(err.message || 'That code did not work. Try again.');
        if (err.status === 429) setCountdown(300);
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
            <span className="cp-mark" aria-hidden="true" />
            <span>Amari Method</span>
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
            {status === 'sent' || status === 'verifying' ? (
              <>Enter your <em>code.</em></>
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
            {status === 'sent' || status === 'verifying'
              ? 'We emailed a 6-digit code. Enter it here — no need to hunt for a link.'
              : 'Use the email from your booking confirmation. We\'ll email a one-time code.'}
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
              You signed in on another device. Request a new code to continue here.
            </p>
          </div>
        )}

        {status === 'sent' || status === 'verifying' ? (
          <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="cp-mono" htmlFor="otp" style={{ textAlign: 'left' }}>
              6-digit code
            </label>
            <input
              ref={codeRef}
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              disabled={status === 'verifying'}
              style={{
                width: '100%',
                padding: '16px 18px',
                fontSize: 28,
                letterSpacing: '0.35em',
                textAlign: 'center',
                fontFamily: 'var(--cp-display)',
                color: 'var(--cp-ink)',
                background: 'var(--cp-paper)',
                border: '1px solid var(--cp-line-2)',
                outline: 'none',
              }}
            />
            <p style={{ fontSize: 13, color: 'var(--cp-mute)', textAlign: 'left', lineHeight: 1.5 }}>
              Sent to <strong style={{ color: 'var(--cp-ink)', fontWeight: 500 }}>{email}</strong>.
              Check spam if it isn&apos;t there in a minute. Prefer a link? Use the one in the same email.
            </p>

            {errorMessage && (
              <p style={{ fontSize: 14, color: 'var(--cp-err)', textAlign: 'left' }}>{errorMessage}</p>
            )}

            <button
              type="submit"
              className="cp-btn cp-btn-primary"
              disabled={status === 'verifying' || code.length !== 6}
              style={{ width: '100%', marginTop: 4 }}
            >
              <span>{status === 'verifying' ? 'Signing in…' : 'Sign in'}</span>
              {status !== 'verifying' && <span className="cp-arrow">→</span>}
            </button>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 8 }}>
              {countdown !== null && countdown > 0 ? (
                <span className="cp-mono">Resend in {Math.ceil(countdown / 60)}m {String(countdown % 60).padStart(2, '0')}s</span>
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
                  Resend code
                </button>
              )}
              <button
                type="button"
                className="cp-btn cp-btn-text"
                onClick={() => {
                  setStatus('idle');
                  setEmail('');
                  setCode('');
                  setCountdown(null);
                  setErrorMessage('');
                }}
              >
                Different email
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRequestCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                    : 'Email me a code'}
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
