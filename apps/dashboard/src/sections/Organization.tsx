import { useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { Card, StatusTag, EmptyState, Spinner, Field } from '../components/ui';
import { useApi } from '../lib/useApi';

type Project = { id: string; name: string; environment: string; clientId?: string; liveClientId?: string };
type Workspace = { id: string; name: string; projects: Project[] };

export function Organization({ client, onSessionChange }: { client: PayMeshClient; onSessionChange: () => Promise<void> }) {
  const [orgName, setOrgName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [wallet, setWallet] = useState('');
  const [chainId, setChainId] = useState(137);
  const [token, setToken] = useState('USDC');
  const [msg, setMsg] = useState('');

  const project = useApi(client, async (c) => {
    const p = (await c.getProject()) as { id: string; name: string; environment?: string };
    setOrgName(p.name);
    return p;
  });
  const workspaces = useApi(client, (c) => c.listWorkspaces() as Promise<Workspace[]>);

  async function renameOrg() {
    if (!orgName.trim()) return;
    try { await client.updateProject(orgName.trim()); setMsg('Organization name updated.'); await project.refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to update.'); }
  }
  async function createWorkspace() {
    const name = window.prompt('Workspace name');
    if (!name?.trim()) return;
    try { const created = await client.createWorkspace(name.trim()); setMsg(`Workspace "${created.name}" created.`); await workspaces.refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to create workspace.'); }
  }
  async function switchWorkspace(id: string) {
    try { await client.switchWorkspace(id); setMsg('Switched workspace.'); await onSessionChange(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to switch.'); }
  }
  async function createProject() {
    if (!newProjectName.trim() || !/^0x[a-fA-F0-9]{40}$/.test(wallet.trim())) {
      setMsg('Enter a project name and a valid receiver address.');
      return;
    }
    try {
      const created = await client.createProject(newProjectName.trim(), wallet.trim() as `0x${string}`, chainId, token as 'USDC' | 'USDT');
      setNewProjectName(''); setWallet('');
      setMsg(`Project "${created.project.name}" created — check the Access tab for its API key.`);
      await workspaces.refresh();
      await onSessionChange();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to create project.'); }
  }

  return (
    <div className="organization-page">
      <div className="grid">
        <Card title="Organization" eyebrow="WORKSPACE">
          {project.loading ? <Spinner /> : (
            <>
              <Field label="Organization name">
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Your organization" />
              </Field>
              <button className="primary" onClick={renameOrg} disabled={!orgName.trim()}>Save name</button>
            </>
          )}
          {msg && <div className="notice">{msg}</div>}
        </Card>

        <Card title="Workspaces" eyebrow="MULTI-PROJECT"
          actions={<button onClick={createWorkspace} disabled={!client}>+ New workspace</button>}>
          {workspaces.loading ? <Spinner /> : (workspaces.data ?? []).length === 0 ? <EmptyState message="No workspaces yet." /> : (
            <div className="records">
              {(workspaces.data ?? []).map((w) => (
                <div className="record" key={w.id}>
                  <span><strong>{w.name}</strong></span>
                  <span>{w.projects.length} projects</span>
                  <button className="link-btn" onClick={() => switchWorkspace(w.id)}>Switch</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Create project" eyebrow="NEW PROJECT" className="project-create-card">
        <p className="muted">Creates a TEST/LIVE pair, a receiver, and a first API key.</p>
        <Field label="Project name">
          <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="e.g. Production" />
        </Field>
        <div className="two">
          <Field label="Receiver wallet">
            <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" />
          </Field>
          <div className="two">
            <Field label="Destination chain">
              <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
                {[1, 8453, 137, 43114, 42161, 10, 59144, 143].map((id) => <option value={id} key={id}>Chain {id}</option>)}
              </select>
            </Field>
            <Field label="Token">
              <select value={token} onChange={(e) => setToken(e.target.value)}><option>USDC</option><option>USDT</option></select>
            </Field>
          </div>
        </div>
        <button className="primary" onClick={createProject} disabled={!client}>Create project</button>
      </Card>
    </div>
  );
}