import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { staffLogin, ApiError } from '../lib/api';

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
      const { token } = await staffLogin(pinValue);
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
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-amari-bone-white">
      <div className="w-full max-w-xs">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-serif text-amari-charcoal mb-1">Amari Method</h1>
          <p className="text-amari-text-muted text-sm">Staff Dashboard</p>
        </div>

        {/* PIN dots */}
        <div className="flex justify-center gap-4 mb-6">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? 'bg-amari-charcoal scale-110'
                  : 'bg-amari-border'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        <div className="h-6 text-center mb-4">
          {error && (
            <p className="text-red-500 text-sm animate-fade-in">{error}</p>
          )}
          {isLoading && (
            <p className="text-amari-text-muted text-sm">Signing in...</p>
          )}
        </div>

        {/* Numpad */}
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
                  className="h-16 rounded-xl font-sans text-amari-text-muted text-sm font-medium flex items-center justify-center active:bg-amari-light-sand transition-colors disabled:opacity-30 min-w-[44px] min-h-[44px]"
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
                className="h-16 rounded-xl bg-white border border-amari-border font-sans text-2xl text-amari-charcoal flex items-center justify-center active:bg-amari-light-sand active:scale-95 transition-all shadow-card disabled:opacity-30 min-w-[44px] min-h-[44px]"
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
