import { useCallback, useEffect, useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const CHAINS = [
  [1, 'Ethereum'], [8453, 'Base'], [137, 'Polygon'], [43114, 'Avalanche'],
  [42161, 'Arbitrum'], [10, 'Optimism'], [59144, 'Linea'], [143, 'Monad'],
] as const;

type Project = { id: string; name: string; _count?: { apiKeys: number; recipients: number; depositIntents: number } };
type Analytics = { totalDeposits: number; settledDeposits: number; successRate: number; averageSettlementTimeSeconds: number; recentDeposits: Array<{ id: string; status: string; toChainId: number; toToken: string }> };

function authFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { token: params.get('auth_token') ?? '', email: params.get('auth_email') ?? '' };
}

export function App() {
  const [activeSection, setActiveSection] = useState(() => ['overview', 'api', 'transactions', 'analytics', 'organization'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('paymesh_auth_token') ?? authFromHash().token);
  const [authEmail, setAuthEmail] = useState(() => localStorage.getItem('paymesh_auth_email') ?? (authFromHash().email || 'Signed-in user'));
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [client, setClient] = useState<PayMeshClient | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [keys, setKeys] = useState<unknown[]>([]);
  const [recipients, setRecipients] = useState<unknown[]>([]);
  const [wallet, setWallet] = useState('');
  const [chainId, setChainId] = useState(137);
  const [token, setToken] = useState('USDC');
  const [newKey, setNewKey] = useState('');
  const [projectName, setProjectName] = useState('');
  const [message, setMessage] = useState('Enter a management API key to load your project.');

  const load = useCallback(async (sdk: PayMeshClient) => {
    setMessage('Loading project data…');
    try {
      const [p, a, k, r] = await Promise.all([sdk.getProject(), sdk.getAnalytics(), sdk.listApiKeys(), sdk.listRecipients()]);
      setProject(p as Project); setProjectName((p as Project).name); setAnalytics(a as Analytics); setKeys(k); setRecipients(r); setMessage('Connected');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load dashboard data.'); }
  }, []);

  useEffect(() => {
    const incoming = authFromHash();
    if (incoming.token) {
      localStorage.setItem('paymesh_auth_token', incoming.token);
      if (incoming.email) localStorage.setItem('paymesh_auth_email', incoming.email);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#overview`);
    }
    const onHashChange = () => setActiveSection(window.location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (!authToken) return;
    const sdk = new PayMeshClient({ baseUrl: API_URL, authToken });
    setClient(sdk); void load(sdk);
  }, [authToken, load]);

  async function authenticate() {
    setMessage(authMode === 'login' ? 'Signing in…' : 'Creating your account…');
    try {
      const response = await fetch(`${API_URL}/v1/auth/${authMode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authMode === 'login' ? { email, password } : { email, password, organizationName }) });
      const body = await response.json() as { accessToken?: string; error?: { userMessage?: string } };
      if (!response.ok || !body.accessToken) throw new Error(body.error?.userMessage ?? 'Unable to authenticate.');
      localStorage.setItem('paymesh_auth_token', body.accessToken); localStorage.setItem('paymesh_auth_email', email.trim().toLowerCase()); setAuthEmail(email.trim().toLowerCase()); setAuthToken(body.accessToken);
      const sdk = new PayMeshClient({ baseUrl: API_URL, authToken: body.accessToken }); setClient(sdk); void load(sdk);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to authenticate.'); }
  }

  function logout() {
    localStorage.removeItem('paymesh_auth_token'); localStorage.removeItem('paymesh_auth_email'); setAuthToken(''); setAuthEmail('Signed-in user'); setClient(null); setProject(null); setAnalytics(null);
  }

  if (!authToken) return <div className="auth-shell"><div className="auth-card"><div className="brand"><span className="brand-mark">D</span><span>Depowar</span></div><p className="eyebrow">{authMode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</p><h1>{authMode === 'login' ? 'Sign in to your project' : 'Create your account'}</h1><p className="muted">{authMode === 'login' ? 'Access your Depowar developer dashboard.' : 'Set up your organization and start building.'}</p><button className="google-button" onClick={() => { window.location.href = `${API_URL}/v1/auth/google`; }}>Continue with Google</button><div className="auth-divider"><span>or use email</span></div><label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>{authMode === 'register' && <label>Organization name<input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Your organization" /></label>}<label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label><button className="primary" onClick={authenticate}>{authMode === 'login' ? 'Sign in' : 'Create account'}</button><p className="auth-switch">{authMode === 'login' ? 'New to Depowar?' : 'Already have an account?'} <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p>{message !== 'Enter a management API key to load your project.' && <p className="auth-error">{message}</p>}</div></div>;

  async function createRecipient() {
    if (!client) return;
    try { await client.createRecipient({ walletAddress: wallet as `0x${string}`, chainId, token }); setWallet(''); await load(client); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create recipient.'); }
  }
  async function createKey() {
    if (!client) return;
    try { const result = await client.createApiKey(['deposits', 'quote', 'webhooks']); setNewKey(result.key); await load(client); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create API key.'); }
  }
  async function updateProject() {
    if (!client || !projectName.trim()) return;
    try { await client.updateProject(projectName.trim()); await load(client); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update organization.'); }
  }

  const navItems = [
    ['overview', 'Overview', 'grid'],
    ['api', 'APIs', 'key'],
    ['transactions', 'Transactions', 'receipt'],
    ['analytics', 'Analytics', 'chart'],
    ['organization', 'Organizations', 'building'],
  ] as const;

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-mark">D</span><span>Depowar</span></div>
      <p className="muted">Developer control center</p>
      <nav aria-label="Dashboard sections">
        {navItems.map(([id, label, icon]) => <a className={activeSection === id ? 'active' : ''} href={`#${id}`} aria-current={activeSection === id ? 'page' : undefined} key={id}><NavIcon type={icon} />{label}</a>)}
      </nav>
      <div className="sidebar-account"><div className="account-avatar">{authEmail.slice(0, 1).toUpperCase()}</div><div className="account-details"><strong>{authEmail}</strong><span>{project?.name ?? 'Your organization'}</span></div><button className="account-logout" onClick={logout}>Sign out</button></div><div className="aside-foot">LI.FI routing is managed by Depowar.</div>
    </aside>
    <main><header><div><p className="eyebrow">PROJECT CONSOLE</p><h1>{project?.name ?? 'Your project'}</h1><p className="muted">Configure settlement once. Your users choose their source chain.</p></div></header>
      {activeSection === 'overview' && <>
        <section className="stats"><Stat label="Deposits" value={analytics?.totalDeposits ?? '—'} /><Stat label="Settled" value={analytics?.settledDeposits ?? '—'} /><Stat label="Success rate" value={analytics ? `${(analytics.successRate * 100).toFixed(1)}%` : '—'} /><Stat label="Avg. settlement" value={analytics ? `${analytics.averageSettlementTimeSeconds}s` : '—'} /></section>
        <section className="card"><p className="eyebrow">SETTLEMENT DESTINATION</p><h2>Recipient</h2><p className="muted">Funds will settle to this wallet on the selected chain and token.</p><label>Wallet address<input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" /></label><div className="two"><label>Destination chain<select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>{CHAINS.map(([id, name]) => <option value={id} key={id}>{name} · {id}</option>)}</select></label><label>Token<select value={token} onChange={(e) => setToken(e.target.value)}><option>USDC</option><option>USDT</option></select></label></div><button className="primary" disabled={!client || !wallet} onClick={createRecipient}>Save destination</button>{recipients.length > 0 && <div className="records">{recipients.slice(0, 3).map((r: any) => <div className="record" key={r.id}><span>{r.walletAddress.slice(0, 8)}…{r.walletAddress.slice(-6)}</span><span>{r.preferredChainId} · {r.preferredToken === 'native' ? 'native' : token}</span></div>)}</div>}</section>
      </>}
      {activeSection === 'api' && <section className="card page-card"><div className="section-head"><div><p className="eyebrow">ACCESS</p><h2>API keys</h2></div><button onClick={createKey} disabled={!client}>Create key</button></div><p className="muted">Keys authenticate SDK requests. The plaintext is shown only once.</p>{newKey && <div className="secret"><code>{newKey}</code><button onClick={() => navigator.clipboard?.writeText(newKey)}>Copy</button></div>}<div className="records">{keys.slice(0, 5).map((k: any) => <div className="record" key={k.id}><span><code>{k.id}</code></span><span>{k.enabled ? 'Active' : 'Revoked'}</span></div>)}</div></section>}
      {activeSection === 'transactions' && <section className="card table-card page-card"><div className="section-head"><div><p className="eyebrow">ACTIVITY</p><h2>Transactions</h2></div><span className="muted">Last 30 days</span></div><div className="table">{analytics?.recentDeposits?.length ? analytics.recentDeposits.map((d) => <div className="row" key={d.id}><code>{d.id}</code><span>{d.toChainId}</span><span>{d.status}</span></div>) : <p className="empty">No deposits in this period.</p>}</div></section>}
      {activeSection === 'analytics' && <section className="card analytics-card page-card"><div className="section-head"><div><p className="eyebrow">INSIGHTS</p><h2>Analytics</h2></div><span className="muted">Last 30 days</span></div><p className="muted">Monitor deposit volume and settlement performance across your project.</p><div className="analytics-grid"><div className="metric"><span>Total deposits</span><strong>{analytics?.totalDeposits ?? '—'}</strong></div><div className="metric"><span>Settled deposits</span><strong>{analytics?.settledDeposits ?? '—'}</strong></div><div className="metric"><span>Success rate</span><strong>{analytics ? `${(analytics.successRate * 100).toFixed(1)}%` : '—'}</strong></div><div className="metric"><span>Avg. settlement</span><strong>{analytics ? `${analytics.averageSettlementTimeSeconds}s` : '—'}</strong></div></div><div className="chart-placeholder"><span>Settlement activity</span><small>{analytics?.recentDeposits?.length ? 'Recent activity is available in Transactions.' : 'No chart data for this period yet.'}</small></div></section>}
      {activeSection === 'organization' && <section className="card organization-card page-card"><p className="eyebrow">WORKSPACE</p><h2>Organization</h2><p className="muted">Manage the organization name used by your team and SDK integrations.</p><label>Organization name<input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Your organization" /></label><button className="primary" disabled={!client || !projectName.trim()} onClick={updateProject}>Save organization</button></section>}
      <footer>Depowar dashboard · API: {API_URL}</footer>
    </main>
  </div>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }

function NavIcon({ type }: { type: 'grid' | 'key' | 'receipt' | 'chart' | 'building' }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 7-7m0 0 3 3m-3-3-3-3" /></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-5 3 2 5-7" /></>,
    building: <><path d="M4 21V5l8-2 8 2v16M2 21h20" /><path d="M8 8h1M15 8h1M8 12h1M15 12h1M8 16h1M15 16h1" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{paths[type]}</svg>;
}
