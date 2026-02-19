import { useState } from 'react';
import { requestMagicLink, ApiError } from '../lib/api';
import { Mail, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('loading');
    setErrorMessage('');

    try {
      await requestMagicLink(email.trim().toLowerCase());
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      if (err instanceof ApiError && err.status === 404) {
        setErrorMessage(
          "We don't have an account with that email. If you've had a session with us, contact hello@amarimethod.com."
        );
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-block">
            <img
              src="/images/AmariLogo.avif"
              alt="Amari Method"
              className="h-10 mx-auto mb-6"
              style={{ height: '40px', width: 'auto' }}
            />
          </a>
          <h1 className="font-serif text-3xl font-bold text-amari-charcoal mb-2">
            Client Portal
          </h1>
          <p className="text-amari-text-muted">
            Sign in to view your sessions, track your progress, and manage your care.
          </p>
        </div>

        {/* Card */}
        <div className="portal-card">
          {status === 'sent' ? (
            /* Success state */
            <div className="text-center py-4">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h2 className="font-serif text-xl font-bold text-amari-charcoal mb-2">
                Check your email
              </h2>
              <p className="text-amari-text-secondary mb-4">
                We sent a login link to <span className="font-medium">{email}</span>.
                Click the link to sign in.
              </p>
              <p className="text-sm text-amari-text-muted">
                The link expires in 15 minutes. Check your spam folder if you don't see it.
              </p>
              <button
                onClick={() => { setStatus('idle'); setEmail(''); }}
                className="mt-6 text-sm text-amari-charcoal underline hover:no-underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            /* Login form */
            <form onSubmit={handleSubmit}>
              <label htmlFor="email" className="portal-label">
                Email address
              </label>
              <div className="relative mb-4">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-amari-text-muted" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="portal-input pl-11"
                  required
                  autoFocus
                  disabled={status === 'loading'}
                />
              </div>

              {status === 'error' && (
                <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-red-50 border border-red-100">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{errorMessage}</p>
                </div>
              )}

              <button
                type="submit"
                className="portal-btn-primary w-full"
                disabled={status === 'loading' || !email.trim()}
              >
                {status === 'loading' ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending link...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Send login link
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-amari-text-muted mt-6">
          New to the Amari Method?{' '}
          <a href="/booking" className="text-amari-charcoal underline hover:no-underline">
            Book your first session
          </a>
        </p>
      </div>
    </div>
  );
}
