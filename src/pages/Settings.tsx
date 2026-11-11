import { CodespacesIcon, KeyIcon, MailIcon, OrganizationIcon, RepoIcon } from '@primer/octicons-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { applyTheme, type Theme } from '../components/Shell';
import { Field, ListState, mediaProbe, Segmented, Switch, Time, useSubTab } from '../components/ui';
import { gh, type GhError, invalidate, useGh, useRate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, useAction } from '../lib/feedback';
import { usePref } from '../lib/store';
import type { Repo, User } from '../lib/types';

function Toggle({ pref, label, note }: { pref: string; label: string; note: string }) {
  const [value, set] = usePref(pref, 'on');
  return (
    <div className="row compact">
      <div className="row-main">
        <strong>{label}</strong>
        <span className="muted">{note}</span>
      </div>
      <Switch checked={value === 'on'} onChange={(v) => set(v ? 'on' : 'off')} label={label} />
    </div>
  );
}

function App() {
  const { source, host, signOut } = useAuth();
  const rate = useRate();
  const [theme, setTheme] = usePref('theme', 'system');
  const [layout, setLayout] = usePref('diff-layout', 'unified');
  return (
    <>
      <section className="card">
        <div className="row compact">
          <div className="row-main">
            <strong>Theme</strong>
            <span className="muted">Light, dark, or whatever the system uses.</span>
          </div>
          <Segmented
            value={theme}
            onChange={(t) => {
              setTheme(t);
              applyTheme(t as Theme);
            }}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="row compact">
          <div className="row-main">
            <strong>Diff layout</strong>
            <span className="muted">How changes are shown in pull requests.</span>
          </div>
          <Segmented
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'unified', label: 'Unified' },
              { value: 'split', label: 'Split' },
            ]}
          />
        </div>
        <Toggle pref="desktop-notifications" label="Desktop notifications" note="Shown for new inbox items while Gittern is in the background." />
        <Toggle pref="inline-video" label="Play videos in the app" note={mediaProbe === false ? 'Off for now: this system is missing GStreamer plugins (on Arch: gst-plugins-good and gst-libav). Videos open in the browser until they are installed.' : 'Takes effect after a restart.'} />
        <Toggle pref="update-check" label="Check for updates" note="Looks for a newer Gittern release a few times a day." />
      </section>
      <section className="card">
        <div className="row compact">
          <div className="row-main">
            <strong>Signed in to {host}</strong>
            <span className="muted">
              {source === 'gh-cli' ? 'Using your GitHub CLI session.' : source === 'env' ? 'Using a token from the environment.' : 'Using a token saved in the system keyring.'}
              {rate?.remaining != null && rate.limit != null && ` ${rate.remaining.toLocaleString()} of ${rate.limit.toLocaleString()} API requests left this hour.`}
            </span>
          </div>
          <button className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        <div className="row compact">
          <div className="row-main">
            <strong>Gittern {__APP_VERSION__}</strong>
            <span className="muted">github.com, but native.</span>
          </div>
        </div>
      </section>
    </>
  );
}

const PROFILE_FIELDS: [keyof User, string][] = [
  ['name', 'Name'],
  ['bio', 'Bio'],
  ['company', 'Company'],
  ['location', 'Location'],
  ['blog', 'Website'],
];

function ProfileForm() {
  const { viewer } = useAuth();
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, String(viewer[k] ?? '')])));
  const { busy, run } = useAction();
  return (
    <form
      className="card form-section form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => (await gh('/user', { method: 'PATCH', body: form }), await invalidate('/user')), 'Profile saved');
      }}
    >
      {PROFILE_FIELDS.map(([key, label]) => (
        <Field key={key} label={label}>
          {key === 'bio' ? (
            <textarea className="input" rows={3} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          ) : (
            <input className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          )}
        </Field>
      ))}
      <div className="form-foot">
        <Link to={`/${viewer.login}`}>View your profile</Link>
        <span className="spacer" />
        <button className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}

const scopeNote = (e: GhError | null) => (e && [403, 404].includes(e.status) ? 'Your token lacks the scope for this.' : null);

function Keys() {
  const ssh = useGh<{ id: number; title: string; key: string; created_at: string }[]>('/user/keys?per_page=100');
  const gpg = useGh<{ id: number; name: string | null; key_id: string; created_at: string }[]>('/user/gpg_keys?per_page=100');
  const [title, setTitle] = useState('');
  const [key, setKey] = useState('');
  const { busy, run } = useAction();
  const remove = async (path: string, what: string) => {
    if (await confirmDialog({ title: `Delete ${what}?`, confirmLabel: 'Delete', danger: true })) void run(async () => (await gh(path, { method: 'DELETE' }), await invalidate('/user/')), 'Key deleted');
  };
  return (
    <>
      <section className="card">
        <div className="card-head">
          <strong>SSH keys</strong>
        </div>
        {scopeNote(ssh.error) ? <p className="muted pad">{scopeNote(ssh.error)}</p> : <ListState q={ssh} count={ssh.data?.length ?? 0} empty="No SSH keys" />}
        {ssh.data?.map((k) => (
          <div key={k.id} className="row compact">
            <span className="state-icon">
              <KeyIcon />
            </span>
            <div className="row-main">
              <strong>{k.title}</strong>
              <span className="muted mono small">{k.key.slice(0, 48)}…</span>
            </div>
            <span className="row-side">
              <Time iso={k.created_at} />
            </span>
            <button className="btn sm" disabled={busy} onClick={() => remove(`/user/keys/${k.id}`, k.title)}>
              Delete
            </button>
          </div>
        ))}
        <form
          className="form-section form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await gh('/user/keys', { method: 'POST', body: { title: title.trim(), key: key.trim() } });
              setTitle('');
              setKey('');
              await invalidate('/user/keys');
            }, 'Key added');
          }}
        >
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Public key">
            <textarea className="input mono" rows={3} placeholder="ssh-ed25519 AAAA…" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn primary" disabled={busy || !title.trim() || !key.trim()}>
              Add SSH key
            </button>
          </div>
        </form>
      </section>
      <section className="card">
        <div className="card-head">
          <strong>GPG keys</strong>
        </div>
        {scopeNote(gpg.error) ? <p className="muted pad">{scopeNote(gpg.error)}</p> : <ListState q={gpg} count={gpg.data?.length ?? 0} empty="No GPG keys" />}
        {gpg.data?.map((k) => (
          <div key={k.id} className="row compact">
            <span className="state-icon">
              <KeyIcon />
            </span>
            <div className="row-main">
              <strong>{k.name || k.key_id}</strong>
              <span className="muted mono small">{k.key_id}</span>
            </div>
            <button className="btn sm" disabled={busy} onClick={() => remove(`/user/gpg_keys/${k.id}`, k.key_id)}>
              Delete
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

function Rows<T>({ title, q, items, empty, icon, render }: { title: string; q: { isLoading: boolean; error: GhError | null }; items: T[]; empty: string; icon: ReactNode; render: (x: T) => { key: string | number; main: ReactNode; side?: ReactNode } }) {
  return (
    <section className="card">
      <div className="card-head">
        <strong>{title}</strong>
      </div>
      {scopeNote(q.error) ? <p className="muted pad">{scopeNote(q.error)}</p> : <ListState q={q} count={items.length} empty={empty} />}
      {items.map((x) => {
        const r = render(x);
        return (
          <div key={r.key} className="row compact">
            <span className="state-icon">{icon}</span>
            <div className="row-main">{r.main}</div>
            {r.side}
          </div>
        );
      })}
    </section>
  );
}

function Account() {
  const emails = useGh<{ email: string; primary: boolean; verified: boolean; visibility: string | null }[]>('/user/emails?per_page=100');
  const invites = useGh<{ id: number; repository: Repo; inviter: User; permissions: string }[]>('/user/repository_invitations?per_page=100');
  const orgs = useGh<{ organization: User; role: string; state: string }[]>('/user/memberships/orgs?per_page=100');
  const spaces = useGh<{ codespaces: { id: number; name: string; display_name: string | null; state: string; repository: Repo; web_url: string; last_used_at: string }[] }>('/user/codespaces?per_page=50');
  const { busy, run } = useAction();
  const act = (fn: () => Promise<unknown>, done: string) => run(async () => (await fn(), await invalidate('/user/')), done);
  return (
    <>
      <Rows
        title="Repository invitations"
        q={invites}
        items={invites.data ?? []}
        empty="No pending invitations"
        icon={<RepoIcon />}
        render={(i) => ({
          key: i.id,
          main: (
            <>
              <Link to={`/${i.repository.full_name}`} className="strong">
                {i.repository.full_name}
              </Link>
              <span className="muted">
                {i.inviter.login} invited you ({i.permissions})
              </span>
            </>
          ),
          side: (
            <>
              <button className="btn sm" disabled={busy} onClick={() => act(() => gh(`/user/repository_invitations/${i.id}`, { method: 'DELETE' }), 'Invitation declined')}>
                Decline
              </button>
              <button className="btn sm primary" disabled={busy} onClick={() => act(() => gh(`/user/repository_invitations/${i.id}`, { method: 'PATCH' }), 'Invitation accepted')}>
                Accept
              </button>
            </>
          ),
        })}
      />
      <Rows
        title="Organizations"
        q={orgs}
        items={orgs.data ?? []}
        empty="You aren't in any organizations"
        icon={<OrganizationIcon />}
        render={(o) => ({
          key: o.organization.id,
          main: (
            <div className="row-title">
              <Link to={`/${o.organization.login}`}>{o.organization.login}</Link> <span className="badge">{o.role}</span> {o.state === 'pending' && <span className="badge">Pending</span>}
            </div>
          ),
          side:
            o.state === 'pending' ? (
              <button className="btn sm primary" disabled={busy} onClick={() => act(() => gh(`/user/memberships/orgs/${o.organization.login}`, { method: 'PATCH', body: { state: 'active' } }), 'Joined')}>
                Join
              </button>
            ) : undefined,
        })}
      />
      <Rows
        title="Emails"
        q={emails}
        items={emails.data ?? []}
        empty="No emails"
        icon={<MailIcon />}
        render={(e) => ({
          key: e.email,
          main: (
            <div className="row-title">
              {e.email} {e.primary && <span className="badge">Primary</span>} {!e.verified && <span className="badge">Unverified</span>} {e.visibility === 'private' && <span className="badge">Private</span>}
            </div>
          ),
        })}
      />
      <Rows
        title="Codespaces"
        q={spaces}
        items={spaces.data?.codespaces ?? []}
        empty="No codespaces"
        icon={<CodespacesIcon />}
        render={(c) => ({
          key: c.id,
          main: (
            <>
              <div className="row-title">
                {c.display_name || c.name} <span className="badge">{c.state}</span>
              </div>
              <span className="muted">
                {c.repository.full_name} · used <Time iso={c.last_used_at} />
              </span>
            </>
          ),
          side: (
            <>
              {c.state === 'Available' && (
                <button className="btn sm" disabled={busy} onClick={() => act(() => gh(`/user/codespaces/${c.name}/stop`, { method: 'POST' }), 'Stopping…')}>
                  Stop
                </button>
              )}
              <a className="btn sm" href={c.web_url} data-external>
                Open
              </a>
            </>
          ),
        })}
      />
    </>
  );
}

export function Settings() {
  const tab = useSubTab('app');
  const tabs = [
    ['app', 'Gittern'],
    ['profile', 'Profile'],
    ['account', 'Account'],
    ['keys', 'SSH and GPG keys'],
  ];
  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          {tabs.map(([id, label]) => (
            <Link key={id} to={id === 'app' ? '?' : `?tab=${id}`} className={`side-link ${tab === id ? 'active' : ''}`}>
              <span className="side-label">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="stack">
          {tab === 'app' && <App />}
          {tab === 'profile' && <ProfileForm />}
          {tab === 'account' && <Account />}
          {tab === 'keys' && <Keys />}
        </div>
      </div>
    </div>
  );
}
