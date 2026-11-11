import { Link } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Loading, LoadMore, StateIcon, Time } from '../components/ui';
import { useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { shortAgo } from '../lib/util';

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

function WorkList({ title, query, empty, to }: { title: string; query: string; empty: string; to: string }) {
  const q = useGh<any>(issueSearch(query, '&sort=updated').replace('per_page=30', 'per_page=5'));
  return (
    <section className="card">
      <h3 className="card-title">
        <Link to={to}>{title}</Link>
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

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { viewer } = useAuth();
  const feed = useGhPages<any>(`/users/${viewer.login}/received_events?per_page=30`);
  const events = feed.items.map((e) => ({ e, d: describe(e) })).filter((x) => x.d);
  const firstName = (viewer.name ?? viewer.login).split(' ')[0];

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          {greeting()}, {firstName}
        </h1>
        <p className="muted">What needs you, and what the people and projects you follow have been doing.</p>
      </header>
      <div className="split">
        <div className="stack">
          <WorkList title="Needs your review" to="/pulls?filter=review-requested" query="is:open is:pr review-requested:@me archived:false" empty="Nothing waiting on your review." />
          <WorkList title="Your open pull requests" to="/pulls" query="is:open is:pr author:@me archived:false" empty="No open pull requests." />
          <WorkList title="Assigned to you" to="/issues?filter=assignee" query="is:open is:issue assignee:@me archived:false" empty="No assigned issues." />
        </div>
        <section className="card">
          <h3 className="card-title">Activity</h3>
          {feed.isLoading && <Loading />}
          {feed.error && <ErrorBox error={feed.error} retry={feed.refetch} />}
          {!feed.isLoading && !feed.error && events.length === 0 && (
            <Empty title="Your feed is quiet">Follow people and star repositories to see activity here.</Empty>
          )}
          {events.map(({ e, d }) => (
            <div key={e.id} className="row">
              <Avatar user={e.actor} size={28} />
              <div className="row-main">
                <div className="row-title">
                  <Link to={`/${e.repo.name}`}>{e.repo.name}</Link>
                </div>
                {d!.detail && (
                  <Link to={d!.detail.to} className="row-desc">
                    {d!.detail.text}
                  </Link>
                )}
                <div className="meta">
                  <Link to={`/${e.actor.login}`}>{e.actor.login}</Link> {d!.verb.replace(/ (in|to)$/, '')}
                </div>
              </div>
              <time className="row-side" title={new Date(e.created_at).toLocaleString()}>
                {shortAgo(e.created_at)}
              </time>
            </div>
          ))}
          <LoadMore q={feed} />
        </section>
      </div>
    </div>
  );
}
