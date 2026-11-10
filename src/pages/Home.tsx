import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Loading, LoadMore, RepoGlyph, StateIcon, Time, UserLink } from '../components/ui';
import { useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';

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
  const q = useGh<any>(issueSearch(query, '&sort=updated').replace('per_page=30', 'per_page=6'));
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

export function Home() {
  const { viewer } = useAuth();
  const [filter, setFilter] = useState('');
  const repos = useGh<any[]>('/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member');
  const feed = useGhPages<any>(`/users/${viewer.login}/received_events?per_page=30`);
  const events = feed.items.map((e) => ({ e, d: describe(e) })).filter((x) => x.d);
  const shown = (repos.data ?? []).filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page home">
      <aside className="home-side">
        <h3 className="side-title">Repositories</h3>
        <input className="input" placeholder="Find a repository…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="side-list">
          {repos.isLoading && <Loading />}
          {shown.slice(0, 14).map((r) => (
            <Link key={r.id} to={`/${r.full_name}`} className="side-repo">
              <RepoGlyph repo={r} size={14} />
              <span>
                <span className="muted">{r.owner.login}/</span>
                {r.name}
              </span>
            </Link>
          ))}
        </div>
        <Link className="small" to={`/${viewer.login}?tab=repositories`}>
          All repositories →
        </Link>
      </aside>

      <section className="home-feed">
        <h2 className="section-title">Home</h2>
        {feed.isLoading && <Loading />}
        {feed.error && <ErrorBox error={feed.error} />}
        {!feed.isLoading && !feed.error && events.length === 0 && (
          <Empty title="Your feed is quiet">Follow people and star repositories to see activity here.</Empty>
        )}
        <div className={events.length ? 'card list' : ''}>
          {events.map(({ e, d }) => (
            <div key={e.id} className="event">
              <Avatar user={e.actor} size={32} />
              <div>
                <div>
                  <UserLink user={e.actor} /> <span className="muted">{d!.verb}</span>{' '}
                  <Link to={`/${e.repo.name}`} className="strong">
                    {e.repo.name}
                  </Link>{' '}
                  <span className="muted small">
                    · <Time iso={e.created_at} />
                  </span>
                </div>
                {d!.detail && (
                  <Link to={d!.detail.to} className="event-detail">
                    {d!.detail.text}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
        <LoadMore q={feed} />
      </section>

      <aside className="home-work">
        <WorkList title="Review requests" query="is:open is:pr review-requested:@me archived:false" empty="Nothing waiting on your review." />
        <WorkList title="Your open pull requests" query="is:open is:pr author:@me archived:false" empty="No open pull requests." />
        <WorkList title="Assigned to you" query="is:open is:issue assignee:@me archived:false" empty="No assigned issues." />
      </aside>
    </div>
  );
}
