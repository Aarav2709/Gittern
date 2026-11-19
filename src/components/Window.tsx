import { getCurrentWindow } from '@tauri-apps/api/window';
import { type ReactNode, useEffect, useState } from 'react';
import { isTauri } from '../lib/api';

// gittern draws its own title bar, so the window looks the same on every system
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    let stop: (() => void) | undefined;
    let gone = false;
    const sync = () => void win.isMaximized().then((m) => !gone && setMaximized(m), () => {});
    sync();
    void win.onResized(sync).then((un) => (gone ? un() : (stop = un)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  if (!isTauri) return null;
  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      <button onClick={() => void win.minimize()} title="Minimize" aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button onClick={() => void win.toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore' : 'Maximize'}>
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2" />
            <rect x="0.5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button className="close" onClick={() => void win.close()} title="Close" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

// for screens outside the workspace, like sign-in, which have no tab bar to drag
export function Framed({ children }: { children: ReactNode }) {
  return (
    <>
      {isTauri && (
        <div className="titlebar" data-tauri-drag-region>
          <WindowControls />
        </div>
      )}
      {children}
    </>
  );
}
