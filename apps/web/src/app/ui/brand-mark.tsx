import Image from "next/image";

/** Decorative mark: the adjacent product name supplies the accessible label. */
export function BrandMark({ className = "brand-symbol" }: { className?: string }) {
  return <Image className={`${className} deliberation-mark`} src="/brand/deliberation-mark.svg" width={96} height={96} alt="" aria-hidden="true" unoptimized />;
}
