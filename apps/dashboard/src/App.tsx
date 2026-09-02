import { useCallback, useEffect, useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const CHAINS = [
  [1, 'Ethereum'], [8453, 'Base'], [137, 'Polygon'], [43114, 'Avalanche'],
  [42161, 'Arbitrum'], [10, 'Optimism'], [59144, 'Linea'], [143, 'Monad'],
] as const;

type Project = { id: string; name: string; environment?: string; _count?: { apiKeys: number; recipients: number; depositIntents: number } };
type Analytics = { totalDeposits: number; settledDeposits: number; successRate: number; averageSettlementTimeSeconds: number; recentDeposits: Array<{ id: string; status: string; toChainId: number; toToken: string }> };
type Workspace = { id: string; name: string; projects: Array<{ id: string; name: string; clientId?: string; liveClientId?: string }> };

function authFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { token: params.get('auth_token') ?? '', onboardingToken: params.get('onboarding_token') ?? '', email: params.get('auth_email') ?? '' };
}

export function App() {
  const [activeSection, setActiveSection] = useState(() => ['overview', 'projects', 'transactions', 'analytics', 'organization'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('paymesh_auth_token') ?? authFromHash().token);
  const [onboardingToken, setOnboardingToken] = useState(() => authFromHash().onboardingToken);
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
  const [selectedRecipientId, setSelectedRecipientId] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string; environment: string; clientId?: string }>>([]);
  const [projectId, setProjectId] = useState('');
  const [environmentMode, setEnvironmentMode] = useState<'TEST' | 'LIVE'>('TEST');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectEnvironment, setNewProjectEnvironment] = useState<'DEVELOPMENT' | 'STAGING' | 'PRODUCTION'>('DEVELOPMENT');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [wallet, setWallet] = useState('');
  const [chainId, setChainId] = useState(137);
  const [token, setToken] = useState('USDC');
  const [newKey, setNewKey] = useState('');
  const [projectName, setProjectName] = useState('');
  const [message, setMessage] = useState('Enter a management API key to load your project.');

  const load = useCallback(async (sdk: PayMeshClient) => {
    setMessage('Loading project data…');
    try {
      const [p, a, k, r, w, projectList] = await Promise.all([sdk.getProject(), sdk.getAnalytics(), sdk.listApiKeys(), sdk.listRecipients(), sdk.listWorkspaces(), sdk.listProjects()]);
      setProject(p as Project); setProjectName((p as Project).name); setEnvironmentMode((p as Project).environment === 'LIVE' ? 'LIVE' : 'TEST'); setAnalytics(a as Analytics); setKeys(k); setRecipients(r); setWorkspaces(w); setProjects(projectList); const currentWorkspace = w.find((workspace) => workspace.projects.some((workspaceProject) => workspaceProject.clientId === (p as Project).id || workspaceProject.liveClientId === (p as Project).id)); if (currentWorkspace) setWorkspaceId(currentWorkspace.id); const currentProject = projectList.find((item) => item.clientId === (p as Project).id || item.liveClientId === (p as Project).id); if (currentProject) setProjectId(currentProject.id); const firstRecipient = (r as any[])[0]; if (firstRecipient) { setSelectedRecipientId(firstRecipient.id); setChainId(firstRecipient.preferredChainId ?? 137); setToken(firstRecipient.preferredToken ?? 'USDC'); } setMessage('Connected');
    } catch (error) { if (error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 401) { logout(); return; } setMessage(error instanceof Error ? error.message : 'Unable to load dashboard data.'); }
  }, []);

  useEffect(() => {
    const incoming = authFromHash();
    if (incoming.token) {
      localStorage.setItem('paymesh_auth_token', incoming.token);
      if (incoming.email) localStorage.setItem('paymesh_auth_email', incoming.email);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#overview`);
    } else if (incoming.onboardingToken) {
      setOnboardingToken(incoming.onboardingToken); if (incoming.email) setAuthEmail(incoming.email); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#overview`);
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

  async function completeGoogleOnboarding() {
    if (!onboardingToken || !organizationName.trim()) return;
    setMessage('Setting up your organization…');
    try {
      const response = await fetch(`${API_URL}/v1/auth/google/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboardingToken, organizationName: organizationName.trim() }) });
      const body = await response.json() as { accessToken?: string; user?: { email: string }; error?: { userMessage?: string } };
      if (!response.ok || !body.accessToken) throw new Error(body.error?.userMessage ?? 'Unable to finish setup.');
      localStorage.setItem('paymesh_auth_token', body.accessToken); localStorage.setItem('paymesh_auth_email', body.user?.email ?? authEmail); setAuthToken(body.accessToken); setOnboardingToken('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to finish setup.'); }
  }

  function logout() {
    localStorage.removeItem('paymesh_auth_token'); localStorage.removeItem('paymesh_auth_email'); setAuthToken(''); setAuthEmail('Signed-in user'); setClient(null); setProject(null); setAnalytics(null);
  }

  if (!authToken) return <div className="auth-shell"><div className="auth-card"><div className="brand"><span className="brand-mark">D</span><span>Depowar</span></div>{onboardingToken ? <><p className="eyebrow">ONE LAST STEP</p><h1>Name your organization</h1><p className="muted">You signed in with Google. Choose the organization name you’ll use in Depowar.</p><label>Organization name<input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Your organization" /></label><button className="primary" onClick={completeGoogleOnboarding} disabled={!organizationName.trim()}>Continue to dashboard</button></> : <><p className="eyebrow">WELCOME TO DEPOWAR</p><h1>Sign in to your project</h1><p className="muted">Access your Depowar developer dashboard.</p><button className="google-button" onClick={() => { window.location.href = `${API_URL}/v1/auth/google`; }}>Continue with Google</button></>}</div></div>;

  async function createRecipient() {
    if (!client) return;
    try { await client.createRecipient({ walletAddress: wallet as `0x${string}`, chainId, token }); setWallet(''); await load(client); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create recipient.'); }
  }
  async function updateRecipient() {
    if (!client || !selectedRecipientId) return;
    try { await client.updateSettlement(selectedRecipientId, { chainId, token }); await load(client); setMessage('Receiver settings updated'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update receiver settings.'); }
  }
  function selectRecipient(id: string) {
    const recipient = recipients.find((item: any) => item.id === id) as any;
    setSelectedRecipientId(id); if (recipient) { setChainId(recipient.preferredChainId ?? 137); setToken(recipient.preferredToken ?? 'USDC'); }
  }
  async function createKey() {
    if (!client) return;
    try { const result = await client.createApiKey(['deposits', 'quote', 'webhooks']); setNewKey(result.key); await load(client); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create API key.'); }
  }
  async function createWorkspace() {
    const name = window.prompt('Workspace name');
    if (!client || !name?.trim()) return;
    try { const created = await client.createWorkspace(name.trim()) as Workspace; const session = await client.switchWorkspace(created.id); localStorage.setItem('paymesh_auth_token', session.accessToken); setWorkspaceId(created.id); setAuthToken(session.accessToken); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create workspace.'); }
  }
  async function switchWorkspace(id: string) {
    if (!client || id === workspaceId) return;
    try { const session = await client.switchWorkspace(id); localStorage.setItem('paymesh_auth_token', session.accessToken); setNewKey(''); setWorkspaceId(id); setAuthToken(session.accessToken); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to switch workspace.'); }
  }
  async function createProject() {
    if (!client) { setMessage('Your session is still loading. Please try again.'); return; }
    if (!newProjectName.trim()) { setMessage('Enter a project name.'); return; }
    if (!wallet.trim()) { setMessage('Enter a receiver address.'); return; }
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.trim())) { setMessage('Enter a valid 0x receiver address with 40 hexadecimal characters.'); return; }
    setMessage('Creating project, receiver, and test API key…');
    try { const created = await client.createProject(newProjectName.trim(), wallet.trim() as `0x${string}`, chainId, token as 'USDC' | 'USDT', crypto.randomUUID()); setNewKey(created.apiKey.key); const session = await client.switchProject(created.project.id); setNewProjectName(''); setWallet(''); localStorage.setItem('paymesh_auth_token', session.accessToken); setProjectId(created.project.id); setAuthToken(session.accessToken); setMessage('Project created. Copy your API key now; it will not be shown again.'); } catch (error) { console.error('Project creation failed', error); setMessage(error instanceof Error ? error.message : 'Unable to create project.'); }
  }
  async function switchProject(id: string) {
    if (!client || id === projectId) return;
    try { const session = await client.switchProject(id); localStorage.setItem('paymesh_auth_token', session.accessToken); setNewKey(''); setProjectId(id); setAuthToken(session.accessToken); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to switch project.'); }
  }
  async function switchEnvironment(next: 'TEST' | 'LIVE') {
    if (!client || !projectId || next === environmentMode) return;
    try { const session = await client.switchProject(projectId, next); localStorage.setItem('paymesh_auth_token', session.accessToken); setNewKey(''); setEnvironmentMode(next); setAuthToken(session.accessToken); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to switch environment.'); }
  }
  async function updateProject() {
    if (!client || !projectName.trim()) return;
    try { await client.updateProject(projectName.trim()); await load(client); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update organization.'); }
  }

  const navItems = [
    ['overview', 'Overview', 'grid'],
    ['projects', 'Projects', 'key'],
    ['transactions', 'Transactions', 'receipt'],
    ['analytics', 'Analytics', 'chart'],
    ['organization', 'Organizations', 'building'],
  ] as const;

  return <div className={`shell ${showCreateProject ? 'show-create-project' : ''}`}>
    <aside>
      <div className="brand"><span className="brand-mark">D</span><span>Depowar</span></div>
      <p className="muted">Developer control center</p>
      <nav aria-label="Dashboard sections">
        {navItems.map(([id, label, icon]) => <a className={activeSection === id ? 'active' : ''} href={`#${id}`} aria-current={activeSection === id ? 'page' : undefined} key={id}><NavIcon type={icon} />{label}</a>)}
      </nav>
      <div className="workspace-switcher"><span>WORKSPACE</span><select aria-label="Workspace" value={workspaceId} onChange={(e) => switchWorkspace(e.target.value)}>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select><button onClick={createWorkspace}>+ Create workspace</button><span className="project-label">PROJECT</span><select aria-label="Project" value={projectId} onChange={(e) => switchProject(e.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.environment}</option>)}</select></div><div className="sidebar-account"><div className="account-avatar">{authEmail.slice(0, 1).toUpperCase()}</div><div className="account-details"><strong>{authEmail}</strong><span>{workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? project?.name ?? 'Your organization'}</span></div><button className="account-logout" onClick={logout}>Sign out</button></div><div className="aside-foot">LI.FI routing is managed by Depowar.</div>
    </aside>
    <main><header><div><p className="eyebrow">PROJECT CONSOLE</p><h1>{project?.name ?? 'Your project'}</h1><p className="muted">Configure settlement once. Your users choose their source chain.</p></div><div className="header-actions"><div className={`environment-toggle ${environmentMode === 'TEST' ? 'test' : 'live'}`}><button className={environmentMode === 'TEST' ? 'selected' : ''} onClick={() => switchEnvironment('TEST')}>Test</button><button className={environmentMode === 'LIVE' ? 'selected' : ''} onClick={() => switchEnvironment('LIVE')}>Live</button></div>{activeSection === 'projects' && <button onClick={() => { setNewKey(''); setShowCreateProject((visible) => !visible); }}>{showCreateProject ? 'Cancel' : 'Create project'}</button>}</div></header>{environmentMode === 'TEST' && <div className="mode-banner">TEST MODE — transactions and keys are isolated from live payments.</div>}{activeSection === 'projects' && showCreateProject && <section className="card project-create setup-receiver"><p className="eyebrow">RECEIVER SETUP</p><h2>Settlement destination</h2><p className="muted">Add the wallet and preferred destination before creating the project.</p><label>Receiver wallet address<input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" /></label><div className="two"><label>Destination chain<select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>{CHAINS.map(([id, name]) => <option value={id} key={id}>{name} · {id}</option>)}</select></label><label>Settlement token<select value={token} onChange={(e) => setToken(e.target.value)}><option>USDC</option><option>USDT</option></select></label></div></section>}
      {activeSection === 'overview' && <>
        <section className="stats"><Stat label="Deposits" value={analytics?.totalDeposits ?? '—'} /><Stat label="Settled" value={analytics?.settledDeposits ?? '—'} /><Stat label="Success rate" value={analytics ? `${(analytics.successRate * 100).toFixed(1)}%` : '—'} /><Stat label="Avg. settlement" value={analytics ? `${analytics.averageSettlementTimeSeconds}s` : '—'} /></section>
        <section className="card"><p className="eyebrow">SETTLEMENT DESTINATION</p><h2>Recipient</h2><p className="muted">Funds will settle to this wallet on the selected chain and token.</p><label>Wallet address<input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" /></label><div className="two"><label>Destination chain<select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>{CHAINS.map(([id, name]) => <option value={id} key={id}>{name} · {id}</option>)}</select></label><label>Token<select value={token} onChange={(e) => setToken(e.target.value)}><option>USDC</option><option>USDT</option></select></label></div><button className="primary" disabled={!client || !wallet} onClick={createRecipient}>Save destination</button>{recipients.length > 0 && <div className="records">{recipients.slice(0, 3).map((r: any) => <div className="record" key={r.id}><span>{r.walletAddress.slice(0, 8)}…{r.walletAddress.slice(-6)}</span><span>{r.preferredChainId} · {r.preferredToken === 'native' ? 'native' : token}</span></div>)}</div>}</section>
      </>}
      {activeSection === 'projects' && <section className="project-page"><div className="project-heading"><p className="eyebrow">PROJECT SETTINGS</p><h2>{project?.name ?? 'Your project'}</h2><p className="muted">Manage projects, API access, and the receiver settlement destination.</p></div><section className="card project-create"><div><p className="eyebrow">NEW PROJECT</p><h2>Create project</h2><p className="muted">Enter the project details. A first API key will be generated automatically after creation.</p></div><div className="two"><label>Project name<input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Production" /></label><label>Environment<select value={newProjectEnvironment} onChange={(e) => setNewProjectEnvironment(e.target.value as typeof newProjectEnvironment)}><option value="DEVELOPMENT">Development</option><option value="STAGING">Staging</option><option value="PRODUCTION">Production</option></select></label></div><button className="primary" onClick={createProject} disabled={!client || !newProjectName.trim()}>Create project &amp; generate API key</button>{newKey && <div className="secret secret-create"><div><strong>Save this API key now</strong><span>It will only be displayed once.</span></div><code>{newKey}</code><button onClick={() => navigator.clipboard?.writeText(newKey)}>Copy key</button></div>}</section><div className="grid"><section className="card"><div className="section-head"><div><p className="eyebrow">ACCESS</p><h2>API keys</h2></div><button onClick={createKey} disabled={!client}>Create key</button></div><p className="muted">Additional keys authenticate SDK requests. Their plaintext is shown only once.</p><div className="records">{keys.slice(0, 5).map((k: any) => <div className="record" key={k.id}><span><code>{k.id}</code></span><span>{k.enabled ? 'Active' : 'Revoked'}</span></div>)}</div></section><section className="card"><div className="section-head"><div><p className="eyebrow">RECEIVER SETTINGS</p><h2>Settlement destination</h2></div></div><p className="muted">Choose where funds for this project should be settled. You can update the chain and token at any time.</p>{recipients.length > 0 ? <><label>Receiver<select value={selectedRecipientId || (recipients[0] as any).id} onChange={(e) => selectRecipient(e.target.value)}>{recipients.map((r: any) => <option value={r.id} key={r.id}>{r.walletAddress.slice(0, 8)}…{r.walletAddress.slice(-6)}</option>)}</select></label><div className="two"><label>Settlement chain<select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>{CHAINS.map(([id, name]) => <option value={id} key={id}>{name} · {id}</option>)}</select></label><label>Token<select value={token} onChange={(e) => setToken(e.target.value)}><option>USDC</option><option>USDT</option></select></label></div><button className="primary" onClick={updateRecipient} disabled={!client || !(selectedRecipientId || (recipients[0] as any).id)}>Update receiver</button></> : <p className="empty">No receiver configured yet.</p>}</section></div></section>}
      {activeSection === 'transactions' && <section className="card table-card page-card"><div className="section-head"><div><p className="eyebrow">ACTIVITY</p><h2>Transactions</h2></div><span className="muted">Last 30 days</span></div><div className="table">{analytics?.recentDeposits?.length ? analytics.recentDeposits.map((d) => <div className="row" key={d.id}><code>{d.id}</code><span>{d.toChainId}</span><span>{d.status}</span></div>) : <p className="empty">No deposits in this period.</p>}</div></section>}
      {activeSection === 'analytics' && <section className="card analytics-card page-card"><div className="section-head"><div><p className="eyebrow">INSIGHTS</p><h2>Analytics</h2></div><span className="muted">Last 30 days</span></div><p className="muted">Monitor deposit volume and settlement performance across your project.</p><div className="analytics-grid"><div className="metric"><span>Total deposits</span><strong>{analytics?.totalDeposits ?? '—'}</strong></div><div className="metric"><span>Settled deposits</span><strong>{analytics?.settledDeposits ?? '—'}</strong></div><div className="metric"><span>Success rate</span><strong>{analytics ? `${(analytics.successRate * 100).toFixed(1)}%` : '—'}</strong></div><div className="metric"><span>Avg. settlement</span><strong>{analytics ? `${analytics.averageSettlementTimeSeconds}s` : '—'}</strong></div></div><div className="chart-placeholder"><span>Settlement activity</span><small>{analytics?.recentDeposits?.length ? 'Recent activity is available in Transactions.' : 'No chart data for this period yet.'}</small></div></section>}
      {activeSection === 'organization' && <section className="card organization-card page-card"><p className="eyebrow">WORKSPACE</p><h2>Organization</h2><p className="muted">Manage the organization name used by your team and SDK integrations.</p><label>Organization name<input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Your organization" /></label><button className="primary" disabled={!client || !projectName.trim()} onClick={updateProject}>Save organization</button></section>}
      <footer><span className="dashboard-message" role="status">{message}</span> · Depowar dashboard · API: {API_URL}</footer>
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
