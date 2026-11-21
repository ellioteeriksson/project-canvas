/** Loupe mark: Lou's monocle eye, centred on a magenta tile and glancing up and right (the app icon at small sizes). */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <defs>
        <radialGradient id="lm-bg" cx="35%" cy="25%" r="90%"><stop offset="0" stopColor="#FF86BF" /><stop offset=".55" stopColor="#F0509A" /><stop offset="1" stopColor="#B92D70" /></radialGradient>
        <linearGradient id="lm-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFEAB4" /><stop offset=".45" stopColor="#E7AE55" /><stop offset="1" stopColor="#8F5E1C" /></linearGradient>
      </defs>
      <rect width="24" height="24" rx="6.5" fill="url(#lm-bg)" />
      <circle cx="12" cy="12" r="6.6" fill="#FBF3F7" />
      <circle cx="13.5" cy="11" r="3.3" fill="#1A0B12" />
      <circle cx="14.8" cy="9.8" r=".9" fill="#fff" />
      <circle cx="12" cy="12" r="6.6" fill="none" stroke="url(#lm-gold)" strokeWidth="1.5" />
    </svg>
  );
}
