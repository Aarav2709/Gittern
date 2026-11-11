import { BoldIcon, CodeIcon, HeadingIcon, ItalicIcon, LinkIcon, ListOrderedIcon, ListUnorderedIcon, QuoteIcon, TasklistIcon } from '@primer/octicons-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { gh } from '../lib/api';
import { Loading, Markdown, Segmented } from './ui';

type Wrap = { before: string; after?: string; line?: boolean; placeholder?: string };

const TOOLS: { title: string; icon: ReactNode; wrap: Wrap; key?: string }[] = [
  { title: 'Heading', icon: <HeadingIcon size={14} />, wrap: { before: '### ', line: true } },
  { title: 'Bold (Ctrl+B)', icon: <BoldIcon size={14} />, wrap: { before: '**', after: '**', placeholder: 'bold' }, key: 'b' },
  { title: 'Italic (Ctrl+I)', icon: <ItalicIcon size={14} />, wrap: { before: '_', after: '_', placeholder: 'italic' }, key: 'i' },
  { title: 'Quote', icon: <QuoteIcon size={14} />, wrap: { before: '> ', line: true } },
  { title: 'Code (Ctrl+E)', icon: <CodeIcon size={14} />, wrap: { before: '`', after: '`', placeholder: 'code' }, key: 'e' },
  { title: 'Link (Ctrl+K)', icon: <LinkIcon size={14} />, wrap: { before: '[', after: '](url)', placeholder: 'text' }, key: 'k' },
  { title: 'Bulleted list', icon: <ListUnorderedIcon size={14} />, wrap: { before: '- ', line: true } },
  { title: 'Numbered list', icon: <ListOrderedIcon size={14} />, wrap: { before: '1. ', line: true } },
  { title: 'Task list', icon: <TasklistIcon size={14} />, wrap: { before: '- [ ] ', line: true } },
];

// applies a markdown wrap to the selection
export function applyWrap(text: string, start: number, end: number, w: Wrap): { text: string; start: number; end: number } {
  if (w.line) {
    const from = text.lastIndexOf('\n', start - 1) + 1;
    const block = text.slice(from, end) || '';
    const next = block
      .split('\n')
      .map((l) => w.before + l)
      .join('\n');
    return { text: text.slice(0, from) + next + text.slice(end), start: start + w.before.length, end: from + next.length };
  }
  const picked = text.slice(start, end) || w.placeholder || '';
  const after = w.after ?? '';
  return {
    text: text.slice(0, start) + w.before + picked + after + text.slice(end),
    start: start + w.before.length,
    end: start + w.before.length + picked.length,
  };
}

export function MarkdownEditor({
  value,
  onChange,
  context,
  onSubmit,
  placeholder = 'Leave a comment. Markdown is supported.',
  rows = 5,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  context: string;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (mode !== 'preview') return;
    let stale = false;
    setPreview(null);
    gh<string>('/markdown', { method: 'POST', body: { text: value, mode: 'gfm', context }, text: true })
      .then((html) => !stale && setPreview(html))
      .catch((e) => !stale && setPreview(`<p>${(e as Error).message}</p>`));
    return () => {
      stale = true;
    };
  }, [mode, value, context]);

  const wrap = (w: Wrap) => {
    const el = area.current;
    if (!el) return;
    const next = applyWrap(value, el.selectionStart, el.selectionEnd, w);
    onChange(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
        <span className="spacer" />
        {mode === 'write' &&
          TOOLS.map((t) => (
            <button key={t.title} type="button" className="icon-btn sm" title={t.title} aria-label={t.title} tabIndex={-1} onClick={() => wrap(t.wrap)}>
              {t.icon}
            </button>
          ))}
      </div>
      {mode === 'write' ? (
        <textarea
          ref={area}
          className="input"
          rows={rows}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (e.key === 'Enter') return onSubmit?.();
            const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
            if (tool) {
              e.preventDefault();
              e.stopPropagation();
              wrap(tool.wrap);
            }
          }}
        />
      ) : (
        <div className="editor-preview">
          {preview === null ? <Loading /> : value.trim() ? <Markdown html={preview} /> : <span className="muted">Nothing to preview.</span>}
        </div>
      )}
    </div>
  );
}

// quotes a comment body for a reply
export const quoteReply = (body: string) =>
  body
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n') + '\n\n';
