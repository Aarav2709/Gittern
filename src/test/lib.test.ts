import { beforeEach, describe, expect, it } from 'vitest';
import { describeFailure, nextLink } from '../lib/api';
import { applyWrap, quoteReply } from '../components/Editor';
import { buildThreads, parsePatch, splitRows } from '../components/Diff';
import { itemState } from '../components/ui';
import { splitHighlighted } from '../lib/highlight';
import { isNewer, newThreads } from '../lib/inbox';
import { duration, fuzzyScore, parseLineHash, plural, routeFromUrl } from '../lib/util';
import { remoteRoute, splitPatch } from '../pages/Desktop';
import { parseTemplate } from '../pages/Issues';

describe('routeFromUrl', () => {
  const r = (u: string) => routeFromUrl(u, 'github.com');
  it('routes repositories and their sections', () => {
    expect(r('https://github.com/cli/cli')).toBe('/cli/cli');
    expect(r('https://github.com/cli/cli/issues/12')).toBe('/cli/cli/issues/12');
    expect(r('https://github.com/cli/cli/pull/7/files')).toBe('/cli/cli/pull/7/files');
    expect(r('https://github.com/cli/cli/pull/7/commits')).toBe('/cli/cli/pull/7/commits');
    expect(r('https://github.com/cli/cli/tree/trunk/pkg')).toBe('/cli/cli/tree/trunk/pkg');
    expect(r('https://github.com/cli/cli/discussions/3')).toBe('/cli/cli/discussions/3');
    expect(r('https://github.com/cli/cli/releases/tag/v2.0.0')).toBe('/cli/cli/releases/tag/v2.0.0');
    expect(r('https://github.com/cli/cli/compare/main...dev')).toBe('/cli/cli/compare/main...dev');
  });
  it('keeps line anchors on files', () => {
    expect(r('https://github.com/cli/cli/blob/trunk/go.mod#L3-L9')).toBe('/cli/cli/blob/trunk/go.mod#L3-L9');
    expect(r('https://github.com/cli/cli/blob/trunk/README.md#install')).toBe('/cli/cli/blob/trunk/README.md');
  });
  it('routes api urls from notifications', () => {
    expect(r('https://api.github.com/repos/cli/cli/pulls/9')).toBe('/cli/cli/pull/9');
    expect(r('https://api.github.com/repos/cli/cli/issues/9')).toBe('/cli/cli/issues/9');
    expect(r('https://api.github.com/repos/cli/cli/commits/abc')).toBe('/cli/cli/commit/abc');
  });
  it('routes top-level pages, orgs and gists', () => {
    expect(r('https://github.com/')).toBe('/');
    expect(r('https://github.com/notifications')).toBe('/notifications');
    expect(r('https://github.com/trending')).toBe('/explore');
    expect(r('https://github.com/orgs/rust-lang/people')).toBe('/rust-lang?tab=people');
    expect(r('https://github.com/topics/cli')).toBe('/search?q=topic%3Acli');
    expect(r('https://gist.github.com/octocat/0123456789abcdef0123')).toBe('/gist/0123456789abcdef0123');
  });
  it('leaves everything else to the browser', () => {
    expect(r('https://example.com/cli/cli')).toBeNull();
    expect(r('https://github.com/marketplace')).toBeNull();
    expect(r('https://github.com/cli/cli/wiki')).toBeNull();
    expect(r('https://github.com/cli/cli/issues/abc')).toBeNull();
    expect(r('not a url')).toBeNull();
  });
  it('works for an enterprise host', () => {
    expect(routeFromUrl('https://git.corp.example/a/b/pull/2', 'git.corp.example')).toBe('/a/b/pull/2');
    expect(routeFromUrl('https://git.corp.example/api/v3/repos/a/b/issues/2', 'git.corp.example')).toBe('/a/b/issues/2');
    expect(routeFromUrl('https://github.com/a/b', 'git.corp.example')).toBeNull();
  });
});

describe('small helpers', () => {
  it('parses line anchors', () => {
    expect(parseLineHash('#L4')).toEqual([4, 4]);
    expect(parseLineHash('#L9-L2')).toEqual([2, 9]);
    expect(parseLineHash('#readme')).toBeNull();
  });
  it('ranks fuzzy matches', () => {
    expect(fuzzyScore('src/lib/api.ts', 'api')).toBe(0);
    expect(fuzzyScore('src/lib/api.ts', 'pi.t')).toBe(1);
    expect(fuzzyScore('src/lib/api.ts', 'lib')).toBe(2);
    expect(fuzzyScore('src/lib/api.ts', 'slat')).toBe(3);
    expect(fuzzyScore('src/lib/api.ts', 'zzz')).toBe(-1);
  });
  it('formats counts and durations', () => {
    expect(plural(1, 'commit')).toBe('1 commit');
    expect(plural(2, 'dependency', 'dependencies')).toBe('2 dependencies');
    expect(duration(45_000)).toBe('45s');
    expect(duration(125_000)).toBe('2m 5s');
    expect(duration(3_720_000)).toBe('1h 2m');
  });
  it('follows pagination links', () => {
    expect(nextLink('<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"')).toBe('/user/repos?page=2');
    expect(nextLink('<https://git.corp.example/api/v3/user/repos?page=2>; rel="next"')).toBe('/user/repos?page=2');
    expect(nextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
  });
  it('compares versions', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
    expect(isNewer('1.0', '0.9.9')).toBe(true);
  });
  it('finds notifications not seen before', () => {
    const items = [
      { id: '1', updated_at: 'a' },
      { id: '2', updated_at: 'b' },
    ];
    expect(newThreads(items, null).fresh).toEqual([]);
    expect(newThreads(items, new Set(['1@a'])).fresh).toEqual([items[1]]);
    expect(newThreads(items, new Set(['1@a', '2@old'])).fresh).toEqual([items[1]]);
  });
});

describe('describeFailure', () => {
  const rate = { limit: 5000, remaining: 0, reset: 1_800_000_000, resource: 'core', retry_after: null };
  it('explains a used-up rate limit', () => {
    const e = describeFailure({ status: 403, body: '{"message":"API rate limit exceeded"}', rate });
    expect(e.rateLimited).toBe(true);
    expect(e.message).toMatch(/rate limit is used up/);
  });
  it('explains a secondary limit', () => {
    const e = describeFailure({ status: 429, body: '{}', rate: { ...rate, remaining: 10, retry_after: 30 } });
    expect(e.message).toMatch(/30 seconds/);
  });
  it('passes through ordinary errors with their detail', () => {
    expect(describeFailure({ status: 404, body: '{"message":"Not Found"}', rate }).message).toBe('Not Found');
    expect(describeFailure({ status: 422, body: '{"message":"Validation Failed","errors":[{"message":"name already exists"}]}' }).message).toBe('Validation Failed: name already exists');
    expect(describeFailure({ status: 502, body: '<html>' }).message).toBe('GitHub returned 502');
  });
});

describe('diffs', () => {
  const patch = '@@ -10,3 +10,4 @@ fn main\n ctx\n-old\n+new\n+more\n\\ No newline at end of file';
  it('numbers lines on both sides', () => {
    const lines = parsePatch(patch);
    expect(lines.map((l) => l.t)).toEqual(['hunk', 'ctx', 'del', 'add', 'add', 'meta']);
    expect(lines[1]).toMatchObject({ o: 10, n: 10, text: 'ctx' });
    expect(lines[2]).toMatchObject({ o: 11, text: 'old' });
    expect(lines[3]).toMatchObject({ n: 11, text: 'new' });
    expect(lines[4]).toMatchObject({ n: 12 });
  });
  it('pairs removals with additions for the split view', () => {
    const rows = splitRows(parsePatch(patch));
    expect(rows[0].full?.t).toBe('hunk');
    expect(rows[1].left).toBe(rows[1].right);
    expect(rows[2].left?.text).toBe('old');
    expect(rows[2].right?.text).toBe('new');
    expect(rows[3].left).toBeUndefined();
    expect(rows[3].right?.text).toBe('more');
  });
  it('groups review comments into threads', () => {
    const c = (id: number, in_reply_to_id?: number) => ({ id, in_reply_to_id }) as any;
    const threads = buildThreads([c(1), c(2, 1), c(3), c(4, 1), c(5, 99)]);
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      [1, [2, 4]],
      [3, []],
    ]);
  });
  it('keeps spans balanced when splitting highlighted lines', () => {
    expect(splitHighlighted('<span class="c">/* a\nb */</span> x')).toEqual(['<span class="c">/* a</span>', '<span class="c">b */</span> x']);
    expect(splitHighlighted('a &lt; b\n')).toEqual(['a &lt; b', '']);
  });
});

describe('issues', () => {
  it('names the state of issues and pull requests', () => {
    expect(itemState({ state: 'open' }).label).toBe('Open');
    expect(itemState({ state: 'closed', state_reason: 'not_planned' }).state).toBe('skipped');
    expect(itemState({ state: 'closed', pull_request: { merged_at: 'x' } }).state).toBe('merged');
    expect(itemState({ state: 'open', draft: true, head: {} }).state).toBe('draft');
    expect(itemState({ state: 'closed', merged: false, head: {} }).state).toBe('closed');
  });
  it('reads issue template front matter', () => {
    const t = parseTemplate('---\nname: Bug report\nabout: Something broke\ntitle: "[bug] "\nlabels: bug, needs triage\n---\n\n## Steps\n', 'bug');
    expect(t).toMatchObject({ name: 'Bug report', about: 'Something broke', title: '[bug] ', labels: ['bug', 'needs triage'], body: '## Steps\n' });
    expect(parseTemplate('just text', 'plain')).toMatchObject({ name: 'plain', labels: [], body: 'just text' });
  });
  it('wraps and prefixes markdown', () => {
    expect(applyWrap('make this bold', 5, 9, { before: '**', after: '**' })).toMatchObject({ text: 'make **this** bold', start: 7, end: 11 });
    expect(applyWrap('', 0, 0, { before: '`', after: '`', placeholder: 'code' }).text).toBe('`code`');
    expect(applyWrap('a\nb\nc', 2, 5, { before: '- ', line: true }).text).toBe('a\n- b\n- c');
    expect(quoteReply('one\ntwo')).toBe('> one\n> two\n\n');
  });
});

describe('tabs', () => {
  beforeEach(() => localStorage.clear());
  it('keeps a history per tab', async () => {
    const store = await import('../lib/store');
    store.recordNav('/a', false);
    store.recordNav('/b', false);
    expect(store.tabStep(-1)).toBe('/a');
    expect(store.recordNav('/a', false)).toBe(true);
    expect(store.tabStep(1)).toBe('/b');
    store.recordNav('/b', false);
    expect(store.tabStep(1)).toBeNull();
    // a second tab starts its own history and leaves the first alone
    store.openTab('/x', true);
    store.recordNav('/x', false);
    store.recordNav('/y', false);
    expect(store.tabStep(-1)).toBe('/x');
    store.recordNav('/x', false);
    expect(store.tabStep(-1)).toBeNull();
    expect(store.tabAt((i) => i - 1)).toBe('/b');
    store.recordNav('/b', false);
    expect(store.tabStep(-1)).toBe('/a');
  });
});

describe('desktop mode', () => {
  it('splits git diff output per file', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '+new',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/old name.md b/new name.md',
      'similarity index 100%',
      'rename from old name.md',
      'rename to new name.md',
      '',
    ].join('\n');
    const files = splitPatch(raw);
    expect(files.map((f) => [f.filename, f.status, f.additions, f.deletions])).toEqual([
      ['src/a.ts', 'modified', 1, 1],
      ['gone.txt', 'removed', 0, 1],
      ['new name.md', 'renamed', 0, 0],
    ]);
    expect(files[0].patch).toBe('@@ -1,2 +1,2 @@\n keep\n-old\n+new');
    expect(files[2].previous_filename).toBe('old name.md');
    expect(files[2].patch).toBeUndefined();
    expect(splitPatch('')).toEqual([]);
  });
  it('links an origin to its page', () => {
    expect(remoteRoute('https://github.com/cli/cli.git', 'github.com')).toBe('/cli/cli');
    expect(remoteRoute('git@github.com:rust-lang/rust.git\n', 'github.com')).toBe('/rust-lang/rust');
    expect(remoteRoute('https://gitlab.com/a/b.git', 'github.com')).toBeNull();
  });
});
