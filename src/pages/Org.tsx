import { KebabHorizontalIcon, MailIcon, PeopleIcon, PersonIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Avatar, Dropdown, ListState, LoadMore, Modal, Time, UserLink } from '../components/ui';
import { gh, invalidate, useGh, useGhAll, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, promptDialog, useAction } from '../lib/feedback';
import type { User } from '../lib/types';
import { plural } from '../lib/util';

// whether the viewer administers this org
export function useOrgAdmin(org: string) {
  const m = useGh<{ role: string; state: string }>(`/user/memberships/orgs/${org}`);
  return m.data?.role === 'admin' && m.data.state === 'active';
}

const ROLES = [
  { value: 'direct_member', label: 'Member' },
  { value: 'admin', label: 'Owner' },
];

export function OrgPeople({ org }: { org: string }) {
  const admin = useOrgAdmin(org);
  const { viewer } = useAuth();
  const members = useGhPages<User>(`/orgs/${org}/members?per_page=50`);
  const owners = useGhAll<User>(admin && `/orgs/${org}/members?role=admin&per_page=100`);
  const invites = useGh<{ id: number; login: string | null; email: string | null; role: string; created_at: string; inviter: User }[]>(admin && `/orgs/${org}/invitations?per_page=100`);
  const { busy, run } = useAction();
  const owner = new Set(owners.items.map((u) => u.login));
  const refresh = () => invalidate(`/orgs/${org}/`);
  const invite = async () => {
    const who = await promptDialog({ title: `Invite to ${org}`, label: 'Username or email', confirmLabel: 'Next' });
    if (!who) return;
    const role = await promptDialog({
      title: `Invite ${who}`,
      label: 'Role',
      options: [
        { value: 'direct_member', label: 'Member' },
        { value: 'admin', label: 'Owner' },
        { value: 'billing_manager', label: 'Billing manager' },
      ],
      confirmLabel: 'Send invitation',
    });
    if (!role) return;
    await run(async () => {
      const body = who.includes('@') ? { email: who, role } : { invitee_id: (await gh<User>(`/users/${encodeURIComponent(who.replace(/^@/, ''))}`)).id, role };
      await gh(`/orgs/${org}/invitations`, { method: 'POST', body });
      await refresh();
    }, `Invited ${who}`);
  };
  const setRole = async (u: User) => {
    const role = await promptDialog({ title: `Role for ${u.login}`, label: 'Role', options: ROLES, confirmLabel: 'Change role' });
    if (role) await run(async () => (await gh(`/orgs/${org}/memberships/${u.login}`, { method: 'PUT', body: { role: role === 'admin' ? 'admin' : 'member' } }), await refresh()), 'Role changed');
  };
  const remove = async (u: User) => {
    if (!(await confirmDialog({ title: `Remove ${u.login} from ${org}?`, body: 'They lose access to its private repositories.', confirmLabel: 'Remove', danger: true }))) return;
    await run(async () => (await gh(`/orgs/${org}/memberships/${u.login}`, { method: 'DELETE' }), await refresh()), `Removed ${u.login}`);
  };
  return (
    <div className="stack">
      {admin && (
        <div className="toolbar">
          <span className="muted">{members.items.length ? plural(members.items.length, 'member') : ''}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={busy} onClick={invite}>
            Invite member
          </button>
        </div>
      )}
      {admin && !!invites.data?.length && (
        <div className="card">
          <div className="card-head">
            <strong>Pending invitations</strong>
          </div>
          {invites.data.map((i) => (
            <div key={i.id} className="row compact">
              <span className="state-icon">
                <MailIcon />
              </span>
              <div className="row-main">
                <div className="row-title">
                  {i.login ?? i.email} <span className="badge">{i.role.replace('_', ' ')}</span>
                </div>
                <div className="meta">
                  invited by {i.inviter.login} <Time iso={i.created_at} />
                </div>
              </div>
              <button className="btn sm" disabled={busy} onClick={() => run(async () => (await gh(`/orgs/${org}/invitations/${i.id}`, { method: 'DELETE' }), await refresh()), 'Invitation cancelled')}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <ListState q={members} count={members.items.length} empty="No public members" />
        {members.items.map((u) => (
          <div key={u.id} className="row compact">
            <Avatar user={u} size={24} />
            <div className="row-main">
              <UserLink user={u} />
            </div>
            {owner.has(u.login) && <span className="badge">Owner</span>}
            {admin && u.login !== viewer.login && (
              <Dropdown align="right" className="icon-btn" title="Manage" trigger={<KebabHorizontalIcon />}>
                {(close) => (
                  <div className="menu" onClick={close}>
                    <button onClick={() => setRole(u)}>Change role…</button>
                    <button onClick={() => remove(u)}>Remove from organization</button>
                  </div>
                )}
              </Dropdown>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={members} />
    </div>
  );
}

interface Team {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  privacy: string;
  html_url: string;
}

export function OrgTeams({ org }: { org: string }) {
  const admin = useOrgAdmin(org);
  const q = useGhPages<Team>(`/orgs/${org}/teams?per_page=50`);
  const [open, setOpen] = useState<Team | null>(null);
  const { busy, run } = useAction();
  const create = async () => {
    const name = await promptDialog({ title: 'New team', label: 'Team name', confirmLabel: 'Next' });
    if (!name) return;
    const privacy = await promptDialog({
      title: `Create ${name}`,
      label: 'Visibility',
      options: [
        { value: 'closed', label: 'Visible to all members' },
        { value: 'secret', label: 'Secret' },
      ],
      confirmLabel: 'Create team',
    });
    if (privacy) await run(async () => (await gh(`/orgs/${org}/teams`, { method: 'POST', body: { name, privacy } }), await invalidate(`/orgs/${org}/teams`)), `Created ${name}`);
  };
  return (
    <div className="stack">
      {admin && (
        <div className="toolbar">
          <span className="spacer" />
          <button className="btn primary" disabled={busy} onClick={create}>
            New team
          </button>
        </div>
      )}
      <div className="card">
        <ListState q={q} count={q.items.length} empty="No teams you can see" />
        {q.items.map((t) => (
          <div key={t.id} className="row compact">
            <span className="state-icon">
              <PeopleIcon />
            </span>
            <div className="row-main">
              <button className="link-btn row-link" onClick={() => setOpen(t)}>
                {t.name}
              </button>
              {t.description && <p className="row-desc">{t.description}</p>}
            </div>
            <span className="badge">{t.privacy}</span>
          </div>
        ))}
      </div>
      <LoadMore q={q} />
      {open && <TeamDialog org={org} team={open} admin={admin} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TeamDialog({ org, team, admin, onClose }: { org: string; team: Team; admin: boolean; onClose: () => void }) {
  const api = `/orgs/${org}/teams/${team.slug}`;
  const members = useGhAll<User>(`${api}/members?per_page=100`);
  const repos = useGhAll<{ full_name: string; role_name?: string }>(`${api}/repos?per_page=100`);
  const { busy, run } = useAction();
  const refresh = () => invalidate(api);
  const add = async () => {
    const login = await promptDialog({ title: `Add to ${team.name}`, label: 'Username', confirmLabel: 'Add' });
    if (login) await run(async () => (await gh(`${api}/memberships/${encodeURIComponent(login.replace(/^@/, ''))}`, { method: 'PUT', body: { role: 'member' } }), await refresh()), `Added ${login}`);
  };
  const addRepo = async () => {
    const full = await promptDialog({ title: `Give ${team.name} a repository`, label: 'Repository (owner/name)', confirmLabel: 'Next' });
    if (!full) return;
    const permission = await promptDialog({
      title: `Access to ${full}`,
      label: 'Permission',
      options: ['pull', 'triage', 'push', 'maintain', 'admin'].map((p) => ({ value: p, label: { pull: 'Read', triage: 'Triage', push: 'Write', maintain: 'Maintain', admin: 'Admin' }[p]! })),
      confirmLabel: 'Grant access',
    });
    if (permission) await run(async () => (await gh(`${api}/repos/${full}`, { method: 'PUT', body: { permission } }), await refresh()), 'Access granted');
  };
  const removeTeam = async () => {
    if (!(await confirmDialog({ title: `Delete ${team.name}?`, body: 'Members keep their accounts but lose access given through this team.', confirmLabel: 'Delete team', danger: true }))) return;
    await run(async () => (await gh(api, { method: 'DELETE' }), await invalidate(`/orgs/${org}/teams`)), 'Team deleted');
    onClose();
  };
  return (
    <Modal title={team.name} onClose={onClose} wide>
      <div className="dialog-body">
        <div className="toolbar">
          <strong>Members</strong>
          <span className="spacer" />
          {admin && (
            <button className="btn sm" disabled={busy} onClick={add}>
              Add member
            </button>
          )}
        </div>
        <div className="card">
          <ListState q={members} count={members.items.length} empty="No members" />
          {members.items.map((u) => (
            <div key={u.id} className="row compact">
              <Avatar user={u} size={20} />
              <div className="row-main">
                <UserLink user={u} />
              </div>
              {admin && (
                <button className="btn sm" disabled={busy} onClick={() => run(async () => (await gh(`${api}/memberships/${u.login}`, { method: 'DELETE' }), await refresh()), `Removed ${u.login}`)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="toolbar">
          <strong>Repositories</strong>
          <span className="spacer" />
          {admin && (
            <button className="btn sm" disabled={busy} onClick={addRepo}>
              Add repository
            </button>
          )}
        </div>
        <div className="card">
          <ListState q={repos} count={repos.items.length} empty="No repositories" />
          {repos.items.map((r) => (
            <div key={r.full_name} className="row compact">
              <div className="row-main">{r.full_name}</div>
              {r.role_name && <span className="badge">{r.role_name}</span>}
              {admin && (
                <button className="btn sm" disabled={busy} onClick={() => run(async () => (await gh(`${api}/repos/${r.full_name}`, { method: 'DELETE' }), await refresh()), 'Access removed')}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {admin && (
          <div className="form-foot">
            <a href={team.html_url} data-external>
              Open on GitHub
            </a>
            <span className="spacer" />
            <button className="btn danger" disabled={busy} onClick={removeTeam}>
              Delete team
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// block or unblock someone from their profile
export function BlockButton({ login }: { login: string }) {
  const path = `/user/blocks/${login}`;
  const q = useGh(path);
  const { busy, run } = useAction();
  // 404 means not blocked; other errors mean the scope is missing
  if (q.isLoading || (q.error && q.error.status !== 404)) return null;
  const blocked = q.isSuccess;
  return (
    <button
      className="link-btn small"
      disabled={busy}
      onClick={async () => {
        if (!blocked && !(await confirmDialog({ title: `Block ${login}?`, body: 'They can no longer follow you, comment on your repositories or invite you.', confirmLabel: 'Block', danger: true }))) return;
        await run(async () => (await gh(path, { method: blocked ? 'DELETE' : 'PUT' }), await invalidate(path)), blocked ? `Unblocked ${login}` : `Blocked ${login}`);
      }}
    >
      <PersonIcon size={12} /> {blocked ? 'Unblock' : 'Block'}
    </button>
  );
}
