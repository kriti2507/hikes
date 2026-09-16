"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ReactNode } from "react";

// Cosmetic gating. lib/auth.ts's requireAdmin is the security boundary; this
// exists so a visitor understands why a checkbox will not tick, rather than
// finding a dead control and assuming the page is broken.

type Admin = {
  isAdmin: boolean;
  show: (x: number, y: number) => void;
  hide: () => void;
};

const AdminContext = createContext<Admin>({
  isAdmin: false,
  show: () => {},
  hide: () => {},
});

export function useAdmin() {
  return useContext(AdminContext);
}

export function AdminProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const tooltip = useRef<HTMLDivElement>(null);

  // Written straight to the DOM rather than held in React state. The table is
  // 100 rows by however many people, so a provider that re-rendered on every
  // pointer move would re-render all of it; this way the provider renders once
  // and never again.
  const show = useCallback((x: number, y: number) => {
    const node = tooltip.current;
    if (!node) return;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.display = "block";
  }, []);

  const hide = useCallback(() => {
    const node = tooltip.current;
    if (node) node.style.display = "none";
  }, []);

  const value = useMemo(() => ({ isAdmin, show, hide }), [isAdmin, show, hide]);

  return (
    <AdminContext.Provider value={value}>
      {/* Locked controls are `inert`, so they are absent from the accessibility
          tree rather than merely disabled -- a screen reader would otherwise
          find no edit controls and no reason for their absence. Said once here
          rather than on each Locked: the table wraps one per person per peak,
          and a few hundred identical announcements would be worse than the
          silence. */}
      {isAdmin ? null : (
        <p className="visually-hidden">
          You are viewing this checklist as a visitor. Editing controls are shown but inactive; log
          in at /login to make changes.
        </p>
      )}
      {children}
      {/* One node for the whole page, and only on a page that has something to
          point it at: Locked renders no wrapper at all for an admin, so nothing
          would ever call show(). aria-hidden because `inert` has already taken
          the control it describes out of the accessibility tree, so there is
          nothing left there for this to annotate. */}
      {isAdmin ? null : (
        <div ref={tooltip} className="admin-tooltip" aria-hidden="true">
          Only admin can make changes
        </div>
      )}
    </AdminContext.Provider>
  );
}

// Wraps one edit affordance. The admin gets the children untouched.
export function Locked({ children, className }: { children: ReactNode; className?: string }) {
  const { isAdmin, show, hide } = useAdmin();
  if (isAdmin) return <>{children}</>;

  return (
    // A div, not a span: one call site wraps a <form>, which is flow content
    // and cannot legally sit inside a span. Every place this lands -- a <td>,
    // an <li> -- takes a div, and `display: inline-block` gets the inline
    // behaviour back where it is wanted.
    <div
      className={className ? `admin-locked ${className}` : "admin-locked"}
      onPointerEnter={(event) => show(event.clientX, event.clientY)}
      onPointerMove={(event) => show(event.clientX, event.clientY)}
      onPointerLeave={hide}
      onPointerCancel={hide}
    >
      {/* pointer-events: none on the content hands hover to the wrapper: a
          disabled form control swallows pointer events in Chrome and WebKit, so
          `disabled` alone would leave nothing to hover and no way to say why.
          `inert` takes the content out of the tab order and the accessibility
          tree -- React 19 accepts it as a boolean prop. */}
      <div className="admin-locked-content" inert>
        {children}
      </div>
    </div>
  );
}
