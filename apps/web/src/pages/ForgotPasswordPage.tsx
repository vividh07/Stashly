import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'email' | 'totp'>('email');
  const [totpAvailable, setTotpAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    void api
      .authStatus()
      .then((s) => {
        setTotpAvailable(Boolean(s.totpEnabled));
        if (s.totpEnabled) setMode('totp');
      })
      .catch(() => undefined);
  }, []);

  const onSendEmail = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await api.forgotPassword();
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const onTotpReset = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await api.resetPasswordWithTotp(code, password);
      setMessage(res.message);
      window.setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade" />
      <div className="glass relative w-full max-w-md animate-fade-up rounded-3xl p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-fog">Reset password</h1>
          <p className="mt-2 text-sm text-mute">
            Use your authenticator app (recommended) or request an email link.
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`btn-subtle ${mode === 'totp' ? 'border-accent/40 text-accent' : ''}`}
            onClick={() => setMode('totp')}
            disabled={!totpAvailable}
          >
            Authenticator
          </button>
          <button
            type="button"
            className={`btn-subtle ${mode === 'email' ? 'border-accent/40 text-accent' : ''}`}
            onClick={() => setMode('email')}
          >
            Email link
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-danger">{error}</p>}
        {message && <p className="mb-4 text-sm text-accent">{message}</p>}

        {mode === 'totp' ? (
          totpAvailable ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void onTotpReset();
              }}
            >
              <div>
                <label className="label">Authenticator code</label>
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  minLength={6}
                  maxLength={6}
                />
              </div>
              <div>
                <label className="label">New password</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <button className="btn-primary w-full" disabled={loading}>
                {loading ? 'Updating…' : 'Reset with authenticator'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-mute">
              Authenticator is not set up yet. Sign in, open Settings, and enable it — or use email
              reset.
            </p>
          )
        ) : (
          <button className="btn-primary w-full" disabled={loading} onClick={() => void onSendEmail()}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        )}

        <p className="mt-6 text-center text-sm text-mute">
          <Link className="text-accent hover:underline" to="/login">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
