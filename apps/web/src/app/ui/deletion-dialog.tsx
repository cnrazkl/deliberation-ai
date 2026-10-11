"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function DeletionDialog({ title, busy, onCancel, children }: {
  title: string; busy: boolean; onCancel: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    const { scrollX, scrollY } = window;
    document.body.style.overflow = "hidden";
    element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    return () => {
      element.close(); document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    };
  }, []);
  return <dialog ref={dialog} className="deletion-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <header className="deletion-dialog-header"><h2 id={titleId}>{title}</h2>
      <button type="button" className="secondary-button" disabled={busy} onClick={onCancel} aria-label="Silme penceresini kapat">×</button>
    </header>
    <div className="deletion-dialog-content">{children}</div>
  </dialog>;
}
