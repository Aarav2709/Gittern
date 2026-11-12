import { invoke } from '@tauri-apps/api/core';
import { AlertIcon, GearIcon, GitBranchIcon, GitCommitIcon, KeyIcon, LinkIcon, LockIcon, PersonIcon, RocketIcon, TrashIcon, WebhookIcon } from '@primer/octicons-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import { MarkdownEditor } from '../components/Editor';
import { Avatar, Empty, ErrorBox, Field, ListState, Loading, Modal, Switch, Time, useSubTab } from '../components/ui';
import { ACCEPT, gh, invalidate, isTauri, useGh, useGhAll } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, promptDialog, toast, toastError, useAction, useDraft } from '../lib/feedback';
import type { Branch, CommitEntry, DiffFileEntry, PullRequest, Repo, User } from '../lib/types';
import { encPath, plural } from '../lib/util';
import { useRepo } from './Repo';

const FEATURES: [keyof Repo, string, string][] = [
  ['has_issues', 'Issues', 'Track bugs, ideas and tasks.'],
  ['has_discussions', 'Discussions', 'A place for questions and open-ended conversation.'],
  ['has_projects', 'Projects', 'Plan and track work on boards.'],
  ['has_wiki', 'Wiki', 'Host documentation alongside the code.'],
];
const MERGING: [keyof Repo, string, string][] = [
  ['allow_merge_commit', 'Merge commits', 'Keep every commit from the branch, joined by a merge commit.'],
  ['allow_squash_merge', 'Squash merging', 'Combine the branch into a single commit.'],
  ['allow_rebase_merge', 'Rebase merging', 'Replay the commits on top of the base branch.'],
  ['allow_auto_merge', 'Auto-merge', 'Merge automatically once reviews and checks pass.'],
  ['delete_branch_on_merge', 'Delete head branches', 'Remove the branch after its pull request merges.'],
];
const SETTING_KEYS: (keyof Repo)[] = ['name', 'description', 'homepage', 'default_branch', ...FEATURES.map((f) => f[0]), ...MERGING.map((m) => m[0])];

function General({ repo }: { repo: Repo }) {
  const navigate = useNavigate();
  const api = `/repos/${repo.full_name}`;
  const branches = useGhAll<Branch>(`${api}/branches?per_page=100`);
  const initial = useMemo(() => Object.fromEntries(SETTING_KEYS.map((k) => [k, repo[k] ?? (typeof repo[k] === 'boolean' ? false : '')])) as Record<string, any>, [repo]);
  const [form, setForm] = useState<Record<string, any>>(initial);
  const { busy, run } = useAction();
  useEffect(() => setForm(initial), [initial]);

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== initial[k]));
  const count = Object.keys(changed).length;
  const save = () =>
    run(async () => {
      const updated = await gh<Repo>(api, { method: 'PATCH', body: changed });
      await invalidate('/repos/');
      if (updated.full_name !== repo.full_name) navigate(`/${updated.full_name}/settings`, { replace: true });
    }, 'Settings saved');

  const switches = (rows: [keyof Repo, string, string][]) =>
    rows.map(([key, label, note]) => (
      <div key={key} className="row compact">
        <div className="row-main">
          <strong>{label}</strong>
          <span className="muted">{note}</span>
        </div>
        <Switch checked={!!form[key]} onChange={(v) => set(key, v)} label={label} />
      </div>
    ));
  return (
    <>
      <section className="card">
        <div className="card-head">
          <strong>Details</strong>
        </div>
        <div className="form-section form">
          <div className="split">
            <Field label="Repository name">
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Default branch">
              <select className="input" value={form.default_branch} onChange={(e) => set('default_branch', e.target.value)}>
                {(branches.items.length ? branches.items : [{ name: repo.default_branch }]).map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className="input" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Website">
            <input className="input" placeholder="https://" value={form.homepage} onChange={(e) => set('homepage', e.target.value)} />
          </Field>
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <strong>Features</strong>
        </div>
        {switches(FEATURES)}
      </section>
      <section className="card">
        <div className="card-head">
          <strong>Pull requests</strong>
        </div>
        {switches(MERGING)}
      </section>
      <div className={`save-bar ${count ? 'dirty' : ''}`}>
        <span className="muted small">{count ? plural(count, 'unsaved change') : 'Everything is saved'}</span>
        <span className="spacer" />
        <button className="btn" disabled={!count || busy} onClick={() => setForm(initial)}>
          Reset
        </button>
        <button className="btn primary" disabled={!count || busy || !String(form.name).trim()} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  );
}

// a settings list with an add form and a remove button per row
export function Managed<T>({
  title,
  path,
  pick,
  rowKey,
  render,
  remove,
  add,
  empty,
  icon,
  actions,
  extra,
}: {
  title: string;
  path: string;
  pick?: (d: any) => T[];
  rowKey: (x: T) => string | number;
  render: (x: T) => ReactNode;
  remove?: (x: T) => { path: string; confirm: string };
  add?: { fields: { key: string; label: string; area?: boolean; placeholder?: string; options?: { value: string; label: string }[]; optional?: boolean; secret?: boolean }[]; submit: (v: Record<string, string>) => Promise<unknown>; label: string };
  empty: string;
  icon: ReactNode;
  // buttons beside each row
  actions?: (x: T, refresh: () => Promise<unknown>) => ReactNode;
  // shown under a row
  extra?: (x: T) => ReactNode;
}) {
  const q = useGh<any>(path);
  const items: T[] = q.data ? (pick ? pick(q.data) : q.data) : [];
  const [values, setValues] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const refresh = () => invalidate(path.split('?')[0]);
  return (
    <section className="card">
      <div className="card-head">
        <strong>{title}</strong>
      </div>
      <ListState q={q} count={items.length} empty={empty} />
      {items.map((x) => (
        <div key={rowKey(x)} className="row compact wrap">
          <span className="state-icon">{icon}</span>
          <div className="row-main">{render(x)}</div>
          {actions?.(x, refresh)}
          {remove && (
            <button
              className="icon-btn"
              title="Remove"
              aria-label="Remove"
              disabled={busy}
              onClick={async () => {
                const r = remove(x);
                if (await confirmDialog({ title: r.confirm, confirmLabel: 'Remove', danger: true })) void run(async () => (await gh(r.path, { method: 'DELETE' }), await refresh()), 'Removed');
              }}
            >
              <TrashIcon />
            </button>
          )}
          {extra && <div className="row-extra">{extra(x)}</div>}
        </div>
      ))}
      {add && (
        <form
          className="form-section form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const filled = Object.fromEntries(add.fields.map((f) => [f.key, values[f.key] ?? f.options?.[0].value ?? '']));
            await add.submit(filled);
              setValues({});
              await refresh();
            }, 'Added');
          }}
        >
          {add.fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.options ? (
                <select className="input" value={values[f.key] ?? f.options[0].value} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.area ? (
                <textarea className="input mono" rows={3} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : (
                <input className="input" type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn primary" disabled={busy || add.fields.some((f) => !f.options && !f.optional && !values[f.key]?.trim())}>
              {add.label}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Access({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}`;
  return (
    <>
      <Managed<User & { role_name?: string }>
        title="Collaborators"
        path={`${api}/collaborators?affiliation=direct&per_page=100`}
        rowKey={(u) => u.id}
        icon={<PersonIcon />}
        empty="No direct collaborators"
        render={(u) => (
          <div className="row-title">
            <Avatar user={u} size={18} /> <Link to={`/${u.login}`}>{u.login}</Link> <span className="badge">{u.role_name ?? 'collaborator'}</span>
          </div>
        )}
        remove={(u) => ({ path: `${api}/collaborators/${u.login}`, confirm: `Remove ${u.login} from ${repo.name}?` })}
        add={{
          label: 'Invite',
          fields: [{ key: 'login', label: 'Invite by username', placeholder: 'octocat' }],
          submit: (v) => gh(`${api}/collaborators/${encodeURIComponent(v.login.trim())}`, { method: 'PUT', body: { permission: 'push' } }),
        }}
      />
      <Managed<{ id: number; invitee: User; permissions: string; created_at: string }>
        title="Pending invitations"
        path={`${api}/invitations?per_page=100`}
        rowKey={(i) => i.id}
        icon={<PersonIcon />}
        empty="No pending invitations"
        render={(i) => (
          <div className="row-title">
            {i.invitee?.login} <span className="badge">{i.permissions}</span>
            <span className="muted small">
              invited <Time iso={i.created_at} />
            </span>
          </div>
        )}
        remove={(i) => ({ path: `${api}/invitations/${i.id}`, confirm: `Cancel the invitation for ${i.invitee?.login}?` })}
      />
    </>
  );
}

function Branches({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}`;
  const q = useGhAll<Branch>(`${api}/branches?protected=true&per_page=100`);
  const rules = useGh<{ id: number; name: string; enforcement: string; target: string }[]>(`${api}/rulesets?per_page=100`);
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const protect = (branch: string) =>
    run(async () => {
      await gh(`${api}/branches/${encodeURIComponent(branch)}/protection`, {
        method: 'PUT',
        body: { required_status_checks: null, enforce_admins: false, required_pull_request_reviews: { required_approving_review_count: 1 }, restrictions: null },
      });
      setName('');
      await invalidate(`${api}/branches`);
    }, `${branch} now requires a reviewed pull request`);
  return (
    <>
      <section className="card">
        <div className="card-head">
          <strong>Protected branches</strong>
        </div>
        <ListState q={q} count={q.items.length} empty="No protected branches" />
        {q.items.map((b) => (
          <div key={b.name} className="row compact">
            <span className="state-icon">
              <LockIcon />
            </span>
            <div className="row-main">
              <Link to={`/${repo.full_name}/tree/${b.name}`}>{b.name}</Link>
            </div>
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog({ title: `Remove protection from ${b.name}?`, confirmLabel: 'Remove protection', danger: true }))
                  void run(async () => (await gh(`${api}/branches/${encodeURIComponent(b.name)}/protection`, { method: 'DELETE' }), await invalidate(`${api}/branches`)), 'Protection removed');
              }}
            >
              Unprotect
            </button>
          </div>
        ))}
        <form
          className="form-section form"
          onSubmit={(e) => {
            e.preventDefault();
            void protect(name.trim());
          }}
        >
          <Field label="Protect a branch" hint="Requires a pull request with one approving review before merging.">
            <input className="input" placeholder={repo.default_branch} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn primary" disabled={busy || !name.trim()}>
              Protect
            </button>
          </div>
        </form>
      </section>
      {!!rules.data?.length && (
        <section className="card">
          <div className="card-head">
            <strong>Rulesets</strong>
          </div>
          {rules.data.map((r) => (
            <div key={r.id} className="row compact">
              <div className="row-main">
                <div className="row-title">
                  {r.name} <span className="badge">{r.enforcement}</span> <span className="badge">{r.target}</span>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Automation({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}`;
  return (
    <>
      <Managed<{ id: number; name: string; active: boolean; events: string[]; config: { url?: string; content_type?: string } }>
        title="Webhooks"
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
            { key: 'events', label: 'Events, comma separated', placeholder: 'push, pull_request, issues  or  *', optional: true },
            { key: 'type', label: 'Content type', options: [{ value: 'json', label: 'application/json' }, { value: 'form', label: 'application/x-www-form-urlencoded' }] },
            { key: 'secret', label: 'Secret', optional: true, secret: true },
          ],
          submit: (v) =>
            gh(`${api}/hooks`, {
              method: 'POST',
              body: {
                config: { url: v.url.trim(), content_type: v.type, ...(v.secret ? { secret: v.secret } : {}) },
                events: v.events.trim() ? v.events.split(',').map((e) => e.trim()).filter(Boolean) : ['push'],
              },
            }),
        }}
      />
      <Managed<{ id: number; title: string; read_only: boolean; created_at: string }>
        title="Deploy keys"
        path={`${api}/keys?per_page=100`}
        rowKey={(k) => k.id}
        icon={<KeyIcon />}
        empty="No deploy keys"
        render={(k) => (
          <div className="row-title">
            {k.title} <span className="badge">{k.read_only ? 'Read-only' : 'Read/write'}</span>
            <span className="muted small">
              added <Time iso={k.created_at} />
            </span>
          </div>
        )}
        remove={(k) => ({ path: `${api}/keys/${k.id}`, confirm: `Delete the deploy key “${k.title}”?` })}
        add={{
          label: 'Add deploy key',
          fields: [
            { key: 'title', label: 'Title' },
            { key: 'key', label: 'Public key', area: true, placeholder: 'ssh-ed25519 AAAA…' },
            { key: 'access', label: 'Access', options: [{ value: 'read', label: 'Read-only' }, { value: 'write', label: 'Read and write' }] },
          ],
          submit: (v) => gh(`${api}/keys`, { method: 'POST', body: { title: v.title.trim(), key: v.key.trim(), read_only: v.access !== 'write' } }),
        }}
      />
      <Managed<{ name: string; value: string; updated_at: string }>
        title="Actions variables"
        path={`${api}/actions/variables?per_page=100`}
        pick={(d) => d.variables}
        rowKey={(v) => v.name}
        icon={<KeyIcon />}
        empty="No variables"
        render={(v) => (
          <div className="row-title">
            <code>{v.name}</code> <span className="muted">{v.value}</span>
          </div>
        )}
        remove={(v) => ({ path: `${api}/actions/variables/${v.name}`, confirm: `Delete the variable ${v.name}?` })}
        add={{
          label: 'Add variable',
          fields: [
            { key: 'name', label: 'Name', placeholder: 'MY_VARIABLE' },
            { key: 'value', label: 'Value' },
          ],
          submit: (v) => gh(`${api}/actions/variables`, { method: 'POST', body: { name: v.name.trim(), value: v.value } }),
        }}
      />
      <Secrets api={`${api}/actions`} title="Actions secrets" />
      <Secrets api={`${api}/dependabot`} title="Dependabot secrets" />
      <Managed<{ id: number; name: string; protection_rules?: { type: string }[]; updated_at: string }>
        title="Environments"
        path={`${api}/environments?per_page=100`}
        pick={(d) => d.environments}
        rowKey={(e) => e.id}
        icon={<RocketIcon />}
        empty="No environments"
        render={(e) => (
          <div className="row-title">
            {e.name}
            {!!e.protection_rules?.length && <span className="badge">{plural(e.protection_rules.length, 'rule')}</span>}
          </div>
        )}
        remove={(e) => ({ path: `${api}/environments/${encodeURIComponent(e.name)}`, confirm: `Delete the ${e.name} environment?` })}
        add={{
          label: 'Add environment',
          fields: [{ key: 'name', label: 'Name', placeholder: 'production' }],
          submit: (v) => gh(`${api}/environments/${encodeURIComponent(v.name.trim())}`, { method: 'PUT', body: {} }),
        }}
      />
      <Managed<{ id: number; key_prefix: string; url_template: string; is_alphanumeric: boolean }>
        title="Autolink references"
        path={`${api}/autolinks`}
        rowKey={(a) => a.id}
        icon={<LinkIcon />}
        empty="No autolinks"
        render={(a) => (
          <div className="row-title">
            <code>{a.key_prefix}</code> <span className="muted">{a.url_template}</span>
          </div>
        )}
        remove={(a) => ({ path: `${api}/autolinks/${a.id}`, confirm: `Delete the ${a.key_prefix} autolink?` })}
        add={{
          label: 'Add autolink',
          fields: [
            { key: 'prefix', label: 'Reference prefix', placeholder: 'TICKET-' },
            { key: 'url', label: 'Target URL, with <num>', placeholder: 'https://example.com/TICKET?query=<num>' },
            { key: 'alnum', label: 'Matches', options: [{ value: 'yes', label: 'Letters and numbers' }, { value: 'no', label: 'Numbers only' }] },
          ],
          submit: (v) => gh(`${api}/autolinks`, { method: 'POST', body: { key_prefix: v.prefix.trim(), url_template: v.url.trim(), is_alphanumeric: v.alnum === 'yes' } }),
        }}
      />
      <Pages repo={repo} />
    </>
  );
}

// ping, pause and delivery history for one webhook
export function HookActions({ api, active, refresh }: { api: string; active: boolean; refresh: () => Promise<unknown> }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn sm" disabled={busy} onClick={() => run(() => gh(`${api}/pings`, { method: 'POST' }), 'Ping sent')}>
        Ping
      </button>
      <button className="btn sm" disabled={busy} onClick={() => run(async () => (await gh(api, { method: 'PATCH', body: { active: !active } }), await refresh()), active ? 'Paused' : 'Activated')}>
        {active ? 'Pause' : 'Activate'}
      </button>
      <button className="btn sm" onClick={() => setOpen(true)}>
        Deliveries
      </button>
      {open && (
        <Modal title="Recent deliveries" onClose={() => setOpen(false)} wide>
          <Deliveries api={api} />
        </Modal>
      )}
    </>
  );
}

function Deliveries({ api }: { api: string }) {
  const q = useGh<{ id: number; guid: string; delivered_at: string; status: string; status_code: number; event: string; action: string | null; redelivery: boolean }[]>(`${api}/deliveries?per_page=50`);
  const { busy, run } = useAction();
  return (
    <div className="dialog-body">
      <ListState q={q} count={q.data?.length ?? 0} empty="No deliveries yet" />
      {q.data?.map((d) => (
        <div key={d.id} className="row compact">
          <span className={`badge ${d.status_code >= 200 && d.status_code < 300 ? 'ok' : ''}`}>{d.status_code || '—'}</span>
          <div className="row-main">
            <div className="row-title">
              {d.event}
              {d.action ? `.${d.action}` : ''} {d.redelivery && <span className="badge">Redelivery</span>}
            </div>
            <div className="meta">
              {d.status} · <Time iso={d.delivered_at} />
            </div>
          </div>
          <button className="btn sm" disabled={busy} onClick={() => run(async () => (await gh(`${api}/deliveries/${d.id}/attempts`, { method: 'POST' }), await invalidate(`${api}/deliveries`)), 'Redelivering')}>
            Redeliver
          </button>
        </div>
      ))}
    </div>
  );
}

// secrets are sealed with the repository's public key before upload
export function Secrets({ api, title, extra }: { api: string; title: string; extra?: Record<string, unknown> }) {
  return (
    <Managed<{ name: string; updated_at: string }>
      title={title}
      path={`${api}/secrets?per_page=100`}
      pick={(d) => d.secrets}
      rowKey={(s) => s.name}
      icon={<LockIcon />}
      empty="No secrets"
      render={(s) => (
        <div className="row-title">
          <code>{s.name}</code>
          <span className="muted small">
            updated <Time iso={s.updated_at} />
          </span>
        </div>
      )}
      actions={(s, refresh) =>
        isTauri && (
          <button
            className="btn sm"
            onClick={async () => {
              const value = await promptDialog({ title: `Update ${s.name}`, label: 'New value', multiline: true, confirmLabel: 'Update secret' });
              if (value) await putSecret(api, s.name, value, extra).then(refresh, toastError);
            }}
          >
            Update
          </button>
        )
      }
      remove={(s) => ({ path: `${api}/secrets/${s.name}`, confirm: `Delete the secret ${s.name}?` })}
      add={
        isTauri
          ? {
              label: 'Add secret',
              fields: [
                { key: 'name', label: 'Name', placeholder: 'MY_SECRET' },
                { key: 'value', label: 'Value', area: true },
              ],
              submit: (v) => putSecret(api, v.name.trim(), v.value, extra),
            }
          : undefined
      }
    />
  );
}

async function putSecret(api: string, name: string, value: string, extra?: Record<string, unknown>) {
  const key = await gh<{ key_id: string; key: string }>(`${api}/secrets/public-key`);
  const encrypted_value = await invoke<string>('seal_secret', { key: key.key, value });
  await gh(`${api}/secrets/${encodeURIComponent(name)}`, { method: 'PUT', body: { encrypted_value, key_id: key.key_id, ...extra } });
}

function Pages({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}/pages`;
  const q = useGh<{ html_url: string; status: string | null; build_type: string; source?: { branch: string; path: string }; https_enforced?: boolean; cname: string | null }>(api);
  const [branch, setBranch] = useState(repo.default_branch);
  const [path, setPath] = useState('/');
  const { busy, run } = useAction();
  const refresh = () => invalidate(api);
  const enabled = q.isSuccess;
  return (
    <section className="card">
      <div className="card-head">
        <strong>GitHub Pages</strong>
        <span className="spacer" />
        {enabled && (
          <a className="btn sm" href={q.data!.html_url} data-external>
            Visit site
          </a>
        )}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : enabled ? (
        <div className="form-section form">
          <p className="muted">
            {q.data!.build_type === 'workflow' ? 'Built by a GitHub Actions workflow.' : `Built from ${q.data!.source?.branch}${q.data!.source?.path}.`} Status: {q.data!.status ?? 'unknown'}.
          </p>
          <div className="toolbar">
            {q.data!.build_type !== 'workflow' && (
              <button className="btn" disabled={busy} onClick={() => run(() => gh(`${api}/builds`, { method: 'POST' }), 'Build requested')}>
                Rebuild
              </button>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(async () => (await gh(api, { method: 'PUT', body: { build_type: q.data!.build_type === 'workflow' ? 'legacy' : 'workflow', ...(q.data!.source ? { source: q.data!.source } : {}) } }), await refresh()))}
            >
              Build with {q.data!.build_type === 'workflow' ? 'a branch' : 'Actions'}
            </button>
            <span className="spacer" />
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog({ title: 'Unpublish this site?', confirmLabel: 'Unpublish', danger: true })) void run(async () => (await gh(api, { method: 'DELETE' }), await refresh()), 'Site unpublished');
              }}
            >
              Unpublish
            </button>
          </div>
        </div>
      ) : (
        <form
          className="form-section form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => (await gh(api, { method: 'POST', body: { source: { branch, path } } }), await refresh()), 'Pages enabled');
          }}
        >
          <p className="muted">Publish a site from a branch of this repository.</p>
          <div className="split">
            <Field label="Branch">
              <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
            <Field label="Folder">
              <select className="input" value={path} onChange={(e) => setPath(e.target.value)}>
                <option value="/">/ (root)</option>
                <option value="/docs">/docs</option>
              </select>
            </Field>
          </div>
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn primary" disabled={busy || !branch.trim()}>
              Enable Pages
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Danger({ repo }: { repo: Repo }) {
  const navigate = useNavigate();
  const api = `/repos/${repo.full_name}`;
  const { busy, run } = useAction();
  const [owner, setOwner] = useState('');
  const patch = (body: object, done: string) => run(async () => (await gh(api, { method: 'PATCH', body }), await invalidate('/repos/')), done);
  const rows: { title: string; note: string; label: string; act: () => void; extra?: ReactNode }[] = [
    {
      title: `This repository is ${repo.private ? 'private' : 'public'}`,
      note: repo.private ? 'Only people with access can see it.' : 'Anyone can see it.',
      label: `Make ${repo.private ? 'public' : 'private'}`,
      act: async () => {
        const to = repo.private ? 'public' : 'private';
        if (await confirmDialog({ title: `Make ${repo.full_name} ${to}?`, body: to === 'public' ? 'Anyone on the internet will be able to see it.' : 'Stars and watchers from people without access are lost.', confirmLabel: `Make ${to}`, danger: true }))
          void patch({ private: !repo.private }, `Repository is now ${to}`);
      },
    },
    {
      title: repo.archived ? 'This repository is archived' : 'Archive this repository',
      note: 'Archived repositories are read-only.',
      label: repo.archived ? 'Unarchive' : 'Archive',
      act: async () => {
        if (await confirmDialog({ title: `${repo.archived ? 'Unarchive' : 'Archive'} ${repo.full_name}?`, confirmLabel: repo.archived ? 'Unarchive' : 'Archive', danger: !repo.archived }))
          void patch({ archived: !repo.archived }, repo.archived ? 'Repository unarchived' : 'Repository archived');
      },
    },
    {
      title: 'Transfer ownership',
      note: 'Move this repository to another user or organization.',
      label: 'Transfer',
      extra: <input className="input name-input" placeholder="New owner" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="New owner" />,
      act: async () => {
        if (!owner.trim()) return toast('Enter the new owner first', 'error');
        if (await confirmDialog({ title: `Transfer to ${owner.trim()}?`, body: 'The new owner has to accept the transfer.', confirmLabel: 'Transfer', danger: true, typeToConfirm: repo.full_name }))
          void run(() => gh(`${api}/transfer`, { method: 'POST', body: { new_owner: owner.trim() } }), 'Transfer requested');
      },
    },
    {
      title: 'Delete this repository',
      note: 'This cannot be undone. Issues, pull requests and releases go with it.',
      label: 'Delete',
      act: async () => {
        if (!(await confirmDialog({ title: `Delete ${repo.full_name}?`, body: 'This permanently deletes the repository and everything in it.', confirmLabel: 'Delete this repository', danger: true, typeToConfirm: repo.full_name }))) return;
        const ok = await run(async () => (await gh(api, { method: 'DELETE' }), await invalidate('/user/repos'), true), 'Repository deleted');
        if (ok) navigate('/', { replace: true });
      },
    },
  ];
  return (
    <section className="card danger-card">
      {rows.map((r) => (
        <div key={r.title} className="row compact">
          <div className="row-main">
            <strong>{r.title}</strong>
            <span className="muted">{r.note}</span>
          </div>
          {r.extra}
          <button className="btn danger" disabled={busy} onClick={r.act}>
            {r.label}
          </button>
        </div>
      ))}
    </section>
  );
}

export function RepoSettings() {
  const { repo } = useRepo();
  const tab = useSubTab('general');
  if (!repo.permissions?.admin) return <Empty title="Settings need admin access">You can view this repository but not change its settings.</Empty>;
  const tabs: [string, string, ReactNode][] = [
    ['general', 'General', <GearIcon key="i" />],
    ['access', 'Collaborators', <PersonIcon key="i" />],
    ['branches', 'Branches', <GitBranchIcon key="i" />],
    ['automation', 'Webhooks, keys, secrets', <WebhookIcon key="i" />],
    ['danger', 'Danger zone', <AlertIcon key="i" />],
  ];
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings">
        {tabs.map(([id, label, icon]) => (
          <Link key={id} to={id === 'general' ? '?' : `?tab=${id}`} className={`side-link ${tab === id ? 'active' : ''}`}>
            {icon}
            <span className="side-label">{label}</span>
          </Link>
        ))}
      </nav>
      <div className="stack">
        <h2 className="title">{tabs.find((t) => t[0] === tab)?.[1] ?? 'General'}</h2>
        {tab === 'general' && <General repo={repo} />}
        {tab === 'access' && <Access repo={repo} />}
        {tab === 'branches' && <Branches repo={repo} />}
        {tab === 'automation' && <Automation repo={repo} />}
        {tab === 'danger' && <Danger repo={repo} />}
      </div>
    </div>
  );
}

export function NewRepo() {
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const orgs = useGh<User[]>('/user/orgs?per_page=100');
  const ignores = useGh<string[]>('/gitignore/templates', { staleTime: 3600_000 });
  const licenses = useGh<{ key: string; name: string }[]>('/licenses', { staleTime: 3600_000 });
  const [owner, setOwner] = useState(viewer.login);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [readme, setReadme] = useState(true);
  const [ignore, setIgnore] = useState('');
  const [license, setLicense] = useState('');
  const { busy, run } = useAction();
  const taken = useGh(name.trim() && `/repos/${owner}/${encodeURIComponent(name.trim())}`);
  const submit = () =>
    run(async () => {
      const body = { name: name.trim(), description, private: isPrivate, auto_init: readme || !!ignore || !!license, gitignore_template: ignore || undefined, license_template: license || undefined };
      const created = await gh<Repo>(owner === viewer.login ? '/user/repos' : `/orgs/${owner}/repos`, { method: 'POST', body });
      await invalidate('/user/repos');
      navigate(`/${created.full_name}`, { replace: true });
    });
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>New repository</h1>
        <p className="muted">A repository holds a project's files and their full history.</p>
      </header>
      <section className="card">
        <div className="form-section form">
          <div className="split">
            <Field label="Owner">
              <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option>{viewer.login}</option>
                {orgs.data?.map((o) => <option key={o.id}>{o.login}</option>)}
              </select>
            </Field>
            <Field label="Repository name" hint={taken.isSuccess ? `${owner}/${name.trim()} already exists.` : undefined}>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Description (optional)">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="form-section form">
          <label className="check-row">
            <input type="radio" checked={!isPrivate} onChange={() => setPrivate(false)} /> Public: anyone can see it
          </label>
          <label className="check-row">
            <input type="radio" checked={isPrivate} onChange={() => setPrivate(true)} /> Private: only you and people you invite
          </label>
        </div>
        <div className="form-section form">
          <label className="check-row">
            <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} /> Add a README
          </label>
          <div className="split">
            <Field label=".gitignore">
              <select className="input" value={ignore} onChange={(e) => setIgnore(e.target.value)}>
                <option value="">None</option>
                {ignores.data?.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="License">
              <select className="input" value={license} onChange={(e) => setLicense(e.target.value)}>
                <option value="">None</option>
                {licenses.data?.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <div className="form-section">
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!name.trim() || busy || taken.isSuccess} onClick={submit}>
              {busy ? 'Creating…' : 'Create repository'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

// edit an existing file or create a new one, on this branch or a new one
export function FileEditor({ create }: { create?: boolean }) {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const splat = useParams()['*'] ?? '';
  const [ref = repo.default_branch, ...rest] = splat.split('/').filter(Boolean);
  const path = rest.join('/');
  const api = `/repos/${repo.full_name}`;
  const existing = useGh<any>(!create && `${api}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
  const [name, setName] = useState(create ? (path ? path + '/' : '') : path);
  const [draft, setDraft, clearText] = useDraft(`file:${repo.full_name}:${ref}:${create ? 'new:' : ''}${path}`);
  const [text, setTextState] = useState(create ? draft : '');
  const [original, setOriginal] = useState('');
  const [loaded, setLoaded] = useState(!!create);
  // only text that differs from the file is kept as a draft
  const setText = (v: string) => {
    setTextState(v);
    setDraft(v === original ? '' : v);
  };
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useAction();

  useEffect(() => {
    if (create || loaded || !existing.data) return;
    try {
      const content = fromBase64(existing.data.content ?? '');
      setOriginal(content);
      setTextState(draft || content);
      setLoaded(true);
    } catch {
      setError('This file is not text and cannot be edited here.');
    }
  }, [existing.data]);

  if (!repo.permissions?.push) return <Empty title="You can't edit this repository">Fork it to propose changes.</Empty>;
  if (!create && existing.isLoading) return <Loading />;
  if (!create && existing.error) return <ErrorBox error={existing.error} retry={existing.refetch} />;

  const target = name.trim().replace(/^\/+|\/+$/g, '');
  const renamed = !create && target !== path;
  const base = target.split('/').pop() || 'file';
  const fallback = create ? `Create ${base}` : renamed ? `Rename ${path.split('/').pop()} to ${base}` : `Update ${base}`;
  const commit = () =>
    run(async () => {
      const to = branch.trim() || ref;
      if (to !== ref) {
        const head = await gh<{ object: { sha: string } }>(`${api}/git/ref/heads/${encodeURIComponent(ref)}`);
        await gh(`${api}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${to}`, sha: head.object.sha } });
      }
      const msg = message.trim() || fallback;
      await gh(`${api}/contents/${encPath(target)}`, { method: 'PUT', body: { message: msg, content: toBase64(text), branch: to, sha: create || renamed ? undefined : existing.data.sha } });
      if (renamed) await gh(`${api}/contents/${encPath(path)}`, { method: 'DELETE', body: { message: msg, sha: existing.data.sha, branch: to } });
      clearText();
      await invalidate(api);
      navigate(to !== ref ? `/${repo.full_name}/compare/${ref}...${to}` : `/${repo.full_name}/blob/${to}/${target}`, { replace: true });
    });

  return (
    <div className="stack">
      <div className="toolbar">
        <span className="ref">
          <GitBranchIcon size={12} /> {ref}
        </span>
        <input className="input name-input wide" autoFocus={create} placeholder="path/to/file.ext" value={name} onChange={(e) => setName(e.target.value)} aria-label="File path" />
        {renamed && <span className="badge">Renamed</span>}
        {!create && loaded && text !== original && <span className="muted small">Unsaved draft</span>}
      </div>
      {error && <div className="banner">{error}</div>}
      <textarea className="input code-editor" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="File contents" />
      <section className="card form-section form">
        <Field label="Commit message">
          <input className="input" placeholder={fallback} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field label="Commit to a new branch (optional)" hint={branch.trim() ? `Creates ${branch.trim()} from ${ref} and opens the pull request form.` : `Leave empty to commit directly to ${ref}.`}>
          <input className="input" placeholder={`${ref}-patch`} value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
        <div className="form-foot">
          <span className="muted small">
            <GitCommitIcon size={12} /> Commits to {branch.trim() || ref}
          </span>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => {
              clearText();
              navigate(-1);
            }}
          >
            Discard
          </button>
          <button className="btn primary" disabled={busy || !loaded || !target || target.endsWith('/')} onClick={commit}>
            {busy ? 'Committing…' : 'Commit changes'}
          </button>
        </div>
      </section>
    </div>
  );
}

interface Comparison {
  ahead_by: number;
  behind_by: number;
  commits: CommitEntry[];
  files?: DiffFileEntry[];
}

// compare two refs and open a pull request from them
export function NewPull() {
  const { repo } = useRepo();
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const range = useParams()['*'] ?? '';
  const api = `/repos/${repo.full_name}`;
  const branches = useGhAll<Branch>(`${api}/branches?per_page=100`);
  const names = branches.items.map((b) => b.name);
  const [rangeBase, rangeHead] = range.includes('...') ? range.split('...') : [undefined, range || undefined];
  const base = sp.get('base') ?? rangeBase ?? repo.default_branch;
  const head = sp.get('head') ?? rangeHead ?? names.find((n) => n !== base) ?? '';
  const cmp = useGh<Comparison>(!!head && head !== base && `${api}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  const existing = useGh<PullRequest[]>(!!head && `${api}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head.includes(':') ? head : `${repo.owner.login}:${head}`)}`);
  const template = useGh<string>(`${api}/contents/.github/pull_request_template.md`, { accept: ACCEPT.raw, text: true, staleTime: 10 * 60_000 });
  const [title, setTitle, clearTitle] = useDraft(`new-pr-title:${repo.full_name}:${base}...${head}`);
  const [body, setBody, clearBody] = useDraft(`new-pr-body:${repo.full_name}:${base}...${head}`);
  const [draft, setDraft] = useState(false);
  const { busy, run } = useAction();
  const pick = (key: 'base' | 'head', value: string) => {
    const next = new URLSearchParams(sp);
    next.set(key, value);
    setSp(next, { replace: true });
  };
  useEffect(() => {
    if (template.data && !body) setBody(template.data);
  }, [template.data]);
  const commits = cmp.data?.commits ?? [];
  const fallbackTitle = commits.length === 1 ? commits[0].commit.message.split('\n')[0] : head.replace(/^.*:/, '').replace(/[-_/]+/g, ' ');
  const submit = () =>
    run(async () => {
      const created = await gh<PullRequest>(`${api}/pulls`, { method: 'POST', body: { title: title.trim() || fallbackTitle, body, head, base, draft } });
      clearTitle();
      clearBody();
      navigate(`/${repo.full_name}/pull/${created.number}`, { replace: true });
    });
  const open = existing.data?.[0];
  const refInput = (key: 'base' | 'head', value: string) => (
    <label className="meta-item">
      {key === 'base' ? 'base' : 'compare'}
      <input className="input select" list="branch-names" defaultValue={value} key={value} onBlur={(e) => e.target.value.trim() && e.target.value !== value && pick(key, e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
    </label>
  );

  return (
    <div className="stack">
      <h2 className="title">Compare changes</h2>
      <div className="toolbar">
        {refInput('base', base)}
        <span className="muted">←</span>
        {refInput('head', head)}
        <datalist id="branch-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
          {repo.parent && names.map((n) => <option key={'f' + n} value={`${viewer.login}:${n}`} />)}
        </datalist>
        {cmp.data && (
          <span className="muted">
            {plural(cmp.data.ahead_by, 'commit')} ahead, {cmp.data.behind_by} behind
          </span>
        )}
      </div>
      <p className="muted small">Type a branch, tag or commit. Use owner:branch to compare across forks.</p>
      {branches.isLoading || cmp.isLoading ? (
        <Loading />
      ) : cmp.error ? (
        <ErrorBox error={cmp.error} retry={cmp.refetch} />
      ) : !cmp.data || commits.length === 0 ? (
        <Empty title="Nothing to compare">Choose two refs where the compare side has commits the base doesn't.</Empty>
      ) : (
        <>
          {open ? (
            <div className="banner">
              A pull request for these branches is already open: <Link to={`/${repo.full_name}/pull/${open.number}`}>{open.title} #{open.number}</Link>
            </div>
          ) : (
            <section className="card form-section form">
              <input className="input" placeholder={fallbackTitle} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
              <MarkdownEditor value={body} onChange={setBody} context={repo.full_name} placeholder="Describe what this changes and why." rows={8} onSubmit={submit} />
              <div className="form-foot">
                <label className="check-row">
                  <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Create as draft
                </label>
                <span className="spacer" />
                <button className="btn primary" disabled={busy} onClick={submit}>
                  {busy ? 'Creating…' : draft ? 'Create draft pull request' : 'Create pull request'}
                </button>
              </div>
            </section>
          )}
          <section className="card">
            <div className="card-head">{plural(commits.length, 'commit')}</div>
            {commits.map((c) => (
              <div key={c.sha} className="row compact">
                <span className="state-icon">
                  <GitCommitIcon />
                </span>
                <Link className="row-main" to={`/${repo.full_name}/commit/${c.sha}`}>
                  {c.commit.message.split('\n')[0]}
                </Link>
                <code className="row-side">{c.sha.slice(0, 7)}</code>
              </div>
            ))}
          </section>
          {cmp.data.files?.map((f) => <DiffFile key={f.filename} file={f} />)}
        </>
      )}
    </div>
  );
}
