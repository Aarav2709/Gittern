import {
  LinkIcon,
  LocationIcon,
  MailIcon,
  OrganizationIcon,
  PeopleIcon,
  RepoForkedIcon,
  StarIcon,
} from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Avatar, ErrorBox, LangDot, ListState, Loading, LoadMore, Markdown, RepoGlyph, RepoRow, UserLink } from '../components/ui';
import { ACCEPT, gh, invalidate, useGh, useGhPages, useGql } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Repo, User } from '../lib/types';
import { compact } from '../lib/util';
import { GistList } from './Gists';
import { BlockButton, OrgPeople, OrgTeams } from './Org';

const PROFILE_QUERY = `
query($login: String!) {
  repositoryOwner(login: $login) {
    ... on ProfileOwner {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes { ... on Repository {
          name nameWithOwner description stargazerCount forkCount isPrivate isFork
          primaryLanguage { name }
        } }
      }
    }
    ... on User {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }
}`;

const LEVELS: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

function Calendar({ cal }: { cal: any }) {
  return (
    <section>
      <h3 className="section-title">{cal.totalContributions.toLocaleString()} contributions in the last year</h3>
      <div className="card calendar">
        <div className="calendar-grid">
          {cal.weeks.map((w: any, i: number) => (
            <div key={i} className="calendar-week">
              {w.contributionDays.map((d: any) => (
                <span
                  key={d.date}
                  className={`day l${LEVELS[d.contributionLevel] ?? 0}`}
                  title={`${d.contributionCount} contribution${d.contributionCount === 1 ? '' : 's'} on ${d.date}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Overview({ login, isUser }: { login: string; isUser: boolean }) {
  const readme = useGh<string>(isUser && `/repos/${login}/${login}/readme`, { accept: ACCEPT.html, text: true });
  const extra = useGql<any>('profile', PROFILE_QUERY, { login });
  const popular = useGh<any[]>(`/users/${login}/repos?sort=pushed&per_page=6`);
  const owner = extra.data?.repositoryOwner;
  const pinned: any[] = owner?.pinnedItems?.nodes?.filter((n: any) => n?.name) ?? [];
  const cal = owner?.contributionsCollection?.contributionCalendar;

  const cards = pinned.length
    ? pinned.map((r) => ({
        full: r.nameWithOwner, name: r.name, description: r.description, private: r.isPrivate, fork: r.isFork,
        lang: r.primaryLanguage?.name, stars: r.stargazerCount, forks: r.forkCount,
      }))
    : (popular.data ?? []).map((r) => ({
        full: r.full_name, name: r.name, description: r.description, private: r.private, fork: r.fork,
        lang: r.language, stars: r.stargazers_count, forks: r.forks_count,
      }));

  return (
    <div className="stack">
      {readme.data && (
        <section className="card pad-lg">
          <Markdown html={readme.data} base={{ repo: `${login}/${login}`, ref: 'HEAD' }} />
        </section>
      )}
      <section>
        <h3 className="section-title">{pinned.length ? 'Pinned' : 'Recently active'}</h3>
        {extra.isLoading && popular.isLoading && <Loading />}
        <div className="pin-grid">
          {cards.map((r) => (
            <div key={r.full} className="card pin">
              <div className="row-title">
                <RepoGlyph repo={r} />
                <Link to={`/${r.full}`}>{r.name}</Link>
                <span className="badge">{r.private ? 'Private' : 'Public'}</span>
              </div>
              <p className="row-desc">{r.description}</p>
              <div className="meta">
                {r.lang && <LangDot name={r.lang} />}
                {r.stars > 0 && (
                  <span className="meta-item">
                    <StarIcon size={14} /> {compact(r.stars)}
                  </span>
                )}
                {r.forks > 0 && (
                  <span className="meta-item">
                    <RepoForkedIcon size={14} /> {compact(r.forks)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {cal && <Calendar cal={cal} />}
    </div>
  );
}

function RepoList({ path }: { path: string }) {
  const [filter, setFilter] = useState('');
  const q = useGhPages<Repo>(path);
  const shown = q.items.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <input className="input" placeholder="Filter loaded repositories…" aria-label="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {!q.isLoading && shown.length === 0 && <p className="muted pad">No repositories to show.</p>}
      {shown.length > 0 && (
        <div className="card">
          {shown.map((r) => (
            <RepoRow key={r.id} repo={r} showOwner={path.includes('/starred')} />
          ))}
        </div>
      )}
      <LoadMore q={q} />
    </div>
  );
}

function FollowButton({ login }: { login: string }) {
  const path = `/user/following/${login}`;
  const q = useGh(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const following = q.isSuccess;
  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      await gh(path, { method: following ? 'DELETE' : 'PUT' });
      await Promise.all([invalidate(path), invalidate(`/users/${login}`)]);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 403 || status === 404 ? 'Your token lacks the "user:follow" scope.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`btn block ${following ? '' : 'primary'}`} disabled={busy || q.isLoading} onClick={toggle}>
        {following ? 'Unfollow' : 'Follow'}
      </button>
      {error && <span className="small muted">{error}</span>}
    </>
  );
}

function UserList({ path, empty }: { path: string; empty: string }) {
  const q = useGhPages<User>(path);
  return (
    <div className="stack">
      <ListState q={q} count={q.items.length} empty={empty} />
      <div className="people-grid">
        {q.items.map((u) => (
          <div key={u.id} className="card person">
            <Avatar user={u} size={36} />
            <UserLink user={u} />
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}


function Orgs({ login }: { login: string }) {
  const q = useGh<User[]>(`/users/${login}/orgs?per_page=30`);
  if (!q.data?.length) return null;
  return (
    <div className="faces">
      {q.data.map((o) => (
        <Link key={o.id} to={`/${o.login}`} title={o.login}>
          <img className="avatar square" src={o.avatar_url} width={28} height={28} alt={o.login} />
        </Link>
      ))}
    </div>
  );
}

export function Profile() {
  const { owner = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'overview';
  const user = useGh<User>(`/users/${owner}`);
  const { viewer } = useAuth();

  if (user.isLoading) return <Loading />;
  if (user.error) return <ErrorBox error={user.error} />;
  const u = user.data!;
  const isUser = u.type === 'User';
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'repositories', label: 'Repositories', count: u.public_repos },
    ...(isUser
      ? [
          { id: 'stars', label: 'Stars' },
          { id: 'gists', label: 'Gists', count: u.public_gists },
          { id: 'followers', label: 'Followers', count: u.followers },
          { id: 'following', label: 'Following', count: u.following },
        ]
      : [
          { id: 'people', label: 'People' },
          { id: 'teams', label: 'Teams' },
        ]),
  ];
  const blog = u.blog && (/^https?:\/\//.test(u.blog) ? u.blog : `https://${u.blog}`);

  return (
    <div className="page"><div className="profile">
      <aside className="profile-side">
        <img className={`profile-avatar ${isUser ? '' : 'org'}`} src={u.avatar_url} alt="" />
        <h1>{u.name ?? u.login}</h1>
        {u.name && <div className="profile-login">{u.login}</div>}
        {u.bio && <p className="profile-bio">{u.bio}</p>}
        {u.description && <p className="profile-bio">{u.description}</p>}
        {u.login === viewer.login ? (
          <Link className="btn block" to="/settings?tab=profile">
            Edit profile
          </Link>
        ) : (
          <>
            {isUser && <FollowButton login={u.login} />}
            {isUser && u.login !== viewer.login && <BlockButton login={u.login} />}
            <a className="btn block" href={u.html_url} data-external>
              Open on GitHub
            </a>
          </>
        )}
        <ul className="profile-facts">
          {isUser && (
            <li>
              <PeopleIcon size={14} />
              <span>
                <Link to={`/${u.login}?tab=followers`}>
                  <strong>{compact(u.followers ?? 0)}</strong> followers
                </Link>{' '}
                ·{' '}
                <Link to={`/${u.login}?tab=following`}>
                  <strong>{compact(u.following ?? 0)}</strong> following
                </Link>
              </span>
            </li>
          )}
          {u.company && (
            <li>
              <OrganizationIcon size={14} /> {u.company}
            </li>
          )}
          {u.location && (
            <li>
              <LocationIcon size={14} /> {u.location}
            </li>
          )}
          {u.email && (
            <li>
              <MailIcon size={14} /> <a href={`mailto:${u.email}`}>{u.email}</a>
            </li>
          )}
          {blog && (
            <li>
              <LinkIcon size={14} /> <a href={blog}>{u.blog!.replace(/^https?:\/\//, '')}</a>
            </li>
          )}
        </ul>
        {isUser && <Orgs login={u.login} />}
      </aside>
      <section className="profile-main">
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setSp(t.id === 'overview' ? {} : { tab: t.id })}
            >
              {t.label}
              {'count' in t && !!t.count && <span className="count">{compact(t.count)}</span>}
            </button>
          ))}
        </nav>
        {tab === 'overview' && <Overview login={u.login} isUser={isUser} />}
        {tab === 'repositories' && (
          <RepoList
            path={
              u.login === viewer.login
                ? '/user/repos?affiliation=owner&sort=pushed&per_page=30'
                : `/users/${u.login}/repos?sort=pushed&per_page=30`
            }
          />
        )}
        {tab === 'stars' && <RepoList path={`/users/${u.login}/starred?per_page=30`} />}
        {tab === 'gists' && <GistList path={`/users/${u.login}/gists?per_page=30`} />}
        {tab === 'followers' && <UserList path={`/users/${u.login}/followers?per_page=50`} empty="No followers yet" />}
        {tab === 'following' && <UserList path={`/users/${u.login}/following?per_page=50`} empty="Not following anyone" />}
        {tab === 'people' && <OrgPeople org={u.login} />}
        {tab === 'teams' && <OrgTeams org={u.login} />}
      </section>
    </div></div>
  );
}
