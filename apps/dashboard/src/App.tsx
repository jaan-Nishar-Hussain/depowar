import { useCallback, useEffect, useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { Overview } from './sections/Overview';
import { Deposits } from './sections/Deposits';
import { Recipients } from './sections/Recipients';
import { Access } from './sections/Access';
import { Analytics } from './sections/Analytics';
import { Organization } from './sections/Organization';
import { useApi } from './lib/useApi';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const SECTIONS = ['overview', 'deposits', 'recipients', 'access', 'analytics', 'organization'] as const;
type Section = typeof SECTIONS[number];

type Project = { id: string; name: string; environment?: string };
type Workspace = { id: string; name: string; projects: Array<{ id: string; name: string; clientId?: string; liveClientId?: string }> };

function authFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { token: params.get('auth_token') ?? '', onboardingToken: params.get('onboarding_token') ?? '', email: params.get('auth_email') ?? '' };
}

export function App() {
  const [activeSection, setActiveSection] = useState<Section>(() => (SECTIONS as readonly string[]).includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) as Section : 'overview');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('paymesh_auth_token') ?? authFromHash().token);
  const [onboardingToken, setOnboardingToken] = useState(() => authFromHash().onboardingToken);
  const [authEmail, setAuthEmail] = useState(() => localStorage.getItem('paymesh_auth_email') ?? (authFromHash().email || 'Signed-in user'));
  const [organizationName, setOrganizationName] = useState('');
  const [client, setClient] = useState<PayMeshClient | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [environmentMode, setEnvironmentMode] = useState<'TEST' | 'LIVE'>('TEST');
  const [message, setMessage] = useState('');

  // Sidebar data (project + workspace/project lists for the switchers).
  const projectData = useApi(client, (c) => c.getProject() as Promise<Project>);
  const workspacesData = useApi(client, (c) => c.listWorkspaces() as Promise<Workspace[]>);
  const projectsData = useApi(client, (c) => c.listProjects() as Promise<Array<Project & { clientId?: string; liveClientId?: string }>>);

  const project = projectData.data;
  const workspaces = workspacesData.data ?? [];
  const projects = projectsData.data ?? [];

  useEffect(() => {
    if (!project) return;
    setEnvironmentMode(project.environment === 'LIVE' ? 'LIVE' : 'TEST');
    const currentWorkspace = workspaces.find((w) => w.projects.some((p) => p.clientId === project.id || p.liveClientId === project.id));
    if (currentWorkspace && !workspaceId) setWorkspaceId(currentWorkspace.id);
    const currentProject = projects.find((p) => p.clientId === project.id || p.liveClientId === project.id);
    if (currentProject && !projectId) setProjectId(currentProject.id);
  }, [project, workspaces, projects, workspaceId, projectId]);

  useEffect(() => {
    const incoming = authFromHash();
    if (incoming.token) {
      localStorage.setItem('paymesh_auth_token', incoming.token);
      if (incoming.email) localStorage.setItem('paymesh_auth_email', incoming.email);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#overview`);
    } else if (incoming.onboardingToken) {
      setOnboardingToken(incoming.onboardingToken);
      if (incoming.email) setAuthEmail(incoming.email);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#overview`);
    }
    const onHashChange = () => setActiveSection((SECTIONS as readonly string[]).includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) as Section : 'overview');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!authToken) return;
    setClient(new PayMeshClient({ baseUrl: API_URL, authToken }));
  }, [authToken]);

  async function completeGoogleOnboarding() {
    if (!onboardingToken || !organizationName.trim()) return;
    try {
      const response = await fetch(`${API_URL}/v1/auth/google/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboardingToken, organizationName: organizationName.trim() }) });
      const body = await response.json() as { accessToken?: string; user?: { email: string }; error?: { userMessage?: string } };
      if (!response.ok || !body.accessToken) throw new Error(body.error?.userMessage ?? 'Unable to finish setup.');
      localStorage.setItem('paymesh_auth_token', body.accessToken);
      localStorage.setItem('paymesh_auth_email', body.user?.email ?? authEmail);
      setAuthToken(body.accessToken);
      setOnboardingToken('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to finish setup.'); }
  }

  function logout() {
    localStorage.removeItem('paymesh_auth_token');
    localStorage.removeItem('paymesh_auth_email');
    setAuthToken('');
    setAuthEmail('Signed-in user');
    setClient(null);
  }

  const refreshSession = useCallback(async () => {
    await projectData.refresh();
    await workspacesData.refresh();
    await projectsData.refresh();
  }, [projectData, workspacesData, projectsData]);

  async function switchWorkspace(id: string) {
    if (!client || id === workspaceId) return;
    try {
      const session = await client.switchWorkspace(id);
      localStorage.setItem('paymesh_auth_token', session.accessToken);
      setAuthToken(session.accessToken); // recreates the client bound to the new workspace
      setWorkspaceId(id);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to switch workspace.'); }
  }
  async function switchProject(id: string, environment: 'TEST' | 'LIVE' = 'TEST') {
    if (!client || (id === projectId && environment === environmentMode)) return;
    try {
      const session = await client.switchProject(id, environment);
      localStorage.setItem('paymesh_auth_token', session.accessToken);
      setAuthToken(session.accessToken); // recreates the client bound to the new project/environment
      setProjectId(id);
      setEnvironmentMode(environment);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to switch project.'); }
  }

  if (!authToken) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand"><span className="brand-mark">D</span><span>Depowar</span></div>
          {onboardingToken ? (
            <>
              <p className="eyebrow">ONE LAST STEP</p>
              <h1>Name your organization</h1>
              <p className="muted">You signed in with Google. Choose the organization name you’ll use in Depowar.</p>
              <label>Organization name<input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Your organization" /></label>
              <button className="primary" onClick={completeGoogleOnboarding} disabled={!organizationName.trim()}>Continue to dashboard</button>
            </>
          ) : (
            <>
              <p className="eyebrow">WELCOME TO DEPOWAR</p>
              <h1>Sign in with Google</h1>
              <p className="muted">Access your Depowar developer dashboard.</p>
              <button className="google-button" onClick={() => { window.location.href = `${API_URL}/v1/auth/google`; }}>Continue with Google</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const navItems: Array<[Section, string, string]> = [
    ['overview', 'Overview', 'grid'], ['deposits', 'Deposits', 'receipt'],
    ['recipients', 'Recipients', 'user'], ['access', 'Access', 'key'],
    ['analytics', 'Analytics', 'chart'], ['organization', 'Organization', 'building'],
  ];

  return (
    <div className="shell">
      <aside>
        <div className="brand"><span className="brand-mark">D</span><span>Depowar</span></div>
        <p className="muted">Developer control center</p>
        <nav aria-label="Dashboard sections">
          {navItems.map(([id, label, icon]) => (
            <a className={activeSection === id ? 'active' : ''} href={`#${id}`} aria-current={activeSection === id ? 'page' : undefined} key={id}>
              <NavIcon type={icon as NavIconType} />{label}
            </a>
          ))}
        </nav>
        <div className="workspace-switcher">
          <span>WORKSPACE</span>
          <select aria-label="Workspace" value={workspaceId} onChange={(e) => switchWorkspace(e.target.value)}>
            {workspaces.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}
          </select>
          <span className="project-label">PROJECT</span>
          <select aria-label="Project" value={projectId} onChange={(e) => switchProject(e.target.value, environmentMode)}>
            {projects.map((p) => <option value={p.id} key={p.id}>{p.name} · {p.environment}</option>)}
          </select>
        </div>
        <div className="sidebar-account">
          <div className="account-avatar">{authEmail.slice(0, 1).toUpperCase()}</div>
          <div className="account-details">
            <strong>{authEmail}</strong>
            <span>{project?.name ?? 'Your project'}</span>
          </div>
          <button className="account-logout" onClick={logout}>Sign out</button>
        </div>
        <div className="aside-foot">Cross-chain routing & settlement.</div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">PROJECT CONSOLE</p>
            <h1>{project?.name ?? 'Your project'}</h1>
            <p className="muted">Configure settlement once. Your users choose their source chain.</p>
          </div>
          <div className="header-actions">
            <div className={`environment-toggle ${environmentMode === 'TEST' ? 'test' : 'live'}`}>
              <button className={environmentMode === 'TEST' ? 'selected' : ''} onClick={() => switchProject(projectId, 'TEST')}>Test</button>
              <button className={environmentMode === 'LIVE' ? 'selected' : ''} onClick={() => switchProject(projectId, 'LIVE')}>Live</button>
            </div>
          </div>
        </header>
        {environmentMode === 'TEST' && <div className="mode-banner">TEST MODE — transactions and keys are isolated from live payments.</div>}
        {message && <div className="notice">{message}</div>}

        {activeSection === 'overview' && client && <Overview client={client} />}
        {activeSection === 'deposits' && client && <Deposits client={client} />}
        {activeSection === 'recipients' && client && <Recipients client={client} />}
        {activeSection === 'access' && client && <Access client={client} />}
        {activeSection === 'analytics' && client && <Analytics client={client} />}
        {activeSection === 'organization' && client && <Organization client={client} onSessionChange={refreshSession} onSwitchWorkspace={switchWorkspace} onSwitchProject={switchProject} />}

        <footer><span className="dashboard-message" role="status">Depowar dashboard · API: {API_URL}</span></footer>
      </main>
    </div>
  );
}

type NavIconType = 'grid' | 'key' | 'receipt' | 'chart' | 'building' | 'user';

function NavIcon({ type }: { type: NavIconType }) {
  const paths: Record<NavIconType, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 7-7m0 0 3 3m-3-3-3-3" /></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-5 3 2 5-7" /></>,
    building: <><path d="M4 21V5l8-2 8 2v16M2 21h20" /><path d="M8 8h1M15 8h1M8 12h1M15 12h1M8 16h1M15 16h1" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{paths[type]}</svg>;
}