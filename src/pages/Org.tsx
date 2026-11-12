import { KebabHorizontalIcon, KeyIcon, MailIcon, PeopleIcon, PersonIcon, WebhookIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Avatar, Dropdown, Field, ListState, LoadMore, Modal, Switch, Time, UserLink } from '../components/ui';
import { HookActions, Managed, Secrets } from './Manage';
import { gh, invalidate, useGh, useGhAll, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, promptDialog, useAction } from '../lib/feedback';
import type { User } from '../lib/types';
import { plural } from '../lib/util';

// whether the viewer administers this org
export function useOrgAdmin(org: string) {
  const m = useGh<{ role: string; state: string }>(org && `/user/memberships/orgs/${org}`);
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

const ORG_FIELDS: [string, string][] = [
  ['name', 'Display name'],
  ['description', 'Description'],
  ['email', 'Public email'],
  ['blog', 'Website'],
  ['location', 'Location'],
  ['twitter_username', 'X username'],
  ['billing_email', 'Billing email'],
];

const ORG_SWITCHES: [string, string][] = [
  ['members_can_create_public_repositories', 'Members can create public repositories'],
  ['members_can_create_private_repositories', 'Members can create private repositories'],
  ['members_can_fork_private_repositories', 'Members can fork private repositories'],
  ['web_commit_signoff_required', 'Require sign-off on web commits'],
  ['has_organization_projects', 'Organization projects'],
  ['has_repository_projects', 'Repository projects'],
];

// profile, member privileges and automation for an org
export function OrgSettings({ org }: { org: string }) {
  const api = `/orgs/${org}`;
  const q = useGh<Record<string, any>>(api);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const { busy, run } = useAction();
  const save = (body: Record<string, unknown>, done = 'Saved') => run(async () => (await gh(api, { method: 'PATCH', body }), await invalidate(api)), done);
  if (!q.data) return <ListState q={q} count={0} empty="" />;
  const o = q.data;
  const values = form ?? Object.fromEntries(ORG_FIELDS.map(([k]) => [k, o[k] ?? '']));
  return (
    <div className="stack">
      <form
        className="card form-section form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(values, 'Profile saved').then(() => setForm(null));
        }}
      >
        <strong>Profile</strong>
        {ORG_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input className="input" value={values[k]} onChange={(e) => setForm({ ...values, [k]: e.target.value })} />
          </Field>
        ))}
        <div className="form-foot">
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !form}>
            Save profile
          </button>
        </div>
      </form>
      <section className="card">
        <div className="card-head">
          <strong>Member privileges</strong>
        </div>
        <div className="row compact">
          <div className="row-main">Base permission on repositories</div>
          <select className="input select" value={o.default_repository_permission ?? 'read'} disabled={busy} onChange={(e) => save({ default_repository_permission: e.target.value })}>
            <option value="none">No permission</option>
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {ORG_SWITCHES.filter(([k]) => k in o).map(([k, label]) => (
          <div key={k} className="row compact">
            <div className="row-main">{label}</div>
            <Switch checked={!!o[k]} disabled={busy} label={label} onChange={(v) => save({ [k]: v })} />
          </div>
        ))}
      </section>
      <Managed<{ id: number; active: boolean; events: string[]; config: { url?: string } }>
        title="Organization webhooks"
        path={`${api}/hooks?per_page=100`}
        rowKey={(h) => h.id}
        icon={<WebhookIcon />}
        empty="No webhooks"
        render={(h) => (
          <>
            <div className="row-title">
              {h.config.url} {!h.active && <span className="badge">Inactive</span>}
            </div>
            <div className="meta">{h.events.join(', ')}</div>
          </>
        )}
        actions={(h, refresh) => <HookActions api={`${api}/hooks/${h.id}`} active={h.active} refresh={refresh} />}
        remove={(h) => ({ path: `${api}/hooks/${h.id}`, confirm: 'Delete this webhook?' })}
        add={{
          label: 'Add webhook',
          fields: [
            { key: 'url', label: 'Payload URL', placeholder: 'https://example.com/hook' },
            { key: 'events', label: 'Events, comma separated', placeholder: 'push, repository  or  *', optional: true },
            { key: 'secret', label: 'Secret', optional: true, secret: true },
          ],
          submit: (v) =>
            gh(`${api}/hooks`, {
              method: 'POST',
              body: { name: 'web', config: { url: v.url.trim(), content_type: 'json', ...(v.secret ? { secret: v.secret } : {}) }, events: v.events.trim() ? v.events.split(',').map((e) => e.trim()) : ['push'] },
            }),
        }}
      />
      <Secrets api={`${api}/actions`} title="Organization Actions secrets" extra={{ visibility: 'all' }} />
      <Managed<{ name: string; value: string; visibility: string }>
        title="Organization Actions variables"
        path={`${api}/actions/variables?per_page=100`}
        pick={(d) => d.variables}
        rowKey={(v) => v.name}
        icon={<KeyIcon />}
        empty="No variables"
        render={(v) => (
          <div className="row-title">
            <code>{v.name}</code> <span className="muted">{v.value}</span> <span className="badge">{v.visibility}</span>
          </div>
        )}
        remove={(v) => ({ path: `${api}/actions/variables/${v.name}`, confirm: `Delete the variable ${v.name}?` })}
        add={{
          label: 'Add variable',
          fields: [
            { key: 'name', label: 'Name', placeholder: 'MY_VARIABLE' },
            { key: 'value', label: 'Value' },
            { key: 'visibility', label: 'Available to', options: [{ value: 'all', label: 'All repositories' }, { value: 'private', label: 'Private repositories' }] },
          ],
          submit: (v) => gh(`${api}/actions/variables`, { method: 'POST', body: { name: v.name.trim(), value: v.value, visibility: v.visibility } }),
        }}
      />
      <Managed<User>
        title="Blocked users"
        path={`${api}/blocks?per_page=100`}
        rowKey={(u) => u.id}
        icon={<PersonIcon />}
        empty="Nobody is blocked"
        render={(u) => <UserLink user={u} />}
        remove={(u) => ({ path: `${api}/blocks/${u.login}`, confirm: `Unblock ${u.login}?` })}
        add={{ label: 'Block user', fields: [{ key: 'login', label: 'Username' }], submit: (v) => gh(`${api}/blocks/${encodeURIComponent(v.login.trim().replace(/^@/, ''))}`, { method: 'PUT' }) }}
      />
      <Managed<User>
        title="Outside collaborators"
        path={`${api}/outside_collaborators?per_page=100`}
        rowKey={(u) => u.id}
        icon={<PersonIcon />}
        empty="No outside collaborators"
        render={(u) => <UserLink user={u} />}
        remove={(u) => ({ path: `${api}/outside_collaborators/${u.login}`, confirm: `Remove ${u.login} from every repository in ${org}?` })}
      />
    </div>
  );
}
