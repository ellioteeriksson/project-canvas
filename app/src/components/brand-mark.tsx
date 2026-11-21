import { useId } from "react";

/** The lens coating: teal, violet and amber, like the rim of a coated lens catching the light. */
export const COATING = ["#46E0C6", "#8A6BFF", "#FFB36B"] as const;

function Coating({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={COATING[0]} /><stop offset=".5" stopColor={COATING[1]} /><stop offset="1" stopColor={COATING[2]} />
    </linearGradient>
  );
}

/** Loupe mark: Lou's monocle eye on an ink tile, glancing up and right (the app icon at small sizes). */
export function BrandMark({ size = 22 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <defs>
        <radialGradient id={`${id}bg`} cx="34%" cy="22%" r="95%"><stop offset="0" stopColor="#2A2438" /><stop offset=".6" stopColor="#17131F" /><stop offset="1" stopColor="#0B0910" /></radialGradient>
        <Coating id={`${id}r`} />
      </defs>
      <rect width="24" height="24" rx="6.5" fill={`url(#${id}bg)`} />
      <rect x=".5" y=".5" width="23" height="23" rx="6" fill="none" stroke="#fff" strokeOpacity=".1" />
      <circle cx="12" cy="12" r="6.4" fill="#F3F0FF" />
      <circle cx="13.3" cy="11" r="3.1" fill="#120A26" />
      <circle cx="14.5" cy="9.8" r=".85" fill="#fff" />
      <circle cx="12" cy="12" r="6.4" fill="none" stroke={`url(#${id}r)`} strokeWidth="1.7" />
    </svg>
  );
}

/** The Loupe wordmark in Unbounded, with Lou's monocle as the o. The letters take the text color. */
export function Wordmark({ height = 20, className }: { height?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg role="img" aria-label="Loupe" viewBox="40 -790 3290 975" height={height} width={(height * 3290) / 975} className={className}>
      <defs><Coating id={`${id}w`} /></defs>
      <path d="M60 -770H245V0H60Z M1357 15Q1277 15 1221.0 -17.5Q1165 -50 1135.5 -110.0Q1106 -170 1106 -252V-570H1292V-279Q1292 -210 1325.0 -173.0Q1358 -136 1420 -136Q1466 -136 1498.0 -155.0Q1530 -174 1547.5 -210.0Q1565 -246 1565 -295L1623 -264Q1613 -174 1575.5 -111.5Q1538 -49 1481.5 -17.0Q1425 15 1357 15ZM1601 0 1565 -222V-570H1751V-194L1787 0Z M1862 -570H2047V-398L2040 -374V-226L2047 -182V165H1862ZM1986 -285Q2001 -377 2043.0 -444.0Q2085 -511 2149.5 -548.5Q2214 -586 2293 -586Q2377 -586 2440.5 -548.0Q2504 -510 2540.0 -442.5Q2576 -375 2576 -285Q2576 -195 2540.0 -127.5Q2504 -60 2440.5 -22.0Q2377 16 2293 16Q2213 16 2149.5 -21.5Q2086 -59 2044.0 -126.5Q2002 -194 1986 -285ZM2388 -285Q2388 -331 2369.0 -366.5Q2350 -402 2316.5 -422.5Q2283 -443 2240 -443Q2196 -443 2156.0 -422.5Q2116 -402 2086.5 -366.5Q2057 -331 2041 -285Q2057 -239 2086.5 -203.5Q2116 -168 2156.0 -147.5Q2196 -127 2240 -127Q2283 -127 2316.5 -147.5Q2350 -168 2369.0 -203.5Q2388 -239 2388 -285Z M2979 16Q2877 16 2796.5 -22.0Q2716 -60 2670.0 -128.0Q2624 -196 2624 -287Q2624 -376 2668.0 -443.0Q2712 -510 2789.5 -548.0Q2867 -586 2965 -586Q3065 -586 3137.0 -542.0Q3209 -498 3248.0 -418.0Q3287 -338 3287 -230H2773V-347H3185L3118 -305Q3115 -352 3095.5 -384.5Q3076 -417 3044.0 -434.5Q3012 -452 2968 -452Q2920 -452 2885.0 -433.0Q2850 -414 2830.5 -380.0Q2811 -346 2811 -301Q2811 -244 2836.5 -204.0Q2862 -164 2910.5 -143.0Q2959 -122 3029 -122Q3093 -122 3157.0 -139.5Q3221 -157 3272 -189V-68Q3214 -28 3139.5 -6.0Q3065 16 2979 16Z" fill="currentColor" />
      <path d="M500.5 -285 a179 167 0 1 0 358 0 a179 167 0 1 0 -358 0 Z" fill="#F3F0FF" />
      <circle cx="723.5" cy="-315" r={112} fill="#120A26" />
      <circle cx="763.5" cy="-357" r={30} fill="#fff" />
      <path d="M319.0 -285 a360.5 301 0 1 0 721.0 0 a360.5 301 0 1 0 -721.0 0 Z M506.5 -285 a173 161 0 1 1 346 0 a173 161 0 1 1 -346 0 Z" fill={`url(#${id}w)`} fillRule="evenodd" />
    </svg>
  );
}
