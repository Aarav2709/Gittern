import { Link } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Loading, LoadMore } from '../components/ui';
import { useGhPages } from '../lib/api';
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

export function Home() {
  const { viewer } = useAuth();
  const feed = useGhPages<any>(`/users/${viewer.login}/received_events?per_page=30`);
  const events = feed.items.map((e) => ({ e, d: describe(e) })).filter((x) => x.d);

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Home</h1>
      </header>
      <section className="card">
        {feed.isLoading && <Loading />}
        {feed.error && <ErrorBox error={feed.error} retry={feed.refetch} />}
        {!feed.isLoading && !feed.error && events.length === 0 && (
          <Empty title="Your feed is quiet">Follow people and star repositories to see activity here.</Empty>
        )}
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
  );
}
