"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure: normal tab navigation, outside-click and Escape dismissal. */
export function AccountMenu({ name, username, role, children }: {
  name: string; username: string; role: string; children: ReactNode;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      const element = menu.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        element.open = false;
        element.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && !element.contains(event.target)) {
        element.open = false;
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  return <details ref={menu} className="account-menu">
    <summary aria-label="Hesap seçenekleri">
      <span className="account-avatar" aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase("tr-TR")}</span>
      <span className="account-menu-name">{name}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </summary>
    <div className="account-menu-panel">
      <div className="account-menu-identity"><strong>{name}</strong><small>@{username}</small><span className="account-role-badge">{role}</span></div>
      <div className="account-menu-controls" onClick={(event) => {
        if ((event.target as HTMLElement).closest("button") && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}>{children}</div>
    </div>
  </details>;
}
