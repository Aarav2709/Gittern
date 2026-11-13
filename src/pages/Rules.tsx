import { LockIcon, ShieldIcon } from '@primer/octicons-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, ListState, Loading, Modal } from '../components/ui';
import { gh, invalidate, useGh, useGhAll } from '../lib/api';
import { confirmDialog, useAction } from '../lib/feedback';
import type { Branch, Repo } from '../lib/types';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function Check({ on, set, children, hint }: { on: boolean; set: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="rule-check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        {children}
        {hint && <span className="muted small"> {hint}</span>}
      </span>
    </label>
  );
}

interface Protection {
  pr: boolean;
  approvals: number;
  dismissStale: boolean;
  codeOwners: boolean;
  lastPush: boolean;
  checks: boolean;
  strict: boolean;
  contexts: string;
  admins: boolean;
  linear: boolean;
  forcePush: boolean;
  deletions: boolean;
  conversations: boolean;
  lock: boolean;
}

const fromApi = (p: any): Protection => ({
  pr: !!p?.required_pull_request_reviews,
  approvals: p?.required_pull_request_reviews?.required_approving_review_count ?? 1,
  dismissStale: !!p?.required_pull_request_reviews?.dismiss_stale_reviews,
  codeOwners: !!p?.required_pull_request_reviews?.require_code_owner_reviews,
  lastPush: !!p?.required_pull_request_reviews?.require_last_push_approval,
  checks: !!p?.required_status_checks,
  strict: !!p?.required_status_checks?.strict,
  contexts: (p?.required_status_checks?.contexts ?? []).join(', '),
  admins: !!p?.enforce_admins?.enabled,
  linear: !!p?.required_linear_history?.enabled,
  forcePush: !!p?.allow_force_pushes?.enabled,
  deletions: !!p?.allow_deletions?.enabled,
  conversations: !!p?.required_conversation_resolution?.enabled,
  lock: !!p?.lock_branch?.enabled,
});

const toApi = (f: Protection) => ({
  required_status_checks: f.checks ? { strict: f.strict, contexts: list(f.contexts) } : null,
  enforce_admins: f.admins,
  required_pull_request_reviews: f.pr
    ? { required_approving_review_count: f.approvals, dismiss_stale_reviews: f.dismissStale, require_code_owner_reviews: f.codeOwners, require_last_push_approval: f.lastPush }
    : null,
  restrictions: null,
  required_linear_history: f.linear,
  allow_force_pushes: f.forcePush,
  allow_deletions: f.deletions,
  required_conversation_resolution: f.conversations,
  lock_branch: f.lock,
});

function ProtectionDialog({ repo, branch, onClose }: { repo: Repo; branch: string | null; onClose: () => void }) {
  const api = `/repos/${repo.full_name}/branches`;
  const existing = useGh<any>(branch && `${api}/${encodeURIComponent(branch)}/protection`);
  const [name, setName] = useState(branch ?? '');
  const [f, setF] = useState<Protection>(fromApi(null));
  useEffect(() => {
    if (existing.data) setF(fromApi(existing.data));
    else if (!branch) setF({ ...fromApi(null), pr: true });
  }, [existing.data]);
  const { busy, run } = useAction();
  const set = <K extends keyof Protection>(k: K) => (v: Protection[K]) => setF({ ...f, [k]: v });
  if (branch && existing.isLoading) return <Loading />;
  return (
    <Modal title={branch ? `Protection for ${branch}` : 'Protect a branch'} onClose={onClose} wide>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await gh(`${api}/${encodeURIComponent(name.trim())}/protection`, { method: 'PUT', body: toApi(f) });
            await invalidate(api);
            onClose();
          }, 'Protection saved');
        }}
      >
        {!branch && (
          <Field label="Branch">
            <input className="input" autoFocus placeholder={repo.default_branch} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Check on={f.pr} set={set('pr')}>
          Require a pull request before merging
        </Check>
        {f.pr && (
          <div className="rule-sub">
            <Field label="Required approvals">
              <input className="input" type="number" min={0} max={6} value={f.approvals} onChange={(e) => set('approvals')(Number(e.target.value))} />
            </Field>
            <Check on={f.dismissStale} set={set('dismissStale')}>
              Dismiss approvals when new commits are pushed
            </Check>
            <Check on={f.codeOwners} set={set('codeOwners')}>
              Require review from code owners
            </Check>
            <Check on={f.lastPush} set={set('lastPush')}>
              Require approval of the most recent push
            </Check>
          </div>
        )}
        <Check on={f.checks} set={set('checks')}>
          Require status checks to pass
        </Check>
        {f.checks && (
          <div className="rule-sub">
            <Field label="Checks, comma separated" hint="The names shown in a pull request's checks.">
              <input className="input" value={f.contexts} onChange={(e) => set('contexts')(e.target.value)} />
            </Field>
            <Check on={f.strict} set={set('strict')}>
              Require the branch to be up to date
            </Check>
          </div>
        )}
        <Check on={f.conversations} set={set('conversations')}>
          Require conversation resolution
        </Check>
        <Check on={f.linear} set={set('linear')}>
          Require linear history
        </Check>
        <Check on={f.lock} set={set('lock')} hint="Read-only branch.">
          Lock branch
        </Check>
        <Check on={f.admins} set={set('admins')}>
          Apply the rules to administrators too
        </Check>
        <Check on={f.forcePush} set={set('forcePush')}>
          Allow force pushes
        </Check>
        <Check on={f.deletions} set={set('deletions')}>
          Allow deletion
        </Check>
        <div className="form-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Save protection
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface RuleForm {
  name: string;
  target: 'branch' | 'tag';
  enforcement: 'active' | 'evaluate' | 'disabled';
  include: string;
  exclude: string;
  bypassAdmins: boolean;
  creation: boolean;
  update: boolean;
  deletion: boolean;
  nonFastForward: boolean;
  linear: boolean;
  signatures: boolean;
  pr: boolean;
  approvals: number;
  dismissStale: boolean;
  codeOwners: boolean;
  lastPush: boolean;
  threads: boolean;
  checks: boolean;
  strict: boolean;
  contexts: string;
}

const EMPTY_RULES: RuleForm = {
  name: '',
  target: 'branch',
  enforcement: 'active',
  include: '~DEFAULT_BRANCH',
  exclude: '',
  bypassAdmins: false,
  creation: false,
  update: false,
  deletion: true,
  nonFastForward: true,
  linear: false,
  signatures: false,
  pr: false,
  approvals: 1,
  dismissStale: false,
  codeOwners: false,
  lastPush: false,
  threads: false,
  checks: false,
  strict: false,
  contexts: '',
};

const SIMPLE: [keyof RuleForm, string, string][] = [
  ['creation', 'creation', 'Restrict creations'],
  ['update', 'update', 'Restrict updates'],
  ['deletion', 'deletion', 'Restrict deletions'],
  ['nonFastForward', 'non_fast_forward', 'Block force pushes'],
  ['linear', 'required_linear_history', 'Require linear history'],
  ['signatures', 'required_signatures', 'Require signed commits'],
];

// the ref prefix rulesets use for plain names
const toRef = (target: string, p: string) => (p.startsWith('~') || p.startsWith('refs/') ? p : `refs/${target === 'tag' ? 'tags' : 'heads'}/${p}`);
const fromRef = (p: string) => p.replace(/^refs\/(heads|tags)\//, '');

function rulesFromApi(r: any): RuleForm {
  const has = (t: string) => r.rules?.find((x: any) => x.type === t);
  const pr = has('pull_request')?.parameters;
  const sc = has('required_status_checks')?.parameters;
  return {
    name: r.name,
    target: r.target === 'tag' ? 'tag' : 'branch',
    enforcement: r.enforcement,
    include: (r.conditions?.ref_name?.include ?? []).map(fromRef).join(', '),
    exclude: (r.conditions?.ref_name?.exclude ?? []).map(fromRef).join(', '),
    bypassAdmins: !!r.bypass_actors?.some((b: any) => b.actor_type === 'RepositoryRole' && b.actor_id === 5),
    creation: !!has('creation'),
    update: !!has('update'),
    deletion: !!has('deletion'),
    nonFastForward: !!has('non_fast_forward'),
    linear: !!has('required_linear_history'),
    signatures: !!has('required_signatures'),
    pr: !!pr,
    approvals: pr?.required_approving_review_count ?? 1,
    dismissStale: !!pr?.dismiss_stale_reviews_on_push,
    codeOwners: !!pr?.require_code_owner_review,
    lastPush: !!pr?.require_last_push_approval,
    threads: !!pr?.required_review_thread_resolution,
    checks: !!sc,
    strict: !!sc?.strict_required_status_checks_policy,
    contexts: (sc?.required_status_checks ?? []).map((c: any) => c.context).join(', '),
  };
}

function rulesToApi(f: RuleForm) {
  const rules: any[] = SIMPLE.filter(([k]) => f[k]).map(([, type]) => ({ type }));
  if (f.pr)
    rules.push({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: f.approvals,
        dismiss_stale_reviews_on_push: f.dismissStale,
        require_code_owner_review: f.codeOwners,
        require_last_push_approval: f.lastPush,
        required_review_thread_resolution: f.threads,
      },
    });
  if (f.checks) rules.push({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: f.strict, required_status_checks: list(f.contexts).map((context) => ({ context })) } });
  return {
    name: f.name.trim(),
    target: f.target,
    enforcement: f.enforcement,
    conditions: { ref_name: { include: list(f.include).map((p) => toRef(f.target, p)), exclude: list(f.exclude).map((p) => toRef(f.target, p)) } },
    bypass_actors: f.bypassAdmins ? [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] : [],
    rules,
  };
}

function RulesetDialog({ repo, id, onClose }: { repo: Repo; id: number | null; onClose: () => void }) {
  const api = `/repos/${repo.full_name}/rulesets`;
  const existing = useGh<any>(id ? `${api}/${id}` : null);
  const [f, setF] = useState<RuleForm>(EMPTY_RULES);
  useEffect(() => {
    if (existing.data) setF(rulesFromApi(existing.data));
  }, [existing.data]);
  const { busy, run } = useAction();
  const set = <K extends keyof RuleForm>(k: K) => (v: RuleForm[K]) => setF({ ...f, [k]: v });
  if (id && existing.isLoading) return <Loading />;
  return (
    <Modal title={id ? `Edit ${f.name || 'ruleset'}` : 'New ruleset'} onClose={onClose} wide>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await gh(id ? `${api}/${id}` : api, { method: id ? 'PUT' : 'POST', body: rulesToApi(f) });
            await invalidate(api);
            onClose();
          }, 'Ruleset saved');
        }}
      >
        <div className="split">
          <Field label="Name">
            <input className="input" autoFocus={!id} value={f.name} onChange={(e) => set('name')(e.target.value)} />
          </Field>
          <Field label="Enforcement">
            <select className="input" value={f.enforcement} onChange={(e) => set('enforcement')(e.target.value as RuleForm['enforcement'])}>
              <option value="active">Active</option>
              <option value="evaluate">Evaluate (report only)</option>
              <option value="disabled">Disabled</option>
            </select>
          </Field>
        </div>
        <div className="split">
          <Field label="Applies to">
            <select className="input" value={f.target} onChange={(e) => set('target')(e.target.value as RuleForm['target'])}>
              <option value="branch">Branches</option>
              <option value="tag">Tags</option>
            </select>
          </Field>
          <Check on={f.bypassAdmins} set={set('bypassAdmins')}>
            Repository admins can bypass
          </Check>
        </div>
        <div className="split">
          <Field label="Include" hint="Names or patterns like release/*, plus ~DEFAULT_BRANCH or ~ALL.">
            <input className="input" value={f.include} onChange={(e) => set('include')(e.target.value)} />
          </Field>
          <Field label="Exclude">
            <input className="input" value={f.exclude} onChange={(e) => set('exclude')(e.target.value)} />
          </Field>
        </div>
        {SIMPLE.map(([k, , label]) => (
          <Check key={k} on={f[k] as boolean} set={set(k) as (v: boolean) => void}>
            {label}
          </Check>
        ))}
        <Check on={f.pr} set={set('pr')}>
          Require a pull request before merging
        </Check>
        {f.pr && (
          <div className="rule-sub">
            <Field label="Required approvals">
              <input className="input" type="number" min={0} max={10} value={f.approvals} onChange={(e) => set('approvals')(Number(e.target.value))} />
            </Field>
            <Check on={f.dismissStale} set={set('dismissStale')}>
              Dismiss stale approvals on push
            </Check>
            <Check on={f.codeOwners} set={set('codeOwners')}>
              Require review from code owners
            </Check>
            <Check on={f.lastPush} set={set('lastPush')}>
              Require approval of the most recent push
            </Check>
            <Check on={f.threads} set={set('threads')}>
              Require conversation resolution
            </Check>
          </div>
        )}
        <Check on={f.checks} set={set('checks')}>
          Require status checks to pass
        </Check>
        {f.checks && (
          <div className="rule-sub">
            <Field label="Checks, comma separated">
              <input className="input" value={f.contexts} onChange={(e) => set('contexts')(e.target.value)} />
            </Field>
            <Check on={f.strict} set={set('strict')}>
              Require branches to be up to date
            </Check>
          </div>
        )}
        <div className="form-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.name.trim() || !list(f.include).length}>
            Save ruleset
          </button>
        </div>
      </form>
    </Modal>
  );
}

// classic protection and rulesets for a repository
export function BranchRules({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}`;
  const q = useGhAll<Branch>(`${api}/branches?protected=true&per_page=100`);
  const rules = useGh<{ id: number; name: string; enforcement: string; target: string; source_type?: string }[]>(`${api}/rulesets?per_page=100&includes_parents=true`);
  const { busy, run } = useAction();
  const [protecting, setProtecting] = useState<string | null | undefined>(undefined);
  const [ruleset, setRuleset] = useState<number | null | undefined>(undefined);
  return (
    <>
      <section className="card">
        <div className="card-head">
          <strong>Protected branches</strong>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setProtecting(null)}>
            Protect a branch
          </button>
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
            <button className="btn sm" onClick={() => setProtecting(b.name)}>
              Edit
            </button>
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
      </section>
      <section className="card">
        <div className="card-head">
          <strong>Rulesets</strong>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setRuleset(null)}>
            New ruleset
          </button>
        </div>
        <ListState q={rules} count={rules.data?.length ?? 0} empty="No rulesets" />
        {rules.data?.map((r) => {
          const inherited = r.source_type && r.source_type !== 'Repository';
          return (
            <div key={r.id} className="row compact">
              <span className="state-icon">
                <ShieldIcon />
              </span>
              <div className="row-main">
                <div className="row-title">
                  {r.name} <span className="badge">{r.enforcement}</span> <span className="badge">{r.target}</span> {inherited && <span className="badge">from {r.source_type?.toLowerCase()}</span>}
                </div>
              </div>
              {!inherited && (
                <>
                  <button className="btn sm" onClick={() => setRuleset(r.id)}>
                    Edit
                  </button>
                  <button
                    className="btn sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await confirmDialog({ title: `Delete the ${r.name} ruleset?`, confirmLabel: 'Delete', danger: true }))
                        void run(async () => (await gh(`${api}/rulesets/${r.id}`, { method: 'DELETE' }), await invalidate(`${api}/rulesets`)), 'Ruleset deleted');
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          );
        })}
      </section>
      {protecting !== undefined && <ProtectionDialog repo={repo} branch={protecting} onClose={() => setProtecting(undefined)} />}
      {ruleset !== undefined && <RulesetDialog repo={repo} id={ruleset} onClose={() => setRuleset(undefined)} />}
    </>
  );
}
