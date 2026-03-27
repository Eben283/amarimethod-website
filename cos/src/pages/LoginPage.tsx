import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { cosLogin, ApiError } from '../lib/api';

const PIN_LENGTH = 4;

export default function LoginPage() {
  const { login } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleDigit = useCallback((digit: string) => {
    setError('');
    setPin(prev => {
      const next = prev + digit;
      if (next.length === PIN_LENGTH) {
        submitPin(next);
      }
      return next.length <= PIN_LENGTH ? next : prev;
    });
  }, []);

  const handleDelete = useCallback(() => {
    setError('');
    setPin(prev => prev.slice(0, -1));
  }, []);

  async function submitPin(pinValue: string) {
    setIsLoading(true);
    setError('');
    try {
      const { token } = await cosLogin(pinValue);
      login(token);
    } catch (err) {
      setPin('');
      if (err instanceof ApiError) {
        setError(err.status === 401 ? 'Wrong PIN' : err.message);
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-cos-bg">
      <div className="w-full max-w-xs">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-sans font-semibold text-cos-text mb-1">Chief of Staff</h1>
          <p className="text-cos-text-muted text-sm">Enter PIN</p>
        </div>

        <div className="flex justify-center gap-4 mb-6">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? 'bg-cos-accent scale-110'
                  : 'bg-cos-border'
              }`}
            />
          ))}
        </div>

        <div className="h-6 text-center mb-4">
          {error && (
            <p className="text-red-400 text-sm animate-fade-in">{error}</p>
          )}
          {isLoading && (
            <p className="text-cos-text-muted text-sm">Signing in...</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {digits.map((digit, i) => {
            if (digit === '') {
              return <div key={i} />;
            }
            if (digit === 'del') {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={handleDelete}
                  disabled={isLoading || pin.length === 0}
                  className="h-16 rounded-xl font-sans text-cos-text-muted text-sm font-medium flex items-center justify-center active:bg-cos-surface transition-colors disabled:opacity-30 min-w-[44px] min-h-[44px]"
                >
                  Delete
                </button>
              );
            }
            return (
              <button
                key={i}
                type="button"
                onClick={() => handleDigit(digit)}
                disabled={isLoading || pin.length >= PIN_LENGTH}
                className="h-16 rounded-xl bg-cos-surface border border-cos-border font-sans text-2xl text-cos-text flex items-center justify-center active:bg-cos-surface-light active:scale-95 transition-all disabled:opacity-30 min-w-[44px] min-h-[44px]"
              >
                {digit}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
