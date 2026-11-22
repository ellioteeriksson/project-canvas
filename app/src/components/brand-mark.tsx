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

/** The Loupe wordmark in Unbounded, with Lou's round monocle as the o. The letters take the text color. */
export function Wordmark({ height = 20, className }: { height?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg role="img" aria-label="Loupe" viewBox="40 -790 3171 975" height={height} width={(height * 3171) / 975} className={className}>
      <defs><Coating id={`${id}w`} /></defs>
      <path d="M60 -770H245V0H60Z M1238 15Q1158 15 1102.0 -17.5Q1046 -50 1016.5 -110.0Q987 -170 987 -252V-570H1173V-279Q1173 -210 1206.0 -173.0Q1239 -136 1301 -136Q1347 -136 1379.0 -155.0Q1411 -174 1428.5 -210.0Q1446 -246 1446 -295L1504 -264Q1494 -174 1456.5 -111.5Q1419 -49 1362.5 -17.0Q1306 15 1238 15ZM1482 0 1446 -222V-570H1632V-194L1668 0Z M1743 -570H1928V-398L1921 -374V-226L1928 -182V165H1743ZM1867 -285Q1882 -377 1924.0 -444.0Q1966 -511 2030.5 -548.5Q2095 -586 2174 -586Q2258 -586 2321.5 -548.0Q2385 -510 2421.0 -442.5Q2457 -375 2457 -285Q2457 -195 2421.0 -127.5Q2385 -60 2321.5 -22.0Q2258 16 2174 16Q2094 16 2030.5 -21.5Q1967 -59 1925.0 -126.5Q1883 -194 1867 -285ZM2269 -285Q2269 -331 2250.0 -366.5Q2231 -402 2197.5 -422.5Q2164 -443 2121 -443Q2077 -443 2037.0 -422.5Q1997 -402 1967.5 -366.5Q1938 -331 1922 -285Q1938 -239 1967.5 -203.5Q1997 -168 2037.0 -147.5Q2077 -127 2121 -127Q2164 -127 2197.5 -147.5Q2231 -168 2250.0 -203.5Q2269 -239 2269 -285Z M2860 16Q2758 16 2677.5 -22.0Q2597 -60 2551.0 -128.0Q2505 -196 2505 -287Q2505 -376 2549.0 -443.0Q2593 -510 2670.5 -548.0Q2748 -586 2846 -586Q2946 -586 3018.0 -542.0Q3090 -498 3129.0 -418.0Q3168 -338 3168 -230H2654V-347H3066L2999 -305Q2996 -352 2976.5 -384.5Q2957 -417 2925.0 -434.5Q2893 -452 2849 -452Q2801 -452 2766.0 -433.0Q2731 -414 2711.5 -380.0Q2692 -346 2692 -301Q2692 -244 2717.5 -204.0Q2743 -164 2791.5 -143.0Q2840 -122 2910 -122Q2974 -122 3038.0 -139.5Q3102 -157 3153 -189V-68Q3095 -28 3020.5 -6.0Q2946 16 2860 16Z" fill="currentColor" />
      <path d="M388 -285 a232 232 0 1 0 464 0 a232 232 0 1 0 -464 0 Z" fill="#F3F0FF" />
      <circle cx="665.2" cy="-321.2" r={127} fill="#120A26" />
      <circle cx="713.5" cy="-369.5" r={34} fill="#fff" />
      <path d="M319 -285 a301 301 0 1 0 602 0 a301 301 0 1 0 -602 0 Z M394 -285 a226 226 0 1 1 452 0 a226 226 0 1 1 -452 0 Z" fill={`url(#${id}w)`} fillRule="evenodd" />
    </svg>
  );
}
