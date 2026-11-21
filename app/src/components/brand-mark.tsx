/** Loupe mark: a lens over a page, with a selected block in blue and a Claude-orange handle. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect width="24" height="24" rx="6.5" fill="var(--brand-tile, #1d1d1f)" />
      <rect x="0.25" y="0.25" width="23.5" height="23.5" rx="6.3" fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth=".5" />
      <path d="M15.2 15.2l3.6 3.6" stroke="#d97757" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="10.6" cy="10.6" r="6.1" fill="#f5f5f7" fillOpacity=".08" stroke="#f5f5f7" strokeWidth="1.7" />
      <rect x="7.4" y="7.6" width="6.4" height="2.2" rx=".7" fill="#0a84ff" />
      <rect x="7.4" y="11" width="4.4" height="1.2" rx=".6" fill="#f5f5f7" fillOpacity=".55" />
      <rect x="7.4" y="13" width="5.4" height="1.2" rx=".6" fill="#f5f5f7" fillOpacity=".55" />
    </svg>
  );
}
