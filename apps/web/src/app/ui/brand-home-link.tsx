"use client";

import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function BrandHomeLink({ className, markClassName = "brand-symbol", strong = false, onHome }: {
  className?: string;
  markClassName?: string;
  strong?: boolean;
  onHome?: () => void;
}) {
  return <Link href="/" prefetch={false} className={`brand-home-link ${className ?? ""}`} aria-label="Deliberation AI — Ana sayfa"
    onClick={(event) => {
      if (!onHome || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onHome();
    }}>
    <BrandMark className={markClassName} />{strong ? <strong>Deliberation AI</strong> : <span>Deliberation AI</span>}
  </Link>;
}
