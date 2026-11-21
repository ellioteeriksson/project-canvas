import { useEffect, useRef } from "react";

/**
 * Lou, drawn and animated by hand: a matte violet sphere with pill eyes, a small mouth and floating
 * mitts. He moves like an old cartoon (anticipation, lean, drag, a short smear, a jelly landing),
 * and his hands trail behind him. Everything runs in one animation loop that writes SVG attributes
 * directly, so React doesn't re-render 60 times a second.
 */
export type LouMode = "idle" | "inspecting" | "happy" | "concerned";

const COLOR = { base: "#7B5CFF", light: "#A08BFF", dark: "#5536D6", mitt: "#8F74FF" };
const HIT = 64; // the clickable area around his body
const N = 14; // points on his outline

type V = { x: number; y: number };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

function outline(sp: number, dir: number, wob: number, ph: number) {
  const pts: [number, number][] = [];
  const dx = Math.cos(dir), dy = Math.sin(dir);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const a = Math.cos(th - dir); // 1 = leading side, -1 = trailing side
    let r = 30 * (1 - 0.07 * sp * Math.max(0, a)) * (1 + 0.18 * sp * Math.max(0, -a));
    r += Math.sin(3 * th + ph) * wob * 2.4 + Math.sin(2 * th - ph * 1.3) * wob * 1.2;
    const drag = sp * Math.max(0, -a) * 5; // the back of him lags behind
    pts.push([Math.cos(th) * r - dx * drag, Math.sin(th) * r - dy * drag]);
  }
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + "Z";
}

export function LouFigure({ to, mode, wave, label, onClick, expanded, children, bubbleRef, right, bottom }: {
  /** Where he should be, as an offset from his home in the corner */
  to: V;
  mode: LouMode;
  /** Bump this number to make him wave */
  wave: number;
  label: string;
  onClick: () => void;
  expanded: boolean;
  children?: React.ReactNode;
  /** A speech bubble that should travel with him */
  bubbleRef?: React.RefObject<HTMLElement | null>;
  right: number;
  bottom: number;
}) {
  const root = useRef<HTMLButtonElement>(null);
  const el = useRef<Record<string, SVGElement | null>>({});
  const live = useRef({ to, mode, wave });
  live.current = { to, mode, wave };
  const set = (k: string) => (n: SVGElement | null) => { el.current[k] = n; };

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const S = {
      pos: { ...live.current.to }, goal: { ...live.current.to }, move: null as null | { t: number; ant: number; dur: number; from: V; to: V; lift: number },
      sx: 1, sy: 1, vsx: 0, vsy: 0, lean: 0, vlean: 0, fx: 0, fy: 0, vfx: 0, vfy: 0, wob: 0, ph: 0, o: 0, dir: 0,
      look: { x: 0, y: 0 }, lookT: { x: 0, y: 0 }, nextLook: 0, blink: 1, nextBlink: 2, t: 0,
      wave: live.current.wave, waveUntil: 0, loupe: 0,
      hands: [{ x: -38, y: 8, vx: 0, vy: 0, r: 0 }, { x: 38, y: 8, vx: 0, vy: 0, r: 0 }],
      hist: [] as V[], mouse: null as V | null,
    };
    // hands live in screen space so they lag behind the body
    S.hands.forEach((h) => { h.x += S.pos.x; h.y += S.pos.y; });
    const onMove = (e: PointerEvent) => { S.mouse = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", onMove);
    let raf = 0, last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      S.t += dt;
      const L = live.current, E = el.current;
      if (L.wave !== S.wave) { S.wave = L.wave; S.waveUntil = S.t + 1.8; }

      // Start a trip when the goal changes
      if (Math.hypot(L.to.x - S.goal.x, L.to.y - S.goal.y) > 2) {
        S.goal = { ...L.to };
        const dist = Math.hypot(S.goal.x - S.pos.x, S.goal.y - S.pos.y);
        if (reduced) S.pos = { ...S.goal };
        else S.move = { t: 0, ant: 0.18, dur: Math.min(1.1, Math.max(0.55, dist / 900)), from: { ...S.pos }, to: { ...S.goal }, lift: Math.min(40, dist * 0.12) };
      }

      let tx = 1, ty = 1, tl = 0, sp = 0, air = 0;
      const prev = { ...S.pos };
      if (S.move) {
        const m = S.move;
        m.t += dt;
        S.dir = Math.atan2(m.to.y - m.from.y, m.to.x - m.from.x);
        const cx = Math.cos(S.dir);
        if (m.t < m.ant) { tx = 1.15; ty = 0.87; tl = 0.12 * Math.sign(cx); } // gathering himself
        else {
          const u = Math.min(1, (m.t - m.ant) / m.dur), e = ease(u);
          air = Math.sin(Math.PI * u);
          S.pos = { x: lerp(m.from.x, m.to.x, e), y: lerp(m.from.y, m.to.y, e) - air * m.lift };
          if (u >= 1) {
            S.move = null;
            S.pos = { ...m.to };
            S.vsy -= 2.6; S.vsx += 2.2; S.wob = 1.2; S.vlean += 3 * Math.sign(cx); S.vfx += 60 * Math.sign(cx);
            S.hands.forEach((h) => { h.vx += cx * 120; h.vy -= 50; });
          }
        }
      }
      const vx = (S.pos.x - prev.x) / dt, vy = (S.pos.y - prev.y) / dt;
      sp = reduced ? 0 : Math.min(1, Math.hypot(vx, vy) / 700);
      if (sp > 0.02) {
        const ax = Math.abs(Math.cos(S.dir)), ay = Math.abs(Math.sin(S.dir)), st = sp * 0.15;
        tx = 1 + st * ax - st * 0.5 * ay;
        ty = 1 + st * ay - st * 0.5 * ax;
        tl = -0.36 * sp * Math.cos(S.dir);
      }
      // springs: squash and stretch, lean, face lag
      S.vsx += (-(S.sx - tx) * 170 - S.vsx * 11) * dt; S.vsy += (-(S.sy - ty) * 170 - S.vsy * 11) * dt;
      S.sx += S.vsx * dt; S.sy += S.vsy * dt;
      S.vlean += (-(S.lean - tl) * 150 - S.vlean * 10) * dt; S.lean += S.vlean * dt;
      S.vfx += (-(S.fx + vx * 0.008) * 140 - S.vfx * 9) * dt; S.fx += S.vfx * dt;
      S.vfy += (-(S.fy + vy * 0.005) * 140 - S.vfy * 9) * dt; S.fy += S.vfy * dt;
      S.wob *= Math.pow(0.04, dt); S.ph += dt * 16;
      S.o = lerp(S.o, sp, 1 - Math.pow(0.004, dt));

      // where he looks
      const inspecting = L.mode === "inspecting" && !S.move;
      if (S.move) S.lookT = { x: Math.cos(S.dir), y: Math.sin(S.dir) * 0.6 };
      else if (inspecting) S.lookT = { x: 0.75, y: 0.7 }; // looking into the lens
      else if (S.t > S.nextLook) {
        const r = root.current?.getBoundingClientRect();
        const m = S.mouse;
        if (r && m && Math.hypot(m.x - (r.x + r.width / 2), m.y - (r.y + r.height / 2)) < 320 && Math.random() < 0.7) {
          const ddx = m.x - (r.x + r.width / 2), ddy = m.y - (r.y + r.height / 2), d = Math.hypot(ddx, ddy) || 1;
          S.lookT = { x: ddx / d, y: (ddy / d) * 0.7 };
        } else {
          const a = Math.random() * Math.PI * 2, k = Math.random() < 0.3 ? 0 : 0.8;
          S.lookT = { x: Math.cos(a) * k, y: Math.sin(a) * k * 0.6 };
        }
        S.nextLook = S.t + 1.4 + Math.random() * 2.2;
      }
      S.look.x = lerp(S.look.x, S.lookT.x, 1 - Math.pow(0.003, dt));
      S.look.y = lerp(S.look.y, S.lookT.y, 1 - Math.pow(0.003, dt));
      if (S.t > S.nextBlink) { S.blink = lerp(S.blink, 0.1, 0.6); if (S.t > S.nextBlink + 0.12) S.nextBlink = S.t + 2.8 + Math.random() * 3.6; }
      else S.blink = lerp(S.blink, 1, 0.4);

      // hands: each springs toward its spot next to him, in screen space, so it trails behind
      const waving = S.t < S.waveUntil && !S.move;
      const bob = (i: number) => Math.sin(S.t * 2 + i) * 2;
      const spots = [
        { x: -38, y: 8 + bob(0), r: 0 },
        waving ? { x: 36, y: -20 + Math.sin(S.t * 9) * 2, r: Math.sin(S.t * 9) * 28 - 10 }
          : inspecting ? { x: 22, y: 14, r: Math.sin(S.t * 1.6) * 4 } : { x: 38, y: 8 + bob(1), r: 0 },
      ];
      S.loupe = lerp(S.loupe, inspecting ? 1 : 0, 1 - Math.pow(0.002, dt));
      S.hands.forEach((h, i) => {
        const T = spots[i];
        const gx = S.pos.x + T.x, gy = S.pos.y + T.y;
        if (reduced) { h.x = gx; h.y = gy; h.r = T.r; return; }
        h.vx += (-(h.x - gx) * 110 - h.vx * 8) * dt; h.vy += (-(h.y - gy) * 110 - h.vy * 8) * dt;
        h.x += h.vx * dt; h.y += h.vy * dt;
        h.r = lerp(h.r, T.r - (S.move ? Math.cos(S.dir) * sp * 25 : 0), 1 - Math.pow(0.001, dt));
        // never drift too far from him
        const lx = h.x - S.pos.x, ly = h.y - S.pos.y, d = Math.hypot(lx, ly);
        if (d > 62) { h.x = S.pos.x + (lx / d) * 62; h.y = S.pos.y + (ly / d) * 62; }
      });

      /* ---- write to the SVG ---- */
      const path = outline(sp, S.dir, S.wob, S.ph);
      E.body?.setAttribute("d", path);
      S.hist.unshift({ ...S.pos });
      S.hist.length = 7;
      ([["g1", 3, 0.16], ["g2", 6, 0.07]] as const).forEach(([k, n, op]) => {
        const g = E[k], h = S.hist[n];
        if (!g) return;
        if (h && sp > 0.4) { g.setAttribute("d", path); g.setAttribute("opacity", String(op * sp)); g.setAttribute("transform", `translate(${h.x - S.pos.x} ${h.y - S.pos.y})`); }
        else g.setAttribute("opacity", "0");
      });
      const hh = 15 * S.blink, wrap = 1 - Math.abs(S.look.x) * 0.25;
      const ex = S.look.x * 7 + S.fx, ey = -4 + S.look.y * 4 + S.fy - hh / 2;
      for (const [k, x0] of [["e1", -12], ["e2", 5]] as const) {
        const e = E[k];
        if (!e) continue;
        e.setAttribute("x", String(x0 * wrap + ex)); e.setAttribute("y", String(ey));
        e.setAttribute("width", String(7 * wrap)); e.setAttribute("height", String(Math.max(hh, 1.5)));
      }
      const mx = ex * 0.9, my = 10 + S.look.y * 3 + S.fy * 0.6, mw = 5.5 * wrap;
      E.mouth?.setAttribute("d",
        S.o > 0.25 ? `M${mx - 2.6} ${my} a2.6 ${2 + S.o * 1.6} 0 1 0 5.2 0 a2.6 ${2 + S.o * 1.6} 0 1 0 -5.2 0`
        : L.mode === "concerned" ? `M${mx - 4.5} ${my + 2} Q${mx} ${my - 0.8} ${mx + 4.5} ${my + 2}`
        : L.mode === "happy" || waving ? `M${mx - 6} ${my - 1} Q${mx} ${my + 5.4} ${mx + 6} ${my - 1}`
        : `M${mx - mw} ${my} Q${mx} ${my + 3.6} ${mx + mw} ${my}`);
      E.bd?.setAttribute("transform", `translate(0 30) skewX(${(S.lean * 57.3).toFixed(2)}) scale(${S.sx.toFixed(3)} ${S.sy.toFixed(3)}) translate(0 -30)`);
      E.shadow?.setAttribute("rx", String(24 * (1 - air * 0.35)));
      E.shadow?.setAttribute("opacity", String((document.documentElement.classList.contains("dark") ? 0.45 : 0.14) * (1 - air * 0.4)));
      E.shadow?.setAttribute("transform", `translate(0 ${air * (S.move?.lift ?? 0)})`);
      S.hands.forEach((h, i) => {
        E[`h${i}`]?.setAttribute("transform", `translate(${(h.x - S.pos.x).toFixed(2)} ${(h.y - S.pos.y).toFixed(2)}) rotate(${h.r.toFixed(1)}) scale(${i ? 1 : -1} 1)`);
      });
      for (const k of ["handle", "lens"]) {
        E[k]?.setAttribute("opacity", S.loupe.toFixed(2));
        E[k]?.setAttribute("transform", `scale(${(0.4 + S.loupe * 0.6).toFixed(2)})`);
      }
      const tr = `translate(${S.pos.x.toFixed(1)}px, ${S.pos.y.toFixed(1)}px)`;
      if (root.current) root.current.style.transform = tr;
      if (bubbleRef?.current) bubbleRef.current.style.transform = tr;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Plain mitts, no thumbs. The right one grips the loupe: handle behind the mitt, lens out in front.
  const mitt = (k: string) => (
    <g ref={set(k)}>
      {k === "h1" && (
        <path ref={set("handle")} d="M-5 -5 L11 11" stroke="#d97757" strokeWidth="4.4" strokeLinecap="round" opacity="0" />
      )}
      <ellipse rx="7.5" ry="6.8" fill={COLOR.mitt} stroke={COLOR.dark} strokeOpacity=".6" strokeWidth="1.1" />
      {k === "h1" && (
        <g ref={set("lens")} opacity="0">
          <circle cx="20" cy="20" r="11.5" fill="rgba(255,255,255,.28)" stroke="#f5f5f7" strokeWidth="2.8" />
          <path d="M14.5 15.5a7 7 0 0 1 5.5 -3.5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  );

  return (
    <button
      ref={root}
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={label}
      className="absolute z-40 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{ right, bottom, width: HIT, height: HIT }}
    >
      <svg viewBox="-70 -70 140 140" width="140" height="140" aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible">
        <defs>
          <radialGradient id="lou-shade" cx="36%" cy="30%" r="78%">
            <stop offset="0" stopColor={COLOR.light} />
            <stop offset=".55" stopColor={COLOR.base} />
            <stop offset="1" stopColor={COLOR.dark} />
          </radialGradient>
        </defs>
        <ellipse ref={set("shadow")} cx="0" cy="34" rx="24" ry="4.5" fill="#000" opacity=".14" />
        <path ref={set("g2")} fill={COLOR.base} opacity="0" />
        <path ref={set("g1")} fill={COLOR.base} opacity="0" />
        {mitt("h0")}
        <g ref={set("bd")}>
          <path ref={set("body")} fill="url(#lou-shade)" d="M30 0A30 30 0 1 1 -30 0A30 30 0 1 1 30 0Z" />
          <rect ref={set("e1")} x="-12" y="-11.5" width="7" height="15" rx="3.5" fill="#fff" />
          <rect ref={set("e2")} x="5" y="-11.5" width="7" height="15" rx="3.5" fill="#fff" />
          <path ref={set("mouth")} d="M-5.5 10 Q0 13.6 5.5 10" fill="none" stroke="#1d1d1f" strokeOpacity=".75" strokeWidth="2.2" strokeLinecap="round" />
        </g>
        {mitt("h1")}
      </svg>
      {children}
    </button>
  );
}
