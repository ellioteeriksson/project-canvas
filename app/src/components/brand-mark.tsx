/** Project Canvas mark: a page tree on a dark tile (blue = what you select, orange = Claude). */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect width="24" height="24" rx="6.5" fill="var(--brand-tile)" />
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" fill="none" stroke="#fff" strokeOpacity=".12" />
      <path d="M12 9.2v2.6M7 14.2v-1.6h10v1.6" stroke="#8e8e93" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <rect x="8.5" y="4.5" width="7" height="4.8" rx="1.4" fill="#0a84ff" />
      <rect x="4.2" y="14.2" width="5.6" height="4.6" rx="1.3" fill="#f5f5f7" />
      <rect x="14.2" y="14.2" width="5.6" height="4.6" rx="1.3" fill="#d97757" />
    </svg>
  );
}
