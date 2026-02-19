import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { verifyToken, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function VerifyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
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
        // Redirect to dashboard after brief success message
        setTimeout(() => navigate('/', { replace: true }), 1500);
      } catch (err) {
        setStatus('error');
        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 410) {
            setErrorMessage('This login link has expired. Please request a new one.');
          } else {
            setErrorMessage('Something went wrong. Please try again.');
          }
        } else {
          setErrorMessage('Something went wrong. Please try again.');
        }
      }
    }

    verify();
  }, [searchParams, login, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center animate-fade-in">
        <div className="portal-card py-10">
          {status === 'verifying' && (
            <>
              <Loader2 className="w-12 h-12 text-amari-charcoal mx-auto mb-4 animate-spin" />
              <h2 className="font-serif text-xl font-bold text-amari-charcoal mb-2">
                Signing you in...
              </h2>
              <p className="text-amari-text-muted">Just a moment.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h2 className="font-serif text-xl font-bold text-amari-charcoal mb-2">
                You're in!
              </h2>
              <p className="text-amari-text-muted">Redirecting to your dashboard...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h2 className="font-serif text-xl font-bold text-amari-charcoal mb-2">
                Link expired
              </h2>
              <p className="text-amari-text-secondary mb-6">{errorMessage}</p>
              <a href="/portal" className="portal-btn-primary">
                Request a new link
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
