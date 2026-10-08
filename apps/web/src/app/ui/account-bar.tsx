"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function AccountBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const update = () => document.documentElement.style.setProperty("--account-bar-height", `${element.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--account-bar-height"); };
  }, []);
  return <header ref={bar} className="account-bar" aria-label="Hesap">{children}</header>;
}
