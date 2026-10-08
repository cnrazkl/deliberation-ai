import Link from "next/link";

export function HelpLink() {
  return <Link prefetch={false} className="help-link" href="/help" target="_blank" rel="noopener noreferrer" aria-label="Yardım (yeni sekmede açılır)"><span aria-hidden="true">?</span> Yardım <small aria-hidden="true">↗</small></Link>;
}
