import { BellIcon, GitPullRequestIcon, PlusIcon, SearchIcon, StarIcon } from '@primer/octicons-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Loading, LoadMore, RepoGlyph, StateIcon, Time } from '../components/ui';
import { useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compact, shortAgo } from '../lib/util';

export const issueSearch = (q: string, extra = '') =>
  `/search/issues?q=${encodeURIComponent(q)}&per_page=30${extra}`;

export const itemRoute = (item: any) => {
  const full = item.repository_url.split('/repos/')[1];
  return `/${full}/${item.pull_request ? 'pull' : 'issues'}/${item.number}`;
};

interface Described {
  verb: string;
  detail?: { text: string; to: string };
}

function describe(e: any): Described | null {
  const p = e.payload ?? {};
  const repo = `/${e.repo.name}`;
  switch (e.type) {
    case 'WatchEvent':
      return { verb: 'starred' };
    case 'ForkEvent':
      return { verb: 'forked', detail: p.forkee && { text: p.forkee.full_name, to: `/${p.forkee.full_name}` } };
    case 'CreateEvent':
      return { verb: p.ref_type === 'repository' ? 'created repository' : `created ${p.ref_type} ${p.ref} in` };
    case 'DeleteEvent':
      return { verb: `deleted ${p.ref_type} ${p.ref} in` };
    case 'PublicEvent':
      return { verb: 'open-sourced' };
    case 'PushEvent':
      return { verb: `pushed to ${String(p.ref ?? '').replace('refs/heads/', '')} in` };
    case 'ReleaseEvent':
      return {
        verb: 'published a release in',
        detail: p.release && { text: p.release.name || p.release.tag_name, to: `${repo}/releases` },
      };
    case 'PullRequestEvent': {
      const pr = p.pull_request ?? {};
      const verb = p.action === 'closed' && pr.merged ? 'merged' : p.action;
      const number = p.number ?? pr.number;
      return {
        verb: `${verb} a pull request in`,
        detail: number && { text: pr.title ? `${pr.title} #${number}` : `#${number}`, to: `${repo}/pull/${number}` },
      };
    }
    case 'IssuesEvent':
      return {
        verb: `${p.action} an issue in`,
        detail: p.issue && { text: `${p.issue.title} #${p.issue.number}`, to: `${repo}/issues/${p.issue.number}` },
      };
    case 'IssueCommentEvent':
      return {
        verb: 'commented in',
        detail: p.issue && {
          text: `${p.issue.title} #${p.issue.number}`,
          to: `${repo}/${p.issue.pull_request ? 'pull' : 'issues'}/${p.issue.number}`,
        },
      };
    case 'MemberEvent':
      return { verb: `added ${p.member?.login ?? 'a collaborator'} to` };
    default:
      return null;
  }
}

function WorkList({ title, query, empty }: { title: string; query: string; empty: string }) {
  const q = useGh<any>(issueSearch(query, '&sort=updated').replace('per_page=30', 'per_page=5'));
  return (
    <section className="card">
      <h3 className="card-title">
        {title}
        {q.data && <span className="count">{q.data.total_count}</span>}
      </h3>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.items.length ? (
        <p className="muted small pad">{empty}</p>
      ) : (
        q.data.items.map((it: any) => (
          <Link key={it.id} to={itemRoute(it)} className="work-item">
            <StateIcon item={it} />
            <span>
              <span className="work-title">{it.title}</span>
              <span className="muted small">
                {it.repository_url.split('/repos/')[1]} #{it.number} · <Time iso={it.updated_at} />
              </span>
            </span>
          </Link>
        ))
      )}
    </section>
  );
}

function QuickAction({ icon, label, hint, to, href }: { icon: ReactNode; label: string; hint?: string; to?: string; href?: string }) {
  const inner = (
    <>
      {icon}
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </>
  );
  return to ? (
    <Link className="quick" to={to}>
      {inner}
    </Link>
  ) : (
    <a className="quick" href={href} data-external>
      {inner}
    </a>
  );
}

type Scope = 'all' | 'personal' | 'org';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { viewer } = useAuth();
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const repos = useGh<any[]>('/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member');
  const feed = useGhPages<any>(`/users/${viewer.login}/received_events?per_page=30`);
  const events = feed.items.map((e) => ({ e, d: describe(e) })).filter((x) => x.d);
  const shown = (repos.data ?? [])
    .filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()))
    .filter((r) => scope === 'all' || (scope === 'personal') === (r.owner.login === viewer.login));
  const firstName = (viewer.name ?? viewer.login).split(' ')[0];

  return (
    <div className="page home">
      <header className="hero">
        <h1>
          {greeting()}, {firstName}.
        </h1>
        <p className="muted">Here's what's happening in your world.</p>
      </header>

      <div className="dash">
        <section className="card">
          <h3 className="card-title">Recent activity</h3>
          {feed.isLoading && <Loading />}
          {feed.error && <ErrorBox error={feed.error} retry={feed.refetch} />}
          {!feed.isLoading && !feed.error && events.length === 0 && (
            <Empty title="Your feed is quiet">Follow people and star repositories to see activity here.</Empty>
          )}
          {events.map(({ e, d }) => (
            <div key={e.id} className="activity">
              <Avatar user={e.actor} size={34} />
              <div className="activity-main">
                <Link to={`/${e.repo.name}`} className="activity-repo">
                  {e.repo.name}
                </Link>
                {d!.detail ? (
                  <Link to={d!.detail.to} className="activity-text">
                    {d!.detail.text}
                  </Link>
                ) : null}
                <span className="muted small">
                  <Link to={`/${e.actor.login}`} className="muted">
                    {e.actor.login}
                  </Link>{' '}
                  {d!.verb.replace(/ (in|to)$/, '')}
                </span>
              </div>
              <time className="muted small" title={new Date(e.created_at).toLocaleString()}>
                {shortAgo(e.created_at)}
              </time>
            </div>
          ))}
          <LoadMore q={feed} />
        </section>

        <div className="dash-side">
          <section className="card">
            <h3 className="card-title">Your repositories</h3>
            <div className="pad repo-filter">
              <input className="input" placeholder="Find repository…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="chips">
                {(['all', 'personal', 'org'] as Scope[]).map((s) => (
                  <button key={s} className={`chip ${scope === s ? 'on' : ''}`} onClick={() => setScope(s)}>
                    {s === 'all' ? 'All' : s === 'personal' ? 'Personal' : 'Organization'}
                  </button>
                ))}
              </div>
            </div>
            {repos.isLoading && <Loading />}
            {repos.error && <ErrorBox error={repos.error} retry={repos.refetch} />}
            {shown.slice(0, 7).map((r) => (
              <Link key={r.id} to={`/${r.full_name}`} className="work-item">
                <span className="state-icon">
                  <RepoGlyph repo={r} />
                </span>
                <span>
                  <span className="work-title">{r.full_name}</span>
                  <span className="muted small">{r.language ?? (r.private ? 'Private' : 'Public')}</span>
                </span>
                {r.stargazers_count > 0 && (
                  <span className="meta-item muted small">
                    <StarIcon size={12} /> {compact(r.stargazers_count)}
                  </span>
                )}
              </Link>
            ))}
            {!repos.isLoading && shown.length === 0 && <p className="muted small pad">No repositories match.</p>}
            <Link className="card-foot" to={`/${viewer.login}?tab=repositories`}>
              View all repositories →
            </Link>
          </section>
          <WorkList title="Review requests" query="is:open is:pr review-requested:@me archived:false" empty="Nothing waiting on your review." />
          <WorkList title="Your open pull requests" query="is:open is:pr author:@me archived:false" empty="No open pull requests." />
          <WorkList title="Assigned to you" query="is:open is:issue assignee:@me archived:false" empty="No assigned issues." />
        </div>
      </div>

      <section className="card quick-actions">
        <QuickAction icon={<SearchIcon />} label="Search or jump" hint="Ctrl K" to="/search" />
        <QuickAction icon={<BellIcon />} label="Notifications" to="/notifications" />
        <QuickAction icon={<GitPullRequestIcon />} label="Your pull requests" to="/pulls" />
        <QuickAction icon={<PlusIcon />} label="New repository" href="https://github.com/new" />
      </section>
    </div>
  );
}
