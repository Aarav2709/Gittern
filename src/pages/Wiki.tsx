import { invoke } from '@tauri-apps/api/core';
import { BookIcon, PlusIcon } from '@primer/octicons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MarkdownEditor } from '../components/Editor';
import { Empty, Field, Loading, Markdown } from '../components/ui';
import { gh, isTauri } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, useAction } from '../lib/feedback';
import { useRepo } from './Repo';

interface Page {
  file: string;
  title: string;
}

// [[Page]] and [[Text|Page]] become plain links
const wikiLinks = (text: string) =>
  text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => {
    const target = (b ?? a).trim().replace(/ /g, '-');
    return `[${a.trim()}](${target})`;
  });

const fileFor = (title: string) => `${title.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-')}.md`;

export function Wiki() {
  const { repo } = useRepo();
  const { viewer } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const pages = useQuery<Page[], string>({ queryKey: ['wiki', repo.full_name], queryFn: () => invoke('wiki_pages', { repo: repo.full_name }), enabled: isTauri, retry: false });
  const list = pages.data ?? [];
  const wanted = sp.get('page');
  const current = list.find((p) => p.file === wanted || p.title === wanted || p.file.replace(/\.[^.]+$/, '') === wanted) ?? list.find((p) => /^home\./i.test(p.file)) ?? list[0];
  const text = useQuery<string, string>({ queryKey: ['wiki', repo.full_name, current?.file], queryFn: () => invoke('wiki_read', { repo: repo.full_name, file: current!.file }), enabled: !!current });
  const isMd = !!current && /\.(md|markdown)$/i.test(current.file);
  const html = useQuery({
    queryKey: ['wiki-html', repo.full_name, current?.file, text.data],
    queryFn: () => gh<string>('/markdown', { method: 'POST', body: { text: wikiLinks(text.data ?? ''), mode: 'gfm', context: repo.full_name }, text: true }),
    enabled: isMd && text.data != null,
  });
  const [editing, setEditing] = useState<{ title: string; body: string; previous?: string } | null>(null);
  const [message, setMessage] = useState('');
  const { busy, run } = useAction();
  const canEdit = !!repo.permissions?.push;
  const refresh = () => qc.invalidateQueries({ queryKey: ['wiki', repo.full_name] });
  const write = (file: string, content: string | null, previous?: string) =>
    invoke('wiki_write', {
      repo: repo.full_name,
      edit: { file, content, previous: previous ?? null, message, name: viewer.name || viewer.login, email: `${viewer.id}+${viewer.login}@users.noreply.github.com` },
    });
  const open = (file: string) => setSp(file ? { page: file } : {});

  if (!isTauri) return <Empty title="The wiki needs the app">It is read through git, which the browser preview can't run.</Empty>;
  if (pages.isLoading) return <Loading label="Fetching the wiki…" />;
  if (pages.error)
    return (
      <Empty title="No wiki pages" icon={<BookIcon size={22} />}>
        {String(pages.error)}{' '}
        <a href={`${repo.html_url}/wiki`} data-external>
          Open the wiki on GitHub
        </a>
      </Empty>
    );

  if (editing)
    return (
      <form
        className="stack narrow-form"
        onSubmit={(e) => {
          e.preventDefault();
          const file = fileFor(editing.title);
          void run(async () => {
            await write(file, editing.body, editing.previous);
            setEditing(null);
            setMessage('');
            await refresh();
            open(file);
          }, 'Page saved');
        }}
      >
        <Field label="Title">
          <input className="input" autoFocus={!editing.previous} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
        </Field>
        <MarkdownEditor value={editing.body} onChange={(body) => setEditing({ ...editing, body })} context={repo.full_name} rows={18} placeholder="Write the page. [[Other page]] links to another page." />
        <Field label="Edit message">
          <input className="input" placeholder={editing.previous ? `Update ${editing.title}` : `Create ${editing.title}`} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="form-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => setEditing(null)}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !editing.title.trim()}>
            {busy ? 'Saving…' : 'Save page'}
          </button>
        </div>
      </form>
    );

  return (
    <div className="code-layout">
      <div className="stack">
        <div className="toolbar">
          <h2 className="title">{current?.title ?? 'Wiki'}</h2>
          <span className="spacer" />
          {canEdit && current && (
            <>
              <button className="btn" onClick={() => setEditing({ title: current.title, body: text.data ?? '', previous: current.file })}>
                Edit
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (!(await confirmDialog({ title: `Delete ${current.title}?`, confirmLabel: 'Delete page', danger: true }))) return;
                  await run(async () => (await write(current.file, null), await refresh(), open('')), 'Page deleted');
                }}
              >
                Delete
              </button>
            </>
          )}
          {canEdit && (
            <button className="btn primary" onClick={() => setEditing({ title: '', body: '' })}>
              <PlusIcon /> New page
            </button>
          )}
        </div>
        <div
          className="card pad-lg"
          onClickCapture={(e) => {
            const a = (e.target as HTMLElement).closest('a');
            const href = a?.getAttribute('href');
            // relative links point at other pages
            if (href && !/^([a-z]+:|#|\/\/)/i.test(href)) {
              e.preventDefault();
              const name = decodeURIComponent(href.replace(/^\.?\//, '').replace(/^wiki\//, ''));
              const hit = list.find((p) => p.file.replace(/\.[^.]+$/, '').toLowerCase() === name.toLowerCase());
              if (hit) open(hit.file);
              else if (canEdit) setEditing({ title: name.replace(/-/g, ' '), body: '' });
            }
          }}
        >
          {text.isLoading || html.isLoading ? <Loading /> : isMd ? <Markdown html={html.data ?? ''} /> : <pre className="commit-body">{text.data}</pre>}
        </div>
      </div>
      <aside className="card wiki-pages">
        <div className="side-heading">{list.length} pages</div>
        {list.map((p) => (
          <button key={p.file} className={`side-link ${p.file === current?.file ? 'active' : ''}`} onClick={() => open(p.file)}>
            <span className="side-label">{p.title}</span>
          </button>
        ))}
      </aside>
    </div>
  );
}
