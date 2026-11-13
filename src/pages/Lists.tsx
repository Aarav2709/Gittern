import { CheckIcon, PlusIcon, TriangleDownIcon } from '@primer/octicons-react';
import { type ReactNode, useState } from 'react';
import { Dropdown, ListState, RepoRow } from '../components/ui';
import { gql, invalidate, invalidateGql, useGql } from '../lib/api';
import { confirmDialog, promptDialog, useAction } from '../lib/feedback';

const VIEWER_LISTS = `
query {
  viewer { lists(first: 50) { nodes { id name description isPrivate items(first: 100) { totalCount nodes { ... on Repository { id } } } } } }
}`;

const USER_LISTS = `
query($login: String!) {
  user(login: $login) {
    lists(first: 50) {
      nodes {
        id name description isPrivate
        items(first: 100) {
          totalCount
          nodes { ... on Repository { id name full_name: nameWithOwner description stargazers_count: stargazerCount pushed_at: pushedAt isPrivate owner { login } primaryLanguage { name } } }
        }
      }
    }
  }
}`;

async function createList(): Promise<string | null> {
  const name = await promptDialog({ title: 'New list', label: 'Name', confirmLabel: 'Create list' });
  if (!name) return null;
  const out = await gql<any>('mutation($n: String!) { createUserList(input: { name: $n, isPrivate: false }) { list { id } } }', { n: name });
  await Promise.all([invalidateGql('viewer-lists'), invalidateGql('user-lists')]);
  return out.createUserList.list.id;
}

// the caret beside star: which of your lists hold this repository
export function ListMenu({ repoId, fullName }: { repoId: string; fullName: string }) {
  const q = useGql<any>('viewer-lists', VIEWER_LISTS, {});
  const { busy, run } = useAction();
  const lists: any[] = q.data?.viewer?.lists?.nodes ?? [];
  const inList = new Set(lists.filter((l) => l.items.nodes.some((n: any) => n?.id === repoId)).map((l) => l.id));
  const save = (ids: string[]) =>
    run(async () => {
      await gql('mutation($i: ID!, $l: [ID!]!) { updateUserListsForItem(input: { itemId: $i, listIds: $l }) { clientMutationId } }', { i: repoId, l: ids });
      // adding to a list also stars
      await Promise.all([invalidateGql('viewer-lists'), invalidateGql('user-lists'), invalidate(`/user/starred/${fullName}`)]);
    });
  return (
    <Dropdown align="right" className="btn split-tail" title="Add to list" trigger={<TriangleDownIcon />}>
      {() => (
        <div className="menu wide">
          <span className="menu-note">Lists</span>
          {q.isLoading && <span className="menu-note">Loading…</span>}
          {q.error && <span className="menu-note">{q.error.message}</span>}
          {lists.map((l) => (
            <button key={l.id} disabled={busy} onClick={() => save(inList.has(l.id) ? [...inList].filter((x) => x !== l.id) : [...inList, l.id])}>
              <span className="check">{inList.has(l.id) && <CheckIcon size={14} />}</span>
              <span className="menu-label">{l.name}</span>
              <span className="muted small">{l.items.totalCount}</span>
            </button>
          ))}
          <hr />
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const id = await createList();
                if (id) await save([...inList, id]);
              })
            }
          >
            <PlusIcon /> Create list
          </button>
        </div>
      )}
    </Dropdown>
  );
}

// a person's star lists, shown above their stars
export function StarLists({ login, own, children }: { login: string; own: boolean; children: ReactNode }) {
  const q = useGql<any>('user-lists', USER_LISTS, { login });
  const [open, setOpen] = useState<string | null>(null);
  const { busy, run } = useAction();
  const lists: any[] = q.data?.user?.lists?.nodes ?? [];
  const current = lists.find((l) => l.id === open);
  if (!lists.length && !own) return <>{children}</>;
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="segmented">
          <button className={!current ? 'on' : ''} onClick={() => setOpen(null)}>
            All stars
          </button>
          {lists.map((l) => (
            <button key={l.id} className={current?.id === l.id ? 'on' : ''} onClick={() => setOpen(l.id)}>
              {l.name} <span className="count">{l.items.totalCount}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        {own && current && (
          <>
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                const name = await promptDialog({ title: 'Rename list', label: 'Name', initial: current.name, confirmLabel: 'Save' });
                if (name) await run(async () => (await gql('mutation($l: ID!, $n: String!) { updateUserList(input: { listId: $l, name: $n }) { clientMutationId } }', { l: current.id, n: name }), await invalidateGql('user-lists')));
              }}
            >
              Rename
            </button>
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                if (!(await confirmDialog({ title: `Delete the ${current.name} list?`, body: 'The repositories stay starred.', confirmLabel: 'Delete list', danger: true }))) return;
                await run(async () => (await gql('mutation($l: ID!) { deleteUserList(input: { listId: $l }) { clientMutationId } }', { l: current.id }), await invalidateGql('user-lists'), setOpen(null)));
              }}
            >
              Delete
            </button>
          </>
        )}
        {own && (
          <button className="btn sm" disabled={busy} onClick={() => run(createList)}>
            <PlusIcon /> New list
          </button>
        )}
      </div>
      {current && (
        <>
          {current.description && <p className="muted">{current.description}</p>}
          <div className="card">
            <ListState q={q} count={current.items.nodes.length} empty="This list is empty" />
            {current.items.nodes
              .filter((r: any) => r?.full_name)
              .map((r: any) => (
                <RepoRow key={r.id} showOwner repo={{ ...r, private: r.isPrivate, language: r.primaryLanguage?.name ?? null }} />
              ))}
          </div>
        </>
      )}
      {!current && children}
    </div>
  );
}

