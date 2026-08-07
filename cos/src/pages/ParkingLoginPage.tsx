import { useCallback, useState } from 'react';
import { ApiError } from '../lib/api';
import { parkingLogin } from '../lib/parking-api';
import { useParkingAuth } from '../contexts/ParkingAuthContext';

const PIN_LENGTH = 4;

export default function ParkingLoginPage() {
  const { login } = useParkingAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const submitPin = async (value: string) => {
    setIsLoading(true); setError('');
    try { login((await parkingLogin(value)).token); }
    catch (cause) { setPin(''); setError(cause instanceof ApiError && cause.status === 401 ? 'Wrong PIN' : 'Something went wrong. Try again.'); }
    finally { setIsLoading(false); }
  };
  const digit = useCallback((value: string) => setPin(current => {
    const next = `${current}${value}`;
    if (next.length === PIN_LENGTH) void submitPin(next);
    return next.length <= PIN_LENGTH ? next : current;
  }), []);
  const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  return <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-cos-bg"><div className="w-full max-w-xs">
    <div className="text-center mb-10"><h1 className="text-2xl font-sans font-semibold text-cos-text mb-1">Parking</h1><p className="text-cos-text-muted text-sm">Enter PIN</p></div>
    <div className="flex justify-center gap-4 mb-6">{Array.from({ length: PIN_LENGTH }).map((_, index) => <div key={index} className={`w-3.5 h-3.5 rounded-full ${index < pin.length ? 'bg-cos-accent scale-110' : 'bg-cos-border'}`} />)}</div>
    <div className="h-6 text-center mb-4">{error && <p className="text-red-400 text-sm">{error}</p>}{isLoading && <p className="text-cos-text-muted text-sm">Signing in...</p>}</div>
    <div className="grid grid-cols-3 gap-3">{keys.map((value, index) => value === '' ? <div key={index} /> : value === 'del' ? <button key={index} type="button" onClick={() => setPin(current => current.slice(0, -1))} disabled={isLoading || !pin} className="h-16 rounded-xl text-cos-text-muted text-sm disabled:opacity-30">Delete</button> : <button key={index} type="button" onClick={() => digit(value)} disabled={isLoading || pin.length >= PIN_LENGTH} className="h-16 rounded-xl bg-cos-surface border border-cos-border text-2xl text-cos-text disabled:opacity-30">{value}</button>)}</div>
  </div></div>;
}
