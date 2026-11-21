import { useEffect, useRef } from "react";

/**
 * Lou, a little magenta clay figure with a built-in monocle: one bead eye, one eye behind an orange
 * clay monocle on a swinging chain, a rolled-clay brow and mouth, and round clay mitts.
 *
 * He moves like an old cartoon (anticipation, lean, drag, a jelly landing) and is shot like stop
 * motion: the physics runs every frame, but he is redrawn 12 times a second and the clay surface
 * shifts a little on every redraw. When he inspects a view he raises a mitt to the monocle, leans
 * in, lifts his brow and the eye behind the glass grows. One animation loop writes SVG attributes
 * directly, so React doesn't re-render all the time.
 */
export type LouMode = "idle" | "inspecting" | "happy" | "concerned";

const C = {
  light: "#FF8CC4", base: "#F2559F", dark: "#C93A7F", mitt: "#F766A9", ink: "#4A0E2B",
  pupil: "#1a0b12", monocle: "#E8834F", glass: "#EDEBE6",
};
const FPS = 12; // stop motion
const SCALE = 0.78; // drawn at 150 units, shown smaller
const HIT = 54; // the clickable area around his body
const R = 34; // body radius in drawing units
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
    let r = R * (1 - 0.07 * sp * Math.max(0, a)) * (1 + 0.18 * sp * Math.max(0, -a));
    r += Math.sin(3 * th + ph) * wob * 2.6 + Math.sin(2 * th - ph * 1.3) * wob * 1.2;
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
  /** Where he should be, as an offset from his home in the corner (screen pixels) */
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
    // Positions are in screen pixels; offsets inside his drawing are in drawing units
    const u = 1 / SCALE;
    const S = {
      pos: { ...live.current.to }, goal: { ...live.current.to },
      move: null as null | { t: number; ant: number; dur: number; from: V; to: V; lift: number },
      sx: 1, sy: 1, vsx: 0, vsy: 0, lean: 0, vlean: 0, fx: 0, fy: 0, vfx: 0, vfy: 0, wob: 0, ph: 0, o: 0, dir: 0, sp: 0, air: 0,
      chain: 0, vchain: 0, zoom: 0, handsOn: 0, handsUntil: 0,
      look: { x: 0, y: 0 }, lookT: { x: 0, y: 0 }, nextLook: 0, blink: 1, nextBlink: 2, t: 0,
      wave: live.current.wave, waveUntil: 0,
      hands: [{ x: -46, y: 12, vx: 0, vy: 0, r: 0 }, { x: 46, y: 12, vx: 0, vy: 0, r: 0 }],
      mouse: null as V | null,
    };
    // hands live in screen space (drawing units) so they lag behind the body
    S.hands.forEach((h) => { h.x += S.pos.x * u; h.y += S.pos.y * u; });
    const onMove = (e: PointerEvent) => { S.mouse = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", onMove);
    let raf = 0, last = performance.now(), acc = 1, seed = 3;

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
        else S.move = { t: 0, ant: 0.2, dur: Math.min(1.15, Math.max(0.6, dist / 900)), from: { ...S.pos }, to: { ...S.goal }, lift: Math.min(32, dist * 0.1) };
      }

      let tx = 1, ty = 1, tl = 0;
      S.air = 0;
      const prev = { ...S.pos };
      if (S.move) {
        const m = S.move;
        m.t += dt;
        S.dir = Math.atan2(m.to.y - m.from.y, m.to.x - m.from.x);
        const cx = Math.cos(S.dir);
        if (m.t < m.ant) { tx = 1.16; ty = 0.86; tl = 0.12 * Math.sign(cx); } // gathering himself
        else {
          const k = Math.min(1, (m.t - m.ant) / m.dur), e = ease(k);
          S.air = Math.sin(Math.PI * k);
          S.pos = { x: lerp(m.from.x, m.to.x, e), y: lerp(m.from.y, m.to.y, e) - S.air * m.lift };
          if (k >= 1) {
            S.move = null;
            S.pos = { ...m.to };
            S.vsy -= 2.8; S.vsx += 2.3; S.wob = 1.2; S.vlean += 3 * Math.sign(cx); S.vfx += 60 * Math.sign(cx); S.vchain += 80 * Math.sign(cx);
            S.hands.forEach((h) => { h.vx += cx * 120; h.vy -= 50; });
          }
        }
      }
      const vx = ((S.pos.x - prev.x) / dt) * u, vy = ((S.pos.y - prev.y) / dt) * u;
      S.sp = reduced ? 0 : Math.min(1, Math.hypot(vx, vy) / 800);
      if (S.sp > 0.02) {
        const ax = Math.abs(Math.cos(S.dir)), ay = Math.abs(Math.sin(S.dir)), st = S.sp * 0.15;
        tx = 1 + st * ax - st * 0.5 * ay;
        ty = 1 + st * ay - st * 0.5 * ax;
        tl = -0.32 * S.sp * Math.cos(S.dir);
      }
      // springs: squash and stretch, lean, face lag, the monocle chain
      S.vsx += (-(S.sx - tx) * 160 - S.vsx * 10) * dt; S.vsy += (-(S.sy - ty) * 160 - S.vsy * 10) * dt;
      S.sx += S.vsx * dt; S.sy += S.vsy * dt;
      S.vlean += (-(S.lean - tl) * 140 - S.vlean * 10) * dt; S.lean += S.vlean * dt;
      S.vfx += (-(S.fx + vx * 0.007) * 140 - S.vfx * 9) * dt; S.fx += S.vfx * dt;
      S.vfy += (-(S.fy + vy * 0.004) * 140 - S.vfy * 9) * dt; S.fy += S.vfy * dt;
      S.vchain += (-(S.chain + vx * 0.018) * 60 - S.vchain * 4) * dt; S.chain += S.vchain * dt;
      S.wob *= Math.pow(0.04, dt); S.ph += dt * 16;
      S.o = lerp(S.o, S.sp, 1 - Math.pow(0.004, dt));

      // where he looks
      const inspecting = L.mode === "inspecting" && !S.move;
      S.zoom = lerp(S.zoom, inspecting ? 1 : 0, 1 - Math.pow(0.01, dt));
      if (S.move) S.lookT = { x: Math.cos(S.dir), y: Math.sin(S.dir) * 0.6 };
      else if (inspecting) S.lookT = { x: 0.55, y: 0.6 };
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
      if (S.t > S.nextBlink) { S.blink = 0.12; if (S.t > S.nextBlink + 0.12) S.nextBlink = S.t + 2.8 + Math.random() * 3.6; }
      else S.blink = lerp(S.blink, 1, 0.4);

      // hands: each springs toward its spot next to him, so it trails behind when he moves
      const waving = S.t < S.waveUntil && !S.move;
      const bob = (i: number) => Math.sin(S.t * 2 + i) * 2;
      const spots = [
        { x: -46, y: 12 + bob(0), r: 0 },
        waving ? { x: 44, y: -24 + Math.sin(S.t * 9) * 2, r: Math.sin(S.t * 9) * 28 - 10 }
          : inspecting ? { x: 35, y: -3, r: -20 } // a mitt at the monocle rim
          : { x: 46, y: 12 + bob(1), r: 0 },
      ];
      // Hands only come out when he has something to do: waving, inspecting, flying (and landing)
      if (S.move || waving || inspecting) S.handsUntil = S.t + 0.6;
      S.handsOn = lerp(S.handsOn, S.t < S.handsUntil ? 1 : 0, 1 - Math.pow(reduced ? 0 : 0.0005, dt));
      const px = S.pos.x * u, py = S.pos.y * u;
      S.hands.forEach((h, i) => {
        const T = spots[i];
        const gx = px + T.x, gy = py + T.y;
        if (reduced) { h.x = gx; h.y = gy; h.r = T.r; return; }
        h.vx += (-(h.x - gx) * 110 - h.vx * 8) * dt; h.vy += (-(h.y - gy) * 110 - h.vy * 8) * dt;
        h.x += h.vx * dt; h.y += h.vy * dt;
        h.r = lerp(h.r, T.r - (S.move ? Math.cos(S.dir) * S.sp * 25 : 0), 1 - Math.pow(0.001, dt));
        const lx = h.x - px, ly = h.y - py, d = Math.hypot(lx, ly);
        if (d > 68) { h.x = px + (lx / d) * 68; h.y = py + (ly / d) * 68; }
      });

      /* ---- write to the SVG, 12 times a second, like stop motion ---- */
      acc += dt;
      if (acc < 1 / FPS) { raf = requestAnimationFrame(frame); return; }
      acc = 0;
      if (!reduced) {
        // the clay is never quite still between frames
        seed = (seed % 40) + 1;
        E.tb?.setAttribute("seed", String(seed));
        E.tb2?.setAttribute("seed", String(seed + 9));
      }
      E.body?.setAttribute("d", outline(S.sp, S.dir, S.wob, S.ph));
      const ex = S.look.x * 7 + S.fx, ey = S.look.y * 4 + S.fy;
      E.bead?.setAttribute("transform", `translate(${(-12 + ex).toFixed(2)} ${(-6 + ey).toFixed(2)}) scale(1 ${S.blink.toFixed(2)})`);
      E.mono?.setAttribute("transform", `translate(${(13 + ex).toFixed(2)} ${(-7 + ey).toFixed(2)})`);
      const z = 1 + S.zoom * 0.22;
      E.pupil?.setAttribute("rx", (7.2 * z).toFixed(2));
      E.pupil?.setAttribute("ry", (7.2 * z * Math.max(0.12, S.blink)).toFixed(2));
      E.pupil?.setAttribute("cx", (S.look.x * 2).toFixed(2));
      E.pupil?.setAttribute("cy", (S.look.y * 2).toFixed(2));
      E.glint?.setAttribute("cx", (2.4 + S.look.x * 2).toFixed(2));
      E.glint?.setAttribute("cy", (-2.4 + S.look.y * 2).toFixed(2));
      const lift = inspecting ? 3 : waving || L.mode === "happy" ? 2.5 : 0;
      const bx = -12 + ex, by = -15 + ey - lift;
      E.brow?.setAttribute("d",
        L.mode === "concerned" ? `M${bx - 6} ${by - 1} Q${bx} ${by - 2} ${bx + 6} ${by + 2}`
        : `M${bx - 6} ${by + 1} Q${bx} ${by - (inspecting ? 4 : 2.5)} ${bx + 6} ${by + (inspecting ? -1 : 1)}`);
      const c0x = 13 + ex + 9, c0y = -7 + ey + 9;
      E.chain?.setAttribute("d", `M${c0x.toFixed(2)} ${c0y.toFixed(2)} Q${(c0x + 6 + S.chain).toFixed(2)} ${(c0y + 16).toFixed(2)} 26 22`);
      const mx = ex * 0.9, my = 14 + ey * 0.6;
      E.mouth?.setAttribute("d",
        S.o > 0.25 ? `M${mx - 3} ${my} a3 ${2.4 + S.o * 2} 0 1 0 6 0 a3 ${2.4 + S.o * 2} 0 1 0 -6 0`
        : L.mode === "concerned" ? `M${mx - 5} ${my + 2} Q${mx} ${my - 1} ${mx + 5} ${my + 2}`
        : waving || L.mode === "happy" ? `M${mx - 7} ${my - 1} Q${mx} ${my + 6} ${mx + 7} ${my - 1}`
        : inspecting ? `M${mx - 4} ${my + 1} Q${mx + 1} ${my + 3} ${mx + 5} ${my}`
        : `M${mx - 6} ${my} Q${mx} ${my + 4} ${mx + 6} ${my}`);
      E.bd?.setAttribute("transform", `translate(0 ${R}) skewX(${(S.lean * 57.3 + (inspecting ? -4 : 0)).toFixed(2)}) scale(${S.sx.toFixed(3)} ${S.sy.toFixed(3)}) translate(0 ${-R})`);
      E.shadow?.setAttribute("rx", String(30 * (1 - S.air * 0.35)));
      E.shadow?.setAttribute("opacity", String((document.documentElement.classList.contains("dark") ? 0.55 : 0.22) * (1 - S.air * 0.4)));
      E.shadow?.setAttribute("transform", `translate(0 ${S.air * (S.move?.lift ?? 0) * u})`);
      S.hands.forEach((h, i) => {
        // tucked away: they shrink back into his sides
        const k = S.handsOn, side = i ? 1 : -1;
        const hx = lerp(side * 26, h.x - px, k), hy = lerp(8, h.y - py, k);
        E[`h${i}`]?.setAttribute("transform", `translate(${hx.toFixed(2)} ${hy.toFixed(2)}) rotate(${h.r.toFixed(1)}) scale(${k.toFixed(3)})`);
      });
      const tr = `translate(${S.pos.x.toFixed(1)}px, ${S.pos.y.toFixed(1)}px)`;
      if (root.current) root.current.style.transform = tr;
      if (bubbleRef?.current) bubbleRef.current.style.transform = tr;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mitt = (k: string) => <g ref={set(k)}><ellipse rx="9.5" ry="8.8" fill={C.mitt} /></g>;
  const px = Math.round(150 * SCALE);

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
      <svg viewBox="-75 -75 150 150" width={px} height={px} aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible">
        <defs>
          <radialGradient id="lou-shade" cx="38%" cy="30%" r="76%">
            <stop offset="0" stopColor={C.light} />
            <stop offset=".68" stopColor={C.base} />
            <stop offset="1" stopColor={C.dark} />
          </radialGradient>
          {/* lumpy, hand-pressed edges */}
          <filter id="lou-lump" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence ref={set("tb")} type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="3" result="w" />
            <feDisplacementMap in="SourceGraphic" in2="w" scale="4" />
          </filter>
          {/* the fine grain of the clay surface */}
          <filter id="lou-skin" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence ref={set("tb2")} type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="12" result="n" />
            <feColorMatrix in="n" type="saturate" values="0" />
            <feComponentTransfer><feFuncA type="table" tableValues="0 .2" /></feComponentTransfer>
            <feComposite in2="SourceGraphic" operator="in" />
            <feBlend in="SourceGraphic" mode="multiply" />
          </filter>
          <filter id="lou-soft"><feGaussianBlur stdDeviation="3.5" /></filter>
        </defs>
        <ellipse ref={set("shadow")} cx="0" cy="40" rx="30" ry="6" fill="#000" opacity=".22" filter="url(#lou-soft)" />
        <g filter="url(#lou-skin)">
          <g filter="url(#lou-lump)">
            {mitt("h0")}
            <g ref={set("bd")}>
              <path ref={set("body")} fill="url(#lou-shade)" d={`M${R} 0A${R} ${R} 0 1 1 ${-R} 0A${R} ${R} 0 1 1 ${R} 0Z`} />
              <path ref={set("chain")} d="M22 2 Q28 18 26 22" fill="none" stroke={C.monocle} strokeWidth="1.8" strokeLinecap="round" />
              <path ref={set("brow")} d="M-18 -14 Q-12 -17.5 -6 -14" fill="none" stroke={C.dark} strokeWidth="3.6" strokeLinecap="round" />
              <g ref={set("bead")} transform="translate(-12 -6)">
                <circle r="4.8" fill={C.pupil} />
                <circle cx="1.4" cy="-1.4" r="1.35" fill="#fff" />
              </g>
              <g ref={set("mono")} transform="translate(13 -7)">
                <circle r="12.5" fill={C.glass} fillOpacity=".6" />
                <ellipse ref={set("pupil")} rx="7.2" ry="7.2" fill={C.pupil} />
                <circle ref={set("glint")} cx="2.4" cy="-2.4" r="2.1" fill="#fff" />
                <circle r="12.5" fill="none" stroke={C.monocle} strokeWidth="4.2" />
              </g>
              <path ref={set("mouth")} d="M-6 14 Q0 18 6 14" fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
            </g>
            {mitt("h1")}
          </g>
        </g>
      </svg>
      {children}
    </button>
  );
}
