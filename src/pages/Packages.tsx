import { PackageIcon, TrashIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ListState, Modal, Segmented, Time } from '../components/ui';
import { gh, invalidate, useGh } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, useAction } from '../lib/feedback';

const TYPES = ['container', 'npm', 'maven', 'rubygems', 'nuget'] as const;
type PackageType = (typeof TYPES)[number];

interface Pkg {
  id: number;
  name: string;
  package_type: PackageType;
  visibility: string;
  version_count?: number;
  updated_at: string;
  html_url: string;
  repository?: { full_name: string } | null;
}

interface Version {
  id: number;
  name: string;
  created_at: string;
  html_url?: string;
  metadata?: { container?: { tags: string[] } };
}

// packages published by a user or organization
export function Packages({ owner, isOrg, canManage }: { owner: string; isOrg: boolean; canManage: boolean }) {
  const { viewer } = useAuth();
  const [type, setType] = useState<PackageType>('container');
  const base = isOrg ? `/orgs/${owner}` : owner === viewer.login ? '/user' : `/users/${owner}`;
  const q = useGh<Pkg[]>(`${base}/packages?package_type=${type}&per_page=100`);
  const [open, setOpen] = useState<Pkg | null>(null);
  const denied = q.error && [401, 403].includes(q.error.status);
  return (
    <div className="stack">
      <Segmented value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: t === 'container' ? 'Containers' : t }))} />
      {denied ? (
        <Empty title="Packages need one more permission">Your token lacks the read:packages scope. Sign out and back in to grant it.</Empty>
      ) : (
        <div className="card">
          <ListState q={q} count={q.data?.length ?? 0} empty={`No ${type} packages`} />
          {q.data?.map((p) => (
            <div key={p.id} className="row">
              <span className="state-icon">
                <PackageIcon />
              </span>
              <div className="row-main">
                <div className="row-title">
                  <button className="link-btn row-link" onClick={() => setOpen(p)}>
                    {p.name}
                  </button>
                  <span className="badge">{p.visibility}</span>
                </div>
                <div className="meta">
                  {p.repository && <Link to={`/${p.repository.full_name}`}>{p.repository.full_name}</Link>}
                  {p.version_count != null && <span>{p.version_count} versions</span>}
                  <span>
                    updated <Time iso={p.updated_at} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <PackageDialog base={base} pkg={open} canManage={canManage} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PackageDialog({ base, pkg, canManage, onClose }: { base: string; pkg: Pkg; canManage: boolean; onClose: () => void }) {
  const api = `${base}/packages/${pkg.package_type}/${encodeURIComponent(pkg.name)}`;
  const versions = useGh<Version[]>(`${api}/versions?per_page=100`);
  const { busy, run } = useAction();
  const removeVersion = async (v: Version) => {
    if (await confirmDialog({ title: `Delete version ${v.name}?`, body: 'It can be restored for 30 days.', confirmLabel: 'Delete', danger: true }))
      await run(async () => (await gh(`${api}/versions/${v.id}`, { method: 'DELETE' }), await invalidate(`${api}/versions`)), 'Version deleted');
  };
  const removePackage = async () => {
    if (!(await confirmDialog({ title: `Delete ${pkg.name}?`, body: 'Every version is deleted. It can be restored for 30 days.', confirmLabel: 'Delete package', danger: true, typeToConfirm: pkg.name }))) return;
    await run(async () => (await gh(api, { method: 'DELETE' }), await invalidate(`${base}/packages`)), 'Package deleted');
    onClose();
  };
  return (
    <Modal title={pkg.name} onClose={onClose} wide>
      <div className="dialog-body">
        <div className="card">
          <ListState q={versions} count={versions.data?.length ?? 0} empty="No versions" />
          {versions.data?.map((v) => (
            <div key={v.id} className="row compact">
              <div className="row-main">
                <div className="row-title mono">{v.metadata?.container?.tags.length ? v.metadata.container.tags.join(', ') : v.name.slice(0, 40)}</div>
                <div className="meta">
                  published <Time iso={v.created_at} />
                </div>
              </div>
              {canManage && (
                <button className="icon-btn" title="Delete version" aria-label={`Delete ${v.name}`} disabled={busy} onClick={() => removeVersion(v)}>
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="form-foot">
          <a href={pkg.html_url} data-external>
            Open on GitHub
          </a>
          <span className="spacer" />
          {canManage && (
            <button className="btn danger" disabled={busy} onClick={removePackage}>
              Delete package
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
