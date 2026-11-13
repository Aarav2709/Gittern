import { invoke } from '@tauri-apps/api/core';
import { FileIcon, XIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Empty, Field } from '../components/ui';
import { gh, invalidate, isTauri } from '../lib/api';
import { useAction } from '../lib/feedback';
import { formatBytes, plural } from '../lib/util';
import { useRepo } from './Repo';

interface Picked {
  name: string;
  content: string;
  size: number;
}

// several files in one commit, like the web uploader
export function UploadFiles() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const rest = useParams()['*'] ?? '';
  const [ref, ...dirParts] = rest ? rest.split('/') : [repo.default_branch];
  const [dir, setDir] = useState(dirParts.join('/'));
  const [files, setFiles] = useState<Picked[]>([]);
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const { busy, run } = useAction();
  const api = `/repos/${repo.full_name}`;
  if (!isTauri) return <Empty title="Uploading needs the app" />;
  if (!repo.permissions?.push) return <Empty title="You can't push to this repository" />;
  const branch = ref || repo.default_branch;
  const pick = () => run(async () => setFiles([...files, ...(await invoke<Picked[]>('pick_files'))]));
  const commit = () =>
    run(async () => {
      const head = await gh<{ object: { sha: string } }>(`${api}/git/ref/heads/${encodeURIComponent(branch)}`);
      const parent = await gh<{ tree: { sha: string } }>(`${api}/git/commits/${head.object.sha}`);
      const tree = [];
      for (const f of files) {
        const blob = await gh<{ sha: string }>(`${api}/git/blobs`, { method: 'POST', body: { content: f.content, encoding: 'base64' } });
        tree.push({ path: [dir.replace(/^\/+|\/+$/g, ''), f.name].filter(Boolean).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
      }
      const t = await gh<{ sha: string }>(`${api}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree } });
      const c = await gh<{ sha: string }>(`${api}/git/commits`, { method: 'POST', body: { message: message.trim() || `Add ${plural(files.length, 'file')}`, tree: t.sha, parents: [head.object.sha] } });
      const target = newBranch.trim();
      if (target) await gh(`${api}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${target}`, sha: c.sha } });
      else await gh(`${api}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: c.sha } });
      await invalidate(api);
      navigate(target ? `/${repo.full_name}/compare/${branch}...${target}` : `/${repo.full_name}/tree/${branch}${dir ? '/' + dir : ''}`);
    }, 'Files committed');
  return (
    <div className="stack narrow-form">
      <h2 className="title">Upload files</h2>
      <Field label="Folder" hint={`On ${branch}. Leave empty for the repository root.`}>
        <input className="input" value={dir} placeholder="docs/images" onChange={(e) => setDir(e.target.value)} />
      </Field>
      <div className="card">
        {files.map((f, i) => (
          <div key={i} className="row compact">
            <span className="state-icon">
              <FileIcon />
            </span>
            <div className="row-main">{f.name}</div>
            <span className="muted small">{formatBytes(f.size)}</span>
            <button className="icon-btn" title="Remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
              <XIcon />
            </button>
          </div>
        ))}
        <div className="pad">
          <button className="btn" disabled={busy} onClick={pick}>
            Choose files…
          </button>
        </div>
      </div>
      <Field label="Commit message">
        <input className="input" placeholder={`Add ${plural(files.length || 1, 'file')}`} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <Field label="New branch (optional)" hint="Commit to a new branch and open a pull request instead.">
        <input className="input" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
      </Field>
      <div className="form-foot">
        <span className="spacer" />
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !files.length} onClick={commit}>
          {busy ? 'Committing…' : `Commit ${plural(files.length, 'file')}`}
        </button>
      </div>
    </div>
  );
}
