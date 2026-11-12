import { FileDirectoryIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import { MarkdownEditor } from '../components/Editor';
import { Avatar, CopyButton, ErrorBox, ListState, Loading, LoadMore, Segmented, Time } from '../components/ui';
import { ACCEPT, gh, invalidate, useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/feedback';
import { usePref } from '../lib/store';
import type { CommitEntry, User } from '../lib/types';
import { plural } from '../lib/util';
import { Comment, toggleReaction } from './Issues';
import { BranchPicker, useRefPath, useRepo } from './Repo';

const Sha = ({ sha }: { sha: string }) => <CopyButton text={sha} label={sha.slice(0, 7)} className="btn sm mono" />;

function Verified({ c }: { c: CommitEntry }) {
  return c.commit.verification?.verified ? (
    <span className="badge" title="Signed with a verified signature">
      Verified
    </span>
  ) : null;
}

export function Commits() {
  const { repo } = useRepo();
  const { ref, path, loading } = useRefPath(repo);
  const [author, setAuthor] = useState('');
  const q = useGhPages<CommitEntry>(
    !loading && `/repos/${repo.full_name}/commits?${author ? `author=${encodeURIComponent(author)}&` : ''}sha=${encodeURIComponent(ref)}&per_page=30${path ? `&path=${encodeURIComponent(path)}` : ''}`,
  );

  const groups: { day: string; commits: CommitEntry[] }[] = [];
  for (const c of q.items) {
    const day = new Date(c.commit.author.date).toLocaleDateString(undefined, { dateStyle: 'medium' });
    if (groups.at(-1)?.day !== day) groups.push({ day, commits: [] });
    groups.at(-1)!.commits.push(c);
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <BranchPicker repo={repo} current={ref} kind="commits" path={path} />
        {path && <span className="muted mono small">{path}</span>}
        <span className="spacer" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAuthor(new FormData(e.currentTarget).get('author')!.toString().trim());
          }}
        >
          <input className="input name-input" name="author" placeholder="Filter by author…" aria-label="Filter by author" />
        </form>
      </div>
      <ListState q={q} count={q.items.length} empty="No commits" />
      {groups.map((g) => (
        <section key={g.day}>
          <div className="group-title">{g.day}</div>
          <div className="card">
            {g.commits.map((c) => (
              <div key={c.sha} className="row">
                <div className="row-main">
                  <Link to={`/${repo.full_name}/commit/${c.sha}`} className="row-link">
                    {c.commit.message.split('\n')[0]}
                  </Link>
                  <div className="meta">
                    <Avatar user={c.author ?? {}} size={16} />
                    <strong>{c.author?.login ?? c.commit.author.name}</strong> committed <Time iso={c.commit.author.date} />
                  </div>
                </div>
                <Verified c={c} />
                <Sha sha={c.sha} />
                <Link className="icon-btn" to={`/${repo.full_name}/tree/${c.sha}`} title="Browse the repository at this point" aria-label="Browse files at this commit">
                  <FileDirectoryIcon />
                </Link>
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
  const { viewer } = useAuth();
  const { sha } = useParams();
  const api = `/repos/${repo.full_name}/commits/${sha}`;
  const q = useGh<CommitEntry>(api);
  const comments = useGhPages<{ id: number; user: User; body: string; body_html?: string; created_at: string; html_url: string; reactions?: Record<string, any> }>(`${api}/comments?per_page=100`, { accept: ACCEPT.full });
  const pulls = useGh<{ number: number; title: string }[]>(`${api}/pulls`);
  const [layout, setLayout] = usePref('diff-layout', 'unified');
  const [text, setText] = useState('');
  const { busy, run } = useAction();
  const act = (fn: () => Promise<unknown>) => run(async () => (await fn(), await invalidate(`${api}/comments`)));
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  const [title, ...bodyLines] = c.commit.message.split('\n');
  const body = bodyLines.join('\n').trim();
  const commentApi = (id: number) => `/repos/${repo.full_name}/comments/${id}`;

  return (
    <div className="stack">
      <div className="card commit-card">
        <h2>{title}</h2>
        {body && <pre className="commit-body">{body}</pre>}
        <div className="meta">
          <Avatar user={c.author} size={20} />
          <strong>{c.author?.login ?? c.commit.author.name}</strong> committed <Time iso={c.commit.author.date} />
          <Verified c={c} />
          {pulls.data?.map((p) => (
            <Link key={p.number} to={`/${repo.full_name}/pull/${p.number}`} title={p.title}>
              #{p.number}
            </Link>
          ))}
          <span className="spacer" />
          {c.parents.map((p) => (
            <Link key={p.sha} to={`/${repo.full_name}/commit/${p.sha}`} className="mono small">
              parent {p.sha.slice(0, 7)}
            </Link>
          ))}
          <Sha sha={c.sha} />
          <Link className="btn sm" to={`/${repo.full_name}/tree/${c.sha}`}>
            Browse files
          </Link>
        </div>
      </div>
      <div className="toolbar">
        <span className="muted small">
          {plural(c.files?.length ?? 0, 'changed file')} with <span className="add-text">{plural(c.stats?.additions ?? 0, 'addition')}</span> and{' '}
          <span className="del-text">{plural(c.stats?.deletions ?? 0, 'deletion')}</span>
        </span>
        <span className="spacer" />
        <Segmented
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'unified', label: 'Unified' },
            { value: 'split', label: 'Split' },
          ]}
        />
      </div>
      {c.files?.map((f) => <DiffFile key={f.filename} file={f} split={layout === 'split'} blobBase={`/${repo.full_name}/blob/${c.sha}`} />)}
      <div className="timeline narrow-col">
        {comments.items.map((cm) => (
          <Comment
            key={cm.id}
            c={cm}
            context={repo.full_name}
            link={cm.html_url}
            onSave={cm.user?.login === viewer.login ? (b) => act(() => gh(commentApi(cm.id), { method: 'PATCH', body: { body: b } })) : undefined}
            onDelete={cm.user?.login === viewer.login || repo.permissions?.push ? () => act(() => gh(commentApi(cm.id), { method: 'DELETE' })) : undefined}
            onReact={(content) => act(() => toggleReaction(`${commentApi(cm.id)}/reactions`, content))}
          />
        ))}
        <div className="composer">
          <MarkdownEditor value={text} onChange={setText} context={repo.full_name} rows={3} placeholder="Comment on this commit" />
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn primary" disabled={busy || !text.trim()} onClick={() => act(async () => (await gh(`${api}/comments`, { method: 'POST', body: { body: text } }), setText('')))}>
              Comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
