import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The same visual boundary as App, without a box or stacking context. */
export const APP_SHELL_LAYOUT = 'islands';

export function ShellStyleScope({ children }: { readonly children: ReactNode }) {
  return (
    <div className="app-shell ui-shell-style-scope" data-shell-layout={APP_SHELL_LAYOUT}>
      {children}
    </div>
  );
}

/** Portals retain the live theme, radius and Islands cascade without copying tokens. */
export function createShellPortal(children: ReactNode, container: Element) {
  return createPortal(<ShellStyleScope>{children}</ShellStyleScope>, container);
}
