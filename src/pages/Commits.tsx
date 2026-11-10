import { CheckIcon, CopyIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import { Avatar, Empty, ErrorBox, Loading, LoadMore, Time } from '../components/ui';
import { useGh, useGhPages } from '../lib/api';
import { copyText } from '../lib/util';
import { useRepo } from './Repo';

function Sha({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn sm mono"
      title="Copy full SHA"
      onClick={() => {
        void copyText(sha);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {sha.slice(0, 7)} {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

export function Commits() {
  const { repo } = useRepo();
  const splat = useParams()['*'] ?? '';
  const [ref = repo.default_branch, ...rest] = splat ? splat.split('/') : [];
  const path = rest.join('/');
  const q = useGhPages<any>(
    `/repos/${repo.full_name}/commits?sha=${encodeURIComponent(ref)}&per_page=30${path ? `&path=${encodeURIComponent(path)}` : ''}`,
  );

  const groups: { day: string; commits: any[] }[] = [];
  for (const c of q.items) {
    const day = new Date(c.commit.author.date).toLocaleDateString(undefined, { dateStyle: 'medium' });
    if (groups.at(-1)?.day !== day) groups.push({ day, commits: [] });
    groups.at(-1)!.commits.push(c);
  }

  return (
    <div className="stack narrow">
      <h2 className="section-title">
        Commits on <code className="ref">{ref}</code>
        {path && <span className="muted"> · {path}</span>}
      </h2>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {!q.isLoading && !q.error && q.items.length === 0 && <Empty title="No commits" />}
      {groups.map((g) => (
        <section key={g.day}>
          <div className="group-title">{g.day}</div>
          <div className="card list">
            {g.commits.map((c) => (
              <div key={c.sha} className="row">
                <div className="row-main">
                  <Link to={`/${repo.full_name}/commit/${c.sha}`} className="issue-title">
                    {c.commit.message.split('\n')[0]}
                  </Link>
                  <div className="meta">
                    <Avatar user={c.author ?? {}} size={16} />
                    <strong>{c.author?.login ?? c.commit.author.name}</strong> committed <Time iso={c.commit.author.date} />
                  </div>
                </div>
                <Sha sha={c.sha} />
              </div>
            ))}
          </div>
        </section>
      ))}
      <LoadMore q={q} />
    </div>
  );
}

export function Commit() {
  const { repo } = useRepo();
  const { sha } = useParams();
  const q = useGh<any>(`/repos/${repo.full_name}/commits/${sha}`);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data;
  const [title, ...bodyLines] = c.commit.message.split('\n');
  const body = bodyLines.join('\n').trim();

  return (
    <div className="stack">
      <div className="card commit-card">
        <h2>{title}</h2>
        {body && <pre className="commit-body">{body}</pre>}
        <div className="meta">
          <Avatar user={c.author ?? {}} size={20} />
          <strong>{c.author?.login ?? c.commit.author.name}</strong> committed <Time iso={c.commit.author.date} />
          <span className="spacer" />
          {c.parents.map((p: any) => (
            <Link key={p.sha} to={`/${repo.full_name}/commit/${p.sha}`} className="mono small">
              parent {p.sha.slice(0, 7)}
            </Link>
          ))}
          <Sha sha={c.sha} />
        </div>
      </div>
      <div className="muted small">
        {c.files?.length ?? 0} changed file{c.files?.length === 1 ? '' : 's'} with{' '}
        <span className="add-text">{c.stats.additions.toLocaleString()} additions</span> and{' '}
        <span className="del-text">{c.stats.deletions.toLocaleString()} deletions</span>
      </div>
      {c.files?.map((f: any) => <DiffFile key={f.filename} file={f} />)}
    </div>
  );
}
