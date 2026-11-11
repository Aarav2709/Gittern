import hljs from 'highlight.js/lib/common';

const ALIAS: Record<string, string> = {
  tsx: 'typescript', mts: 'typescript', cts: 'typescript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  yml: 'yaml', htm: 'xml', svg: 'xml', vue: 'xml', h: 'c', hpp: 'cpp', cc: 'cpp', hh: 'cpp', zsh: 'bash', fish: 'bash',
  dockerfile: 'dockerfile', makefile: 'makefile', toml: 'ini', cfg: 'ini', conf: 'ini', kts: 'kotlin', gradle: 'groovy',
  rake: 'ruby', gemspec: 'ruby', pyi: 'python', mdx: 'markdown', jsonc: 'json', json5: 'json', lock: 'ini',
};

// above this, highlighting would stall the ui
export const HIGHLIGHT_LIMIT = 200_000;

export function langFor(filename: string): string | null {
  const name = filename.slice(filename.lastIndexOf('/') + 1).toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  const lang = ALIAS[ext] ?? ext;
  return hljs.getLanguage(lang) ? lang : null;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightCode(code: string, filename: string): string {
  const lang = langFor(filename);
  if (lang && code.length < HIGHLIGHT_LIMIT) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // fall through to plain text
    }
  }
  return escapeHtml(code);
}

// split highlighted html into balanced lines
export function splitHighlighted(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let line = '';
  const re = /<span[^>]*>|<\/span>|\n|[^<\n]+|</g;
  for (const m of html.matchAll(re)) {
    const tok = m[0];
    if (tok === '\n') {
      out.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (tok.startsWith('<span')) open.push(tok);
      else if (tok === '</span>') open.pop();
      line += tok;
    }
  }
  out.push(line + '</span>'.repeat(open.length));
  return out;
}

export const highlightLines = (code: string, filename: string) => splitHighlighted(highlightCode(code, filename));
