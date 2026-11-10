import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react';
import { useMemo, useState } from 'react';

interface Line {
  t: 'hunk' | 'add' | 'del' | 'ctx' | 'meta';
  o?: number;
  n?: number;
  text: string;
}

function parsePatch(patch: string): Line[] {
  let o = 0;
  let n = 0;
  return patch.split('\n').map((line): Line => {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (m) {
        o = +m[1];
        n = +m[2];
      }
      return { t: 'hunk', text: line };
    }
    if (line.startsWith('+')) return { t: 'add', n: n++, text: line.slice(1) };
    if (line.startsWith('-')) return { t: 'del', o: o++, text: line.slice(1) };
    if (line.startsWith('\\')) return { t: 'meta', text: line };
    return { t: 'ctx', o: o++, n: n++, text: line.slice(1) };
  });
}

const SIGN = { add: '+', del: '-', ctx: ' ', hunk: '', meta: '' };
const BIG = 1500;

/** One file of a commit or pull request, as returned by GitHub's `files` arrays. */
export function DiffFile({ file }: { file: any }) {
  const lines = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);
  const [open, setOpen] = useState(true);
  const [showBig, setShowBig] = useState(lines.length <= BIG);

  return (
    <div className="card diff-file">
      <div className="diff-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="diff-name">
          {file.previous_filename && <span className="muted">{file.previous_filename} → </span>}
          {file.filename}
        </span>
        {file.status !== 'modified' && <span className="badge">{file.status}</span>}
        <span className="spacer" />
        <span className="add-text">+{file.additions}</span>
        <span className="del-text">−{file.deletions}</span>
      </div>
      {open &&
        (!file.patch ? (
          <p className="muted pad small">
            {file.changes === 0 ? 'No content changes (renamed, mode change or binary).' : 'Binary file or diff too large to show.'}
          </p>
        ) : !showBig ? (
          <p className="pad">
            <button className="btn sm" onClick={() => setShowBig(true)}>
              Load large diff ({lines.length.toLocaleString()} lines)
            </button>
          </p>
        ) : (
          <div className="diff-scroll">
            <div className="diff-lines">
              {lines.map((l, i) => (
                <div key={i} className={`dl ${l.t}`}>
                  <span className="ln">{l.o ?? ''}</span>
                  <span className="ln">{l.n ?? ''}</span>
                  <span className="sign">{SIGN[l.t]}</span>
                  <span className="dl-text">{l.text || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
