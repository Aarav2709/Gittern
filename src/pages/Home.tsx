import { Link, useSearchParams } from 'react-router-dom';
import { Avatar, ListState, LoadMore, Segmented, StateIcon } from '../components/ui';
import { useGh, useGhPages } from '../lib/api';
import type { Issue } from '../lib/types';
import { useAuth } from '../lib/auth';
import { shortAgo } from '../lib/util';

export const issueSearch = (q: string, extra = '') =>
  `/search/issues?q=${encodeURIComponent(q)}&per_page=30${extra}`;

export const itemRoute = (item: Pick<Issue, 'repository_url' | 'number'> & { pull_request?: unknown }) => {
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
    case 'PullRequestReviewEvent':
    case 'PullRequestReviewCommentEvent': {
      const pr = p.pull_request ?? {};
      return {
        verb: e.type === 'PullRequestReviewEvent' ? 'reviewed a pull request in' : 'commented on a pull request in',
        detail: pr.number && { text: pr.title ? `${pr.title} #${pr.number}` : `#${pr.number}`, to: `${repo}/pull/${pr.number}` },
      };
    }
    case 'MemberEvent':
      return { verb: `added ${p.member?.login ?? 'a collaborator'} to` };
    default:
      return null;
  }
}

function Work({ title, query, to }: { title: string; query: string; to: string }) {
  const q = useGh<{ total_count: number; items: Issue[] }>(issueSearch(`${query} state:open archived:false`, '&sort=updated').replace('per_page=30', 'per_page=5'));
  if (!q.data?.items.length) return null;
  return (
    <section className="card">
      <Link to={to} className="card-title">
        {title} <span className="count">{q.data.total_count}</span>
      </Link>
      {q.data.items.map((it) => (
        <Link key={it.id} to={itemRoute(it)} className="work-item">
          <StateIcon item={it} size={14} />
          <span>
            <span className="work-title">{it.title}</span>
            <span className="muted small">
              {it.repository_url.split('/repos/')[1]} #{it.number} · {shortAgo(it.updated_at)}
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}

export function Home() {
  const { viewer } = useAuth();
  const [sp, setSp] = useSearchParams();
  const mine = sp.get('feed') === 'you';
  const feed = useGhPages<any>(`/users/${viewer.login}/${mine ? 'events' : 'received_events'}?per_page=30`);
  // github emits one event per review comment
  const events = feed.items
    .map((e) => ({ e, d: describe(e) }))
    .filter((x) => x.d)
    .filter((x, i, all) => {
      const prev = all[i - 1];
      return !prev || prev.e.actor.login !== x.e.actor.login || prev.d!.verb !== x.d!.verb || prev.d!.detail?.to !== x.d!.detail?.to || prev.e.repo.name !== x.e.repo.name;
    });

  return (
    <div className="page wide">
      <header className="page-head">
        <h1>Home</h1>
      </header>
      <div className="work-grid">
        <Work title="Waiting for your review" query="is:pr review-requested:@me" to="/pulls?filter=review-requested" />
        <Work title="Your pull requests" query="is:pr author:@me" to="/pulls" />
        <Work title="Assigned to you" query="is:issue assignee:@me" to="/issues?filter=assignee" />
        <Work title="Mentioning you" query="mentions:@me" to="/issues?filter=mentions" />
      </div>
      <div className="stack">
        <div className="stack">
          <div className="toolbar">
            <Segmented
              value={mine ? 'you' : 'following'}
              onChange={(v) => setSp(v === 'you' ? { feed: 'you' } : {})}
              options={[
                { value: 'following', label: 'Following' },
                { value: 'you', label: 'Your activity' },
              ]}
            />
          </div>
          <section className="card">
            <ListState q={feed} count={events.length} empty="Your feed is quiet">
              Follow people and star repositories to see activity here.
            </ListState>
            {events.map(({ e, d }) => (
              <div key={e.id} className="row">
                <Avatar user={e.actor} size={32} />
                <div className="row-main">
                  <div>
                    <Link to={`/${e.actor.login}`} className="strong">
                      {e.actor.login}
                    </Link>{' '}
                    <span className="muted">{d!.verb}</span>{' '}
                    <Link to={`/${e.repo.name}`} className="strong">
                      {e.repo.name}
                    </Link>
                  </div>
                  {d!.detail && (
                    <Link to={d!.detail.to} className="row-desc">
                      {d!.detail.text}
                    </Link>
                  )}
                </div>
                <time className="row-side" title={new Date(e.created_at).toLocaleString()}>
                  {shortAgo(e.created_at)}
                </time>
              </div>
            ))}
          </section>
          <LoadMore q={feed} />
        </div>
      </div>
    </div>
  );
}
