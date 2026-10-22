import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, Eye, Lock, ShieldCheck, Users, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DEMO_CREDENTIALS, DEMO_PASSWORD_HINT, validateEmail, validatePassword } from '../services/auth';
import { IS_MOCK } from '../services/api';
import { Button, TextField } from '../components/ui';

const FEATURES = [
  { icon: Activity, title: 'Correlated detection', text: 'Wazuh, linux_auth and Sysmon telemetry fused into one alert queue.' },
  { icon: Eye, title: 'Evidence-first triage', text: 'Timelines, implicated entities and raw logs on every incident.' },
  { icon: Zap, title: 'AI investigation support', text: 'Summary, hypotheses and next steps separated from observed evidence.' },
  { icon: Users, title: 'Analyst workflow', text: 'Status transitions, notes and assignment persisted per case.' },
];

export function LoginPage() {
  const { signIn, signingIn, error, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password ? validatePassword(password) : null;
  const formValid = !validateEmail(email) && !validatePassword(password);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    setBanner(null);
    if (!formValid) {
      setBanner('Fix the highlighted fields before signing in.');
      return;
    }
    const ok = await signIn(email, password);
    if (ok) navigate(from, { replace: true });
  };

  const fillDemo = (index: number) => {
    setEmail(DEMO_CREDENTIALS[index].email);
    setPassword(DEMO_PASSWORD_HINT);
    setTouched({ email: false, password: false });
    setBanner(null);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden flex-col justify-between border-r border-soc-800 bg-soc-900/60 p-10 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg border border-accent/30 bg-accent/12 text-accent">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <p className="text-lg font-semibold tracking-tight text-soc-100">AI SOC</p>
              <p className="text-[11px] uppercase tracking-widest text-soc-400">Security Operations Center</p>
            </div>
          </div>
          <h1 className="mt-10 max-w-md text-3xl font-semibold leading-tight text-soc-100">
            Detect, investigate and explain — <span className="text-accent">in one console.</span>
          </h1>
          <p className="mt-3 max-w-md text-sm text-soc-300">
            A analyst-first SOC surface: live alert streaming, incident timelines, entity enrichment and an assistant that keeps evidence
            separate from hypothesis.
          </p>
        </div>

        <ul className="grid gap-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3 rounded-lg border border-soc-800 bg-soc-950/50 p-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-soc-800 text-accent">
                <f.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-soc-100">{f.title}</p>
                <p className="text-xs text-soc-400">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg border border-accent/30 bg-accent/12 text-accent">
              <ShieldCheck className="size-4" />
            </span>
            <p className="text-base font-semibold text-soc-100">AI SOC</p>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-soc-100">Sign in to the console</h2>
          <p className="mt-1 text-sm text-soc-400">Analyst credentials are required to open the dashboard.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <TextField
              label='Email'
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              error={emailError}
              placeholder="analyst@aisoc.dev"
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              error={passwordError}
              placeholder="••••••••"
            />

            {(error || banner) && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>{error ?? banner}</span>
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" busy={signingIn} disabled={!formValid || signingIn}>
              {signingIn ? 'Verifying…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-soc-700/60 bg-soc-900/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-soc-400">Demo credentials</p>
            <p className="mt-1.5 text-xs text-soc-300">
              Phase 1 authenticates the two identities the backend seeds in Phase 2. Password:{' '}
              <code className="rounded bg-soc-800 px-1.5 py-0.5 font-mono text-[11px] text-accent">{DEMO_PASSWORD_HINT}</code>
            </p>
            <div className="mt-3 grid gap-2">
              {DEMO_CREDENTIALS.map((c, i) => (
                <button
                  key={c.email}
                  type="button"
                  onClick={() => fillDemo(i)}
                  className="flex items-center justify-between rounded-md border border-soc-700 bg-soc-800/60 px-3 py-2 text-left text-xs transition-colors hover:border-accent/40 hover:bg-soc-750"
                >
                  <span className="font-mono text-soc-200">{c.email}</span>
                  <span className={`chip ${c.role === 'admin' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-sky-500/30 bg-sky-500/10 text-sky-300'}`}>
                    {c.role}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-soc-500">
              {IS_MOCK ? 'Data source: bundled sample store (VITE_DATA_SOURCE=mock).' : 'Data source: FastAPI backend.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
