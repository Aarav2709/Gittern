import { useSearchParams } from 'react-router-dom';
import { ListState, LoadMore, RepoRow, Segmented } from '../components/ui';
import { useGhPages } from '../lib/api';
import type { Repo } from '../lib/types';

const LANGUAGES = ['', 'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'Java', 'C++', 'C', 'C#', 'Swift', 'Kotlin', 'Ruby', 'PHP', 'Zig', 'Shell'];
const SPANS: Record<string, { label: string; days: number }> = {
  week: { label: 'This week', days: 7 },
  month: { label: 'This month', days: 30 },
  year: { label: 'This year', days: 365 },
};

// github has no trending api
export function Explore() {
  const [sp, setSp] = useSearchParams();
  const span = SPANS[sp.get('since') ?? ''] ? sp.get('since')! : 'week';
  const lang = sp.get('language') ?? '';
  const since = new Date(Date.now() - SPANS[span].days * 86400_000).toISOString().slice(0, 10);
  const query = `created:>${since}${lang ? ` language:"${lang}"` : ''}`;
  const q = useGhPages<Repo>(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=30`, { pick: (d) => d.items });
  const set = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(sp);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setSp(next);
  };
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Explore</h1>
        <p className="muted">New repositories people are starring.</p>
      </header>
      <div className="toolbar">
        <Segmented value={span} onChange={(v) => set('since', v, 'week')} options={Object.entries(SPANS).map(([value, s]) => ({ value, label: s.label }))} />
        <span className="spacer" />
        <select className="input select" value={lang} onChange={(e) => set('language', e.target.value, '')} aria-label="Language">
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l || 'Any language'}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <ListState q={q} count={q.items.length} empty="Nothing found" />
        {q.items.map((r) => (
          <RepoRow key={r.id} repo={r} showOwner />
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}
