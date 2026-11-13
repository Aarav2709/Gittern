import { HeartIcon } from '@primer/octicons-react';
import { Link } from 'react-router-dom';
import { Avatar, Dropdown, Empty, Loading, Markdown } from '../components/ui';
import { useGql } from '../lib/api';

const PEOPLE = 'nodes { ... on User { login avatarUrl } ... on Organization { login avatarUrl } }';

const SPONSORS_QUERY = `
query($login: String!) {
  repositoryOwner(login: $login) {
    ... on Sponsorable {
      hasSponsorsListing viewerIsSponsoring viewerCanSponsor
      sponsorsListing { url shortDescription fullDescriptionHTML tiers(first: 20) { nodes { id name monthlyPriceInDollars isOneTime descriptionHTML } } }
      sponsors(first: 60) { totalCount ${PEOPLE} }
      sponsoring(first: 60) { totalCount ${PEOPLE} }
    }
  }
}`;

function People({ title, conn }: { title: string; conn: { totalCount: number; nodes: { login: string; avatarUrl: string }[] } }) {
  if (!conn?.totalCount) return null;
  return (
    <section className="card pad-lg stack">
      <strong>
        {title} <span className="count">{conn.totalCount}</span>
      </strong>
      <div className="avatar-wall">
        {conn.nodes.filter((n) => n?.login).map((n) => (
          <Link key={n.login} to={`/${n.login}`} title={n.login}>
            <Avatar user={{ login: n.login, avatar_url: n.avatarUrl }} size={32} />
          </Link>
        ))}
      </div>
    </section>
  );
}

// a sponsors listing with its tiers, sponsors and who they sponsor
export function Sponsors({ login }: { login: string }) {
  const q = useGql<any>('sponsors', SPONSORS_QUERY, { login });
  if (q.isLoading) return <Loading />;
  const s = q.data?.repositoryOwner;
  if (!s || (!s.hasSponsorsListing && !s.sponsors?.totalCount && !s.sponsoring?.totalCount)) return <Empty title="No sponsorships" icon={<HeartIcon size={22} />} />;
  const listing = s.sponsorsListing;
  return (
    <div className="stack">
      {listing && (
        <section className="card pad-lg stack">
          <div className="toolbar">
            <strong>{listing.shortDescription}</strong>
            <span className="spacer" />
            {s.viewerCanSponsor && (
              <a className="btn primary" href={listing.url} data-external>
                <HeartIcon /> {s.viewerIsSponsoring ? 'Manage sponsorship' : 'Sponsor'}
              </a>
            )}
          </div>
          {listing.fullDescriptionHTML && <Markdown html={listing.fullDescriptionHTML} />}
        </section>
      )}
      {!!listing?.tiers?.nodes.length && (
        <div className="tier-grid">
          {listing.tiers.nodes.map((t: any) => (
            <a key={t.id} className="card pad-lg tier" href={listing.url} data-external>
              <strong>
                ${t.monthlyPriceInDollars} {t.isOneTime ? 'one time' : 'a month'}
              </strong>
              {t.descriptionHTML && <Markdown html={t.descriptionHTML} />}
            </a>
          ))}
        </div>
      )}
      <People title="Sponsors" conn={s.sponsors} />
      <People title="Sponsoring" conn={s.sponsoring} />
    </div>
  );
}

// the heart button for a repository's FUNDING.yml
export function FundingButton({ owner, name }: { owner: string; name: string }) {
  const q = useGql<any>('funding', 'query($o: String!, $n: String!) { repository(owner: $o, name: $n) { fundingLinks { platform url } } }', { o: owner, n: name });
  const links: { platform: string; url: string }[] = q.data?.repository?.fundingLinks ?? [];
  if (!links.length) return null;
  const label = (p: string) => p.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Dropdown align="right" className="btn" trigger={<><HeartIcon /> Sponsor</>}>
      {(close) => (
        <div className="menu" onClick={close}>
          {links.map((l) => (
            <a key={l.url} href={l.url} data-external>
              {label(l.platform)}
            </a>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
