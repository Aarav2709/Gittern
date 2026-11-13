import { GearIcon, KebabHorizontalIcon, PlusIcon, TableIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MarkdownEditor } from '../components/Editor';
import { Avatar, Dropdown, Empty, ErrorBox, Field, ListState, Loading, LoadMore, Modal, Segmented, Time } from '../components/ui';
import { gh, gql, invalidateGql, useGqlPages } from '../lib/api';
import { confirmDialog, promptDialog, toastError, useAction } from '../lib/feedback';
import { usePref } from '../lib/store';
import type { Issue } from '../lib/types';
import { plural } from '../lib/util';
import { parseIssueRef } from './IssueSide';

const FIELD_VALUE = `field { ... on ProjectV2FieldCommon { id } }`;

const PROJECT_QUERY = `
query($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        id title shortDescription readme closed public url number viewerCanUpdate
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name color } }
            ... on ProjectV2IterationField { configuration { iterations { id title startDate } } }
          }
        }
        items(first: 50, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id isArchived type
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldTextValue { text ${FIELD_VALUE} }
                ... on ProjectV2ItemFieldNumberValue { number ${FIELD_VALUE} }
                ... on ProjectV2ItemFieldDateValue { date ${FIELD_VALUE} }
                ... on ProjectV2ItemFieldSingleSelectValue { name optionId ${FIELD_VALUE} }
                ... on ProjectV2ItemFieldIterationValue { title iterationId ${FIELD_VALUE} }
              }
            }
            content {
              __typename
              ... on Issue { id number title state url repository { nameWithOwner } assignees(first: 3) { nodes { login avatarUrl } } }
              ... on PullRequest { id number title state url repository { nameWithOwner } assignees(first: 3) { nodes { login avatarUrl } } }
              ... on DraftIssue { id title body }
            }
          }
        }
      }
    }
  }
}`;

interface PField {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string; color: string }[];
  configuration?: { iterations: { id: string; title: string; startDate: string }[] };
}

// the editable kinds; the rest are built in and read-only here
const EDITABLE = ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'ITERATION'];

function valueOf(item: any, field: PField): { label: string; raw: string } | null {
  const v = item.fieldValues.nodes.find((n: any) => n?.field?.id === field.id);
  if (!v) return null;
  if ('text' in v) return { label: v.text, raw: v.text };
  if ('number' in v) return { label: String(v.number), raw: String(v.number) };
  if ('date' in v) return { label: new Date(v.date).toLocaleDateString(), raw: v.date };
  if ('optionId' in v) return { label: v.name, raw: v.optionId };
  if ('iterationId' in v) return { label: v.title, raw: v.iterationId };
  return null;
}

const itemTitle = (it: any) => it.content?.title ?? 'Private item';
const itemRoute = (c: any) => (c?.number ? `/${c.repository.nameWithOwner}/${c.__typename === 'PullRequest' ? 'pull' : 'issues'}/${c.number}` : null);

function useProjectApi(projectId: string) {
  const { busy, run } = useAction();
  const refresh = () => Promise.all([invalidateGql('project'), invalidateGql('projects'), invalidateGql('item-projects')]);
  const mutate = (query: string, vars: Record<string, unknown>, done?: string) => run(async () => (await gql(query, vars), await refresh()), done);
  const setValue = (itemId: string, field: PField, raw: string) => {
    if (!raw) return mutate('mutation($p: ID!, $i: ID!, $f: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { clientMutationId } }', { p: projectId, i: itemId, f: field.id });
    const value =
      field.dataType === 'NUMBER' ? { number: Number(raw) } : field.dataType === 'DATE' ? { date: raw } : field.dataType === 'SINGLE_SELECT' ? { singleSelectOptionId: raw } : field.dataType === 'ITERATION' ? { iterationId: raw } : { text: raw };
    return mutate('mutation($p: ID!, $i: ID!, $f: ID!, $v: ProjectV2FieldValue!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: $v }) { clientMutationId } }', { p: projectId, i: itemId, f: field.id, v: value });
  };
  return { busy, run, mutate, setValue, refresh };
}

type Api = ReturnType<typeof useProjectApi>;

// input for one field value
function FieldInput({ field, value, onSave, disabled }: { field: PField; value: string; onSave: (raw: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  if (field.dataType === 'SINGLE_SELECT' || field.dataType === 'ITERATION') {
    const opts = field.dataType === 'SINGLE_SELECT' ? (field.options ?? []).map((o) => ({ id: o.id, name: o.name })) : (field.configuration?.iterations ?? []).map((i) => ({ id: i.id, name: i.title }));
    return (
      <select className="input" value={value} disabled={disabled} onChange={(e) => onSave(e.target.value)}>
        <option value="">None</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="input"
      type={field.dataType === 'NUMBER' ? 'number' : field.dataType === 'DATE' ? 'date' : 'text'}
      value={field.dataType === 'DATE' ? draft.slice(0, 10) : draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ItemDialog({ item, fields, project, api, onClose }: { item: any; fields: PField[]; project: any; api: Api; onClose: () => void }) {
  const c = item.content;
  const draft = c?.__typename === 'DraftIssue';
  const [title, setTitle] = useState(c?.title ?? '');
  const [body, setBody] = useState(c?.body ?? '');
  const to = itemRoute(c);
  const editable = fields.filter((f) => EDITABLE.includes(f.dataType));
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Remove this item from the project?', body: draft ? 'The draft is deleted.' : 'The issue or pull request itself is kept.', confirmLabel: 'Remove', danger: true }))) return;
    await api.mutate('mutation($p: ID!, $i: ID!) { deleteProjectV2Item(input: { projectId: $p, itemId: $i }) { deletedItemId } }', { p: project.id, i: item.id }, 'Item removed');
    onClose();
  };
  const convert = async () => {
    const full = await promptDialog({ title: 'Convert to issue', label: 'Repository (owner/name)', confirmLabel: 'Convert' });
    if (!full) return;
    await api.run(async () => {
      const repo = await gh<{ node_id: string }>(`/repos/${full}`);
      await gql('mutation($i: ID!, $r: ID!) { convertProjectV2DraftIssueItemToIssue(input: { itemId: $i, repositoryId: $r }) { item { id } } }', { i: item.id, r: repo.node_id });
      await api.refresh();
    }, 'Converted to an issue');
    onClose();
  };
  return (
    <Modal title={draft ? 'Draft item' : itemTitle(item)} onClose={onClose} wide>
      <div className="dialog-body">
        {draft && project.viewerCanUpdate ? (
          <>
            <Field label="Title">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <MarkdownEditor value={body} onChange={setBody} context="" rows={5} placeholder="Add a description" />
            <div className="form-foot">
              <span className="spacer" />
              <button
                className="btn primary"
                disabled={api.busy || !title.trim()}
                onClick={() => api.mutate('mutation($d: ID!, $t: String!, $b: String!) { updateProjectV2DraftIssue(input: { draftIssueId: $d, title: $t, body: $b }) { clientMutationId } }', { d: c.id, t: title, b: body }, 'Saved')}
              >
                Save draft
              </button>
            </div>
          </>
        ) : (
          to && (
            <p>
              <Link to={to} onClick={onClose}>
                {c.repository.nameWithOwner}#{c.number}
              </Link>{' '}
              <span className="muted">· {c.state.toLowerCase()}</span>
            </p>
          )
        )}
        <div className="project-fields">
          {editable.map((f) => (
            <Field key={f.id} label={f.name}>
              <FieldInput field={f} value={valueOf(item, f)?.raw ?? ''} disabled={!project.viewerCanUpdate || api.busy} onSave={(raw) => api.setValue(item.id, f, raw)} />
            </Field>
          ))}
        </div>
        {project.viewerCanUpdate && (
          <div className="form-foot">
            {draft && (
              <button className="btn" disabled={api.busy} onClick={convert}>
                Convert to issue
              </button>
            )}
            <button
              className="btn"
              disabled={api.busy}
              onClick={() =>
                api
                  .mutate(
                    `mutation($p: ID!, $i: ID!) { ${item.isArchived ? 'unarchiveProjectV2Item' : 'archiveProjectV2Item'}(input: { projectId: $p, itemId: $i }) { clientMutationId } }`,
                    { p: project.id, i: item.id },
                    item.isArchived ? 'Restored' : 'Archived',
                  )
                  .then(onClose)
              }
            >
              {item.isArchived ? 'Restore' : 'Archive'}
            </button>
            <span className="spacer" />
            <button className="btn danger" disabled={api.busy} onClick={remove}>
              Remove from project
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// adds a draft or an existing issue, optionally straight into a column
async function addItem(project: any, api: Api, group?: { field: PField; optionId: string }) {
  const kind = await promptDialog({
    title: 'Add an item',
    label: 'What to add',
    options: [
      { value: 'draft', label: 'A draft' },
      { value: 'issue', label: 'An existing issue or pull request' },
    ],
    confirmLabel: 'Next',
  });
  if (!kind) return;
  const text = await promptDialog(kind === 'draft' ? { title: 'New draft', label: 'Title', confirmLabel: 'Add' } : { title: 'Add an issue or pull request', label: 'owner/repo#number or a link', confirmLabel: 'Add' });
  if (!text) return;
  await api.run(async () => {
    let itemId: string;
    if (kind === 'draft') {
      const out = await gql<any>('mutation($p: ID!, $t: String!) { addProjectV2DraftIssue(input: { projectId: $p, title: $t }) { projectItem { id } } }', { p: project.id, t: text });
      itemId = out.addProjectV2DraftIssue.projectItem.id;
    } else {
      const ref = parseIssueRef(text, '');
      if (!ref?.repo) throw new Error('Use owner/repo#number or a link');
      const issue = await gh<Issue>(`/repos/${ref.repo}/issues/${ref.number}`);
      const out = await gql<any>('mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', { p: project.id, c: issue.node_id });
      itemId = out.addProjectV2ItemById.item.id;
    }
    if (group?.optionId)
      await gql('mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { clientMutationId } }', {
        p: project.id,
        i: itemId,
        f: group.field.id,
        o: group.optionId,
      });
    await api.refresh();
  }, 'Item added');
}

const OPTION_COLORS = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];

function FieldsMenu({ project, fields, api }: { project: any; fields: PField[]; api: Api }) {
  const create = async () => {
    const name = await promptDialog({ title: 'New field', label: 'Name', confirmLabel: 'Next' });
    if (!name) return;
    const type = await promptDialog({
      title: `Type of ${name}`,
      label: 'Type',
      options: [
        { value: 'TEXT', label: 'Text' },
        { value: 'NUMBER', label: 'Number' },
        { value: 'DATE', label: 'Date' },
        { value: 'SINGLE_SELECT', label: 'Single select' },
      ],
      confirmLabel: 'Next',
    });
    if (!type) return;
    let options: { name: string; color: string; description: string }[] | undefined;
    if (type === 'SINGLE_SELECT') {
      const list = await promptDialog({ title: `Options for ${name}`, label: 'Options, comma separated', confirmLabel: 'Create field' });
      if (!list) return;
      options = list.split(',').map((o, i) => ({ name: o.trim(), color: OPTION_COLORS[i % OPTION_COLORS.length], description: '' })).filter((o) => o.name);
    }
    await api.mutate(
      'mutation($p: ID!, $t: ProjectV2CustomFieldType!, $n: String!, $o: [ProjectV2SingleSelectFieldOptionInput!]) { createProjectV2Field(input: { projectId: $p, dataType: $t, name: $n, singleSelectOptions: $o }) { clientMutationId } }',
      { p: project.id, t: type, n: name, o: options ?? null },
      `Added ${name}`,
    );
  };
  const editOptions = async (f: PField) => {
    const list = await promptDialog({ title: `Options for ${f.name}`, label: 'Options, comma separated', initial: (f.options ?? []).map((o) => o.name).join(', '), confirmLabel: 'Save options' });
    if (!list) return;
    const names = list.split(',').map((o) => o.trim()).filter(Boolean);
    const options = names.map((n, i) => {
      const old = f.options?.find((o) => o.name === n);
      return { ...(old ? { id: old.id } : {}), name: n, color: old?.color ?? OPTION_COLORS[i % OPTION_COLORS.length], description: '' };
    });
    await api.mutate('mutation($f: ID!, $o: [ProjectV2SingleSelectFieldOptionInput!]) { updateProjectV2Field(input: { fieldId: $f, singleSelectOptions: $o }) { clientMutationId } }', { f: f.id, o: options }, 'Options saved');
  };
  const rename = async (f: PField) => {
    const name = await promptDialog({ title: `Rename ${f.name}`, label: 'Name', initial: f.name, confirmLabel: 'Rename' });
    if (name && name !== f.name) await api.mutate('mutation($f: ID!, $n: String!) { updateProjectV2Field(input: { fieldId: $f, name: $n }) { clientMutationId } }', { f: f.id, n: name }, 'Renamed');
  };
  const remove = async (f: PField) => {
    if (await confirmDialog({ title: `Delete the ${f.name} field?`, body: 'Its values on every item are lost.', confirmLabel: 'Delete field', danger: true }))
      await api.mutate('mutation($f: ID!) { deleteProjectV2Field(input: { fieldId: $f }) { clientMutationId } }', { f: f.id }, 'Field deleted');
  };
  return (
    <Dropdown align="right" className="btn" title="Fields" trigger={<>Fields</>}>
      {(close) => (
        <div className="menu wide" onClick={close}>
          {fields
            .filter((f) => EDITABLE.includes(f.dataType))
            .map((f) => (
              <div key={f.id} className="menu-line">
                <button onClick={() => rename(f)}>
                  <span className="menu-label">{f.name}</span>
                  <span className="muted small">{f.dataType.toLowerCase().replace('_', ' ')}</span>
                </button>
                {f.dataType === 'SINGLE_SELECT' && (
                  <button className="icon-btn sm" title="Edit options" aria-label={`Edit options of ${f.name}`} onClick={() => editOptions(f)}>
                    <GearIcon size={12} />
                  </button>
                )}
                <button className="icon-btn sm" title="Delete field" aria-label={`Delete ${f.name}`} onClick={() => remove(f)}>
                  ×
                </button>
              </div>
            ))}
          <hr />
          <button onClick={create}>
            <PlusIcon /> New field
          </button>
        </div>
      )}
    </Dropdown>
  );
}

function ProjectSettings({ project, api, owner }: { project: any; api: Api; owner: string }) {
  const navigate = useNavigate();
  const update = (vars: Record<string, unknown>, done: string) =>
    api.mutate('mutation($p: ID!, $t: String, $d: String, $r: String, $c: Boolean, $pub: Boolean) { updateProjectV2(input: { projectId: $p, title: $t, shortDescription: $d, readme: $r, closed: $c, public: $pub }) { clientMutationId } }', { p: project.id, ...vars }, done);
  return (
    <Dropdown align="right" className="icon-btn" title="Project settings" trigger={<KebabHorizontalIcon />}>
      {(close) => (
        <div className="menu" onClick={close}>
          <button
            onClick={async () => {
              const t = await promptDialog({ title: 'Rename project', label: 'Title', initial: project.title, confirmLabel: 'Rename' });
              if (t) await update({ t }, 'Renamed');
            }}
          >
            Rename
          </button>
          <button
            onClick={async () => {
              const d = await promptDialog({ title: 'Short description', label: 'Description', initial: project.shortDescription ?? '', confirmLabel: 'Save' });
              if (d !== null) await update({ d }, 'Saved');
            }}
          >
            Edit description
          </button>
          <button
            onClick={async () => {
              const r = await promptDialog({ title: 'README', label: 'Markdown', initial: project.readme ?? '', multiline: true, confirmLabel: 'Save' });
              if (r !== null) await update({ r }, 'Saved');
            }}
          >
            Edit README
          </button>
          <button onClick={() => update({ pub: !project.public }, project.public ? 'Now private' : 'Now public')}>{project.public ? 'Make private' : 'Make public'}</button>
          <button onClick={() => update({ c: !project.closed }, project.closed ? 'Reopened' : 'Closed')}>{project.closed ? 'Reopen project' : 'Close project'}</button>
          <a href={project.url} data-external>
            Open on GitHub
          </a>
          <hr />
          <button
            onClick={async () => {
              if (!(await confirmDialog({ title: `Delete ${project.title}?`, body: 'Its items and fields are deleted. Issues and pull requests are kept.', confirmLabel: 'Delete project', danger: true, typeToConfirm: project.title }))) return;
              await api.mutate('mutation($p: ID!) { deleteProjectV2(input: { projectId: $p }) { clientMutationId } }', { p: project.id }, 'Project deleted');
              navigate(`/${owner}?tab=projects`);
            }}
          >
            Delete project
          </button>
        </div>
      )}
    </Dropdown>
  );
}

function Card({ item, fields, groupBy, onOpen }: { item: any; fields: PField[]; groupBy?: PField; onOpen: () => void }) {
  const c = item.content;
  const shown = fields.filter((f) => f.id !== groupBy?.id && EDITABLE.includes(f.dataType)).map((f) => [f, valueOf(item, f)] as const).filter(([, v]) => v);
  return (
    <div
      className="card board-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', item.id)}
      onClick={(e) => !(e.target as HTMLElement).closest('a') && onOpen()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      {itemRoute(c) ? <Link to={itemRoute(c)!}>{c.title}</Link> : <span>{itemTitle(item)}</span>}
      <div className="meta">
        {c?.number ? `${c.repository.nameWithOwner.split('/')[1]}#${c.number}` : 'Draft'}
        {shown.map(([f, v]) => (
          <span key={f.id} className="badge" title={f.name}>
            {v!.label}
          </span>
        ))}
        <span className="spacer" />
        {c?.assignees?.nodes.map((a: any) => <Avatar key={a.login} user={{ login: a.login, avatar_url: a.avatarUrl }} size={16} />)}
      </div>
    </div>
  );
}

export function ProjectBoard({ owner, number }: { owner: string; number: number }) {
  const q = useGqlPages<any>('project', PROJECT_QUERY, { owner, number }, (d) => d.repositoryOwner?.projectV2?.items);
  const project = q.first?.repositoryOwner?.projectV2;
  const api = useProjectApi(project?.id ?? '');
  const [view, setView] = usePref(`project-view:${owner}/${number}`, 'board');
  const [groupId, setGroupId] = usePref(`project-group:${owner}/${number}`, '');
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ScopeHint error={q.error} />;
  if (!project) return <Empty title="Project not found" />;
  const fields: PField[] = project.fields.nodes.filter((f: any) => f?.id);
  const selects = fields.filter((f) => f.dataType === 'SINGLE_SELECT' || f.dataType === 'ITERATION');
  const groupBy = selects.find((f) => f.id === groupId) ?? selects.find((f) => f.name === 'Status') ?? selects[0];
  const items = q.items.filter((it) => !!it.isArchived === showArchived && itemTitle(it).toLowerCase().includes(filter.toLowerCase()));
  const columns: { id: string; name: string }[] = groupBy
    ? [...(groupBy.dataType === 'SINGLE_SELECT' ? (groupBy.options ?? []).map((o) => ({ id: o.id, name: o.name })) : (groupBy.configuration?.iterations ?? []).map((i) => ({ id: i.id, name: i.title }))), { id: '', name: `No ${groupBy.name}` }]
    : [{ id: '', name: 'Items' }];
  const inColumn = (col: string) => items.filter((it) => (groupBy ? (valueOf(it, groupBy)?.raw ?? '') : '') === col);
  const openItem = q.items.find((it) => it.id === open);
  const editable = fields.filter((f) => EDITABLE.includes(f.dataType));
  const canEdit = project.viewerCanUpdate;

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2 className="title">
            {project.title} {project.closed && <span className="badge">Closed</span>}
          </h2>
          {project.shortDescription && <p className="muted">{project.shortDescription}</p>}
        </div>
        <span className="spacer" />
        {canEdit && <ProjectSettings project={project} api={api} owner={owner} />}
      </div>
      <div className="toolbar">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Board' },
            { value: 'table', label: 'Table' },
          ]}
        />
        <input className="input name-input" placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter items" />
        {view === 'board' && selects.length > 1 && (
          <select className="input select" value={groupBy?.id} onChange={(e) => setGroupId(e.target.value)} aria-label="Group by">
            {selects.map((f) => (
              <option key={f.id} value={f.id}>
                Group by {f.name}
              </option>
            ))}
          </select>
        )}
        <label className="check-row small">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
        </label>
        <span className="spacer" />
        {canEdit && <FieldsMenu project={project} fields={fields} api={api} />}
        {canEdit && (
          <button className="btn primary" disabled={api.busy} onClick={() => addItem(project, api)}>
            <PlusIcon /> Add item
          </button>
        )}
      </div>
      {view === 'board' ? (
        <div className="board">
          {columns.map((col) => (
            <section
              key={col.id}
              className="board-col"
              onDragOver={(e) => canEdit && groupBy && e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/plain');
                const it = q.items.find((x) => x.id === id);
                if (it && groupBy && (valueOf(it, groupBy)?.raw ?? '') !== col.id) void api.setValue(id, groupBy, col.id);
              }}
            >
              <h3>
                {col.name} <span className="count">{inColumn(col.id).length}</span>
                {canEdit && groupBy && col.id && (
                  <button className="icon-btn sm board-add" title={`Add to ${col.name}`} aria-label={`Add to ${col.name}`} onClick={() => addItem(project, api, { field: groupBy, optionId: col.id })}>
                    <PlusIcon size={12} />
                  </button>
                )}
              </h3>
              {inColumn(col.id).map((it) => (
                <Card key={it.id} item={it} fields={fields} groupBy={groupBy} onOpen={() => setOpen(it.id)} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="project-table">
            <thead>
              <tr>
                <th>Title</th>
                {editable.map((f) => (
                  <th key={f.id}>{f.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <button className="link-btn" onClick={() => setOpen(it.id)}>
                      {itemTitle(it)}
                    </button>
                  </td>
                  {editable.map((f) => (
                    <td key={f.id}>
                      {canEdit ? <FieldInput key={valueOf(it, f)?.raw ?? ''} field={f} value={valueOf(it, f)?.raw ?? ''} disabled={api.busy} onSave={(raw) => api.setValue(it.id, f, raw)} /> : (valueOf(it, f)?.label ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <p className="muted pad">No items.</p>}
        </div>
      )}
      <LoadMore q={q} />
      {openItem && <ItemDialog key={openItem.id} item={openItem} fields={fields} project={project} api={api} onClose={() => setOpen(null)} />}
    </div>
  );
}

// projects need a scope older tokens don't have
export function ScopeHint({ error }: { error: Error }) {
  if (!/project/.test(error.message)) return <ErrorBox error={error} />;
  return (
    <Empty title="Projects need one more permission">
      Your token lacks the project scope. Sign out and back in, or with the GitHub CLI run <code>gh auth refresh -s project</code> and restart Gittern.
    </Empty>
  );
}

const OWNER_PROJECTS = `
query($owner: String!, $after: String) {
  repositoryOwner(login: $owner) {
    id
    ... on ProjectV2Owner {
      projectsV2(first: 30, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { number title shortDescription closed updatedAt url items { totalCount } }
      }
    }
  }
}`;

const REPO_PROJECTS = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    id
    owner { id login }
    projectsV2(first: 30, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { id number title shortDescription closed updatedAt url items { totalCount } }
    }
  }
}`;

function ProjectRows({ q, to, onUnlink }: { q: any; to: (p: any) => string; onUnlink?: (p: any) => void }) {
  return (
    <>
      <div className="card">
        <ListState q={q} count={q.items.length} empty="No projects" />
        {q.items.map((p: any) => (
          <div key={p.number} className="row">
            <span className="state-icon">
              <TableIcon />
            </span>
            <div className="row-main">
              <div className="row-title">
                <Link to={to(p)}>{p.title}</Link>
                {p.closed && <span className="badge">Closed</span>}
              </div>
              {p.shortDescription && <p className="row-desc">{p.shortDescription}</p>}
              <div className="meta">
                #{p.number} · {plural(p.items.totalCount, 'item')} · updated <Time iso={p.updatedAt} />
              </div>
            </div>
            {onUnlink && (
              <button className="btn sm" onClick={() => onUnlink(p)}>
                Unlink
              </button>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </>
  );
}

async function createProject(ownerId: string, repositoryId?: string): Promise<number | null> {
  const title = await promptDialog({ title: 'New project', label: 'Title', confirmLabel: 'Create project' });
  if (!title) return null;
  try {
    const out = await gql<any>('mutation($o: ID!, $t: String!, $r: ID) { createProjectV2(input: { ownerId: $o, title: $t, repositoryId: $r }) { projectV2 { number } } }', { o: ownerId, t: title, r: repositoryId ?? null });
    await invalidateGql('projects');
    return out.createProjectV2.projectV2.number;
  } catch (e) {
    toastError(e);
    return null;
  }
}

// projects of a repository, with create and link
export function RepoProjects({ repo }: { repo: { full_name: string; name: string; owner: { login: string }; permissions?: { admin?: boolean; push?: boolean } } }) {
  const navigate = useNavigate();
  const q = useGqlPages<any>('projects', REPO_PROJECTS, { owner: repo.owner.login, name: repo.name }, (d) => d.repository?.projectsV2);
  const ids = q.first?.repository;
  const { busy, run } = useAction();
  if (q.error) return <ScopeHint error={q.error} />;
  const canEdit = !!repo.permissions?.push;
  const link = async () => {
    const text = await promptDialog({ title: 'Link a project', label: `Project number under ${repo.owner.login}`, confirmLabel: 'Link' });
    if (!text) return;
    await run(async () => {
      const d = await gql<any>('query($o: String!, $n: Int!) { repositoryOwner(login: $o) { ... on ProjectV2Owner { projectV2(number: $n) { id } } } }', { o: repo.owner.login, n: Number(text.replace('#', '')) });
      const id = d.repositoryOwner?.projectV2?.id;
      if (!id) throw new Error('No such project');
      await gql('mutation($p: ID!, $r: ID!) { linkProjectV2ToRepository(input: { projectId: $p, repositoryId: $r }) { clientMutationId } }', { p: id, r: ids.id });
      await invalidateGql('projects');
    }, 'Project linked');
  };
  const unlink = async (p: any) => {
    if (await confirmDialog({ title: `Unlink ${p.title}?`, body: 'The project itself is kept.', confirmLabel: 'Unlink' }))
      await run(async () => (await gql('mutation($p: ID!, $r: ID!) { unlinkProjectV2FromRepository(input: { projectId: $p, repositoryId: $r }) { clientMutationId } }', { p: p.id, r: ids.id }), await invalidateGql('projects')), 'Unlinked');
  };
  return (
    <div className="stack">
      {canEdit && ids && (
        <div className="toolbar">
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={link}>
            Link a project
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              const n = await createProject(ids.owner.id, ids.id);
              if (n) navigate(`/${repo.full_name}/projects/${n}`);
            }}
          >
            New project
          </button>
        </div>
      )}
      <ProjectRows q={q} to={(p) => `/${repo.full_name}/projects/${p.number}`} onUnlink={canEdit ? unlink : undefined} />
    </div>
  );
}

// projects owned by a user or organization
export function OwnerProjects({ owner, canCreate }: { owner: string; canCreate: boolean }) {
  const navigate = useNavigate();
  const q = useGqlPages<any>('projects', OWNER_PROJECTS, { owner }, (d) => d.repositoryOwner?.projectsV2);
  if (q.error) return <ScopeHint error={q.error} />;
  const ownerId = q.first?.repositoryOwner?.id;
  return (
    <div className="stack">
      {canCreate && ownerId && (
        <div className="toolbar">
          <span className="spacer" />
          <button
            className="btn primary"
            onClick={async () => {
              const n = await createProject(ownerId);
              if (n) navigate(`/project/${owner}/${n}`);
            }}
          >
            New project
          </button>
        </div>
      )}
      <ProjectRows q={q} to={(p) => `/project/${owner}/${p.number}`} />
    </div>
  );
}

export function OwnerProjectPage() {
  const { owner, number } = useParams();
  return (
    <div className="page">
      <ProjectBoard owner={owner!} number={Number(number)} />
    </div>
  );
}

