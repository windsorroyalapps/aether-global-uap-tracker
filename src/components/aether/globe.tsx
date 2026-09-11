import { memo, useEffect, useRef } from "react";
import { geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopo from "world-atlas/land-110m.json";
import { isUapCandidate, uapProbability } from "@/lib/uap/infer";
import type { Contact } from "@/lib/uap/types";

type OverlayPt = { lat: number; lng: number };

type Props = {
  contacts: Contact[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pickMode: boolean;
  onPick: (lat: number, lng: number) => void;
  aircraft?: OverlayPt[];
  balloons?: OverlayPt[];
  satellites?: OverlayPt[];
  iss?: { lat: number; lng: number } | null;
  cameras?: OverlayPt[];
  showTraffic: boolean;
};

const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topo, topo.objects.land);

function token(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function dest(lat: number, lng: number, bearingDeg: number, distKm: number) {
  const R = 6371;
  const delta = distKm / R;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lam1 = (lng * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lam2 =
    lam1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: (phi2 * 180) / Math.PI, lng: (((lam2 * 180) / Math.PI + 540) % 360) - 180 };
}

export const Globe = memo(function Globe({
  contacts,
  selectedId,
  onSelect,
  pickMode,
  onPick,
  aircraft = [],
  balloons = [],
  satellites = [],
  iss = null,
  cameras = [],
  showTraffic,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef(onPick);
  const selectRef = useRef(onSelect);
  pickRef.current = onPick;
  selectRef.current = onSelect;
  const kick = useRef<() => void>(() => {});
  const lastSnap = useRef<number | null>(null);
  const state = useRef({
    rot: [-20, -18] as [number, number],
    dragging: false,
    moved: false,
    last: [0, 0],
    hoverId: null as number | null,
    contacts,
    selectedId,
    pickMode,
    reduced: false,
    aircraft,
    balloons,
    satellites,
    iss,
    cameras,
    showTraffic,
  });
  state.current.contacts = contacts;
  state.current.selectedId = selectedId;
  state.current.pickMode = pickMode;
  state.current.aircraft = aircraft;
  state.current.balloons = balloons;
  state.current.satellites = satellites;
  state.current.iss = iss;
  state.current.cameras = cameras;
  state.current.showTraffic = showTraffic;

  if (selectedId != null && selectedId !== lastSnap.current) {
    const hit = contacts.find((c) => c.id === selectedId);
    if (hit) {
      state.current.rot = [-hit.lng, Math.max(-68, Math.min(68, -hit.lat * 0.55))];
      lastSnap.current = selectedId;
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => kick.current(), 120);
    return () => window.clearTimeout(t);
  }, [
    contacts,
    selectedId,
    pickMode,
    aircraft,
    balloons,
    satellites,
    iss,
    cameras,
    showTraffic,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    state.current.reduced = mq.matches;
    const onMq = () => {
      state.current.reduced = mq.matches;
    };
    mq.addEventListener("change", onMq);

    const colors = {
      bg: token("--color-bg", "#09090b"),
      surface: token("--color-surface", "#121418"),
      fg: token("--color-fg", "#ecece8"),
      muted: token("--color-muted", "#8b908c"),
      accent: token("--color-accent", "#b8c4c0"),
      signal: token("--color-signal", "#9eb8ae"),
      alert: token("--color-alert", "#c4897a"),
      watch: token("--color-watch", "#c4b08a"),
      candidate: token("--color-candidate", "#3dff6a"),
    };

    const projection = geoOrthographic();
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();
    const layer = document.createElement("canvas");
    const lctx = layer.getContext("2d");
    let landKey = "";
    let raf = 0;
    let hidden = document.visibilityState === "hidden";

    const visible = (lng: number, lat: number, w: number, h: number, r: number) => {
      const p = projection([lng, lat]);
      if (!p) return null;
      const dist2 = (p[0] - w / 2) ** 2 + (p[1] - (h / 2 + 4)) ** 2;
      if (dist2 > r * r * 0.98) return null;
      return p;
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const bw = Math.max(1, Math.floor(cssW * dpr));
      const bh = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width === bw && canvas.height === bh) return;
      canvas.width = bw;
      canvas.height = bh;
      landKey = "";
      schedule();
    };

    const draw = () => {
      if (hidden || !lctx) return;
      const st = state.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      if (w < 2 || h < 2) return;
      const r = Math.min(w, h) * 0.42;
      const {
        bg,
        surface,
        fg,
        muted,
        accent,
        signal,
        alert,
        watch,
        candidate,
      } = colors;

      projection
        .translate([w / 2, h / 2 + 4])
        .scale(r)
        .rotate([st.rot[0], st.rot[1], 0])
        .clipAngle(90);

      const key = `${canvas.width}x${canvas.height}:${st.rot[0].toFixed(0)}:${st.rot[1].toFixed(0)}`;
      if (key !== landKey) {
        layer.width = canvas.width;
        layer.height = canvas.height;
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lctx.clearRect(0, 0, w, h);
        lctx.beginPath();
        lctx.arc(w / 2, h / 2 + 4, r, 0, Math.PI * 2);
        const fill = lctx.createRadialGradient(
          w / 2 - r * 0.25,
          h / 2 - r * 0.15,
          r * 0.1,
          w / 2,
          h / 2 + 4,
          r,
        );
        fill.addColorStop(0, surface);
        fill.addColorStop(1, bg);
        lctx.fillStyle = fill;
        lctx.fill();
        lctx.save();
        lctx.beginPath();
        path.context(lctx);
        path(graticule);
        lctx.strokeStyle = `${muted}33`;
        lctx.lineWidth = 0.6;
        lctx.stroke();
        lctx.beginPath();
        path(land);
        lctx.fillStyle = `${accent}18`;
        lctx.fill();
        lctx.strokeStyle = `${accent}55`;
        lctx.lineWidth = 0.8;
        lctx.stroke();
        lctx.restore();
        lctx.beginPath();
        lctx.arc(w / 2, h / 2 + 4, r, 0, Math.PI * 2);
        lctx.strokeStyle = `${fg}22`;
        lctx.lineWidth = 1.2;
        lctx.stroke();
        path.context(ctx);
        landKey = key;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(layer, 0, 0, w, h);

      if (st.showTraffic) {
        const traffic = st.aircraft.length > 60 ? st.aircraft.slice(0, 60) : st.aircraft;
        ctx.fillStyle = `${muted}99`;
        for (const a of traffic) {
          const p = visible(a.lng, a.lat, w, h, r);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.strokeStyle = `${watch}aa`;
      ctx.lineWidth = 1;
      for (const b of st.balloons.slice(0, 40)) {
        const p = visible(b.lng, b.lat, w, h, r);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = `${accent}cc`;
      for (const s of st.satellites.slice(0, 40)) {
        const p = visible(s.lng, s.lat, w, h, r);
        if (!p) continue;
        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.beginPath();
        ctx.moveTo(0, -3.2);
        ctx.lineTo(2.4, 0);
        ctx.lineTo(0, 3.2);
        ctx.lineTo(-2.4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (st.iss) {
        const p = visible(st.iss.lng, st.iss.lat, w, h, r);
        if (p) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 5.2, 0, Math.PI * 2);
          ctx.strokeStyle = `${accent}cc`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p[0], p[1], 2.1, 0, Math.PI * 2);
          ctx.fillStyle = accent;
          ctx.fill();
        }
      }

      ctx.fillStyle = `${signal}cc`;
      for (const cam of st.cameras.slice(0, 40)) {
        const p = visible(cam.lng, cam.lat, w, h, r);
        if (!p) continue;
        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-2.2, -2.2, 4.4, 4.4);
        ctx.restore();
      }

      const selected = st.contacts.find((c) => c.id === st.selectedId);
      if (selected && selected.headingDeg != null) {
        const inbound = (selected.headingDeg + 180) % 360;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 8; i += 1) {
          const pt = dest(selected.lat, selected.lng, inbound, i * 90);
          const p = visible(pt.lng, pt.lat, w, h, r);
          if (!p) continue;
          if (!started) {
            ctx.moveTo(p[0], p[1]);
            started = true;
          } else ctx.lineTo(p[0], p[1]);
        }
        ctx.strokeStyle = `${candidate}aa`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font = "600 10px IBM Plex Mono, ui-monospace, monospace";
      ctx.textBaseline = "middle";
      for (const s of st.contacts) {
        const p = visible(s.lng, s.lat, w, h, r);
        if (!p) continue;
        const uap = isUapCandidate(s);
        const selectedDot = s.id === st.selectedId;
        const hover = s.id === st.hoverId;
        const color = uap
          ? candidate
          : s.classification === "anomalous"
            ? alert
            : s.classification === "unidentified"
              ? watch
              : s.live
                ? signal
                : muted;
        const rad = selectedDot ? 4.8 : hover ? 3.6 : s.live ? 3.1 : 2.4;
        ctx.beginPath();
        ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (selectedDot || hover || uap) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], rad + (uap ? 7 : 6), 0, Math.PI * 2);
          ctx.strokeStyle = `${color}${uap ? "cc" : "99"}`;
          ctx.lineWidth = uap ? 1.4 : 1;
          ctx.stroke();
        }
        if (uap && (selectedDot || hover)) {
          ctx.fillStyle = candidate;
          ctx.fillText(`${s.locationLabel.slice(0, 16)}  ${uapProbability(s)}%`, p[0] + 8, p[1] - 6);
        }
      }
    };

    const schedule = () => {
      if (hidden || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
        if (state.current.dragging && !hidden) schedule();
      });
    };
    kick.current = schedule;

    const onVis = () => {
      hidden = document.visibilityState === "hidden";
      if (!hidden) schedule();
    };
    document.addEventListener("visibilitychange", onVis);

    resize();
    // Double rAF so canvas picks up settled flex height (blank map if first resize was 0).
    requestAnimationFrame(() => {
      resize();
      kick.current();
      requestAnimationFrame(() => {
        resize();
        kick.current();
      });
    });
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const localXY = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top] as [number, number];
    };

    const nearest = (xy: [number, number]) => {
      let best: { id: number; d: number } | null = null;
      for (const s of state.current.contacts) {
        const p = projection([s.lng, s.lat]);
        if (!p) continue;
        const d = Math.hypot(p[0] - xy[0], p[1] - xy[1]);
        if (d < 16 && (!best || d < best.d)) best = { id: s.id, d };
      }
      return best?.id ?? null;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      state.current.dragging = true;
      state.current.moved = false;
      state.current.last = [e.clientX, e.clientY];
      schedule();
    };
    const onMove = (e: PointerEvent) => {
      const xy = localXY(e);
      const hover = nearest(xy);
      if (hover !== state.current.hoverId) {
        state.current.hoverId = hover;
        if (!state.current.dragging) schedule();
      }
      canvas.style.cursor = state.current.pickMode
        ? "crosshair"
        : state.current.hoverId
          ? "pointer"
          : state.current.dragging
            ? "grabbing"
            : "grab";
      if (!state.current.dragging) return;
      const dx = e.clientX - state.current.last[0];
      const dy = e.clientY - state.current.last[1];
      if (Math.hypot(dx, dy) > 3) state.current.moved = true;
      state.current.last = [e.clientX, e.clientY];
      state.current.rot[0] += dx * 0.35;
      state.current.rot[1] = Math.max(-68, Math.min(68, state.current.rot[1] - dy * 0.28));
    };
    const onUp = (e: PointerEvent) => {
      const wasDrag = state.current.moved;
      state.current.dragging = false;
      schedule();
      if (wasDrag) return;
      const xy = localXY(e);
      if (state.current.pickMode) {
        const inv = projection.invert?.(xy);
        if (inv) pickRef.current(inv[1], inv[0]);
        return;
      }
      const id = nearest(xy);
      if (id !== null) selectRef.current(id);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    return () => {
      kick.current = () => {};
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full min-h-[280px]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        aria-label="Global UAP contact globe"
      />
      <GlobeLegend />
    </div>
  );
});

function GlobeLegend() {
  return (
    <aside className="pointer-events-none absolute bottom-3 left-3 z-10 w-[168px] rounded-xl border border-border bg-bg/85 p-3 backdrop-blur-sm sm:bottom-4 sm:left-4">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Legend</p>
      <ul className="space-y-1.5 text-[11px] text-fg">
        <LegendRow color="bg-candidate" label="UAP candidate >50%" ring />
        <LegendRow color="bg-alert" label="Anomalous" />
        <LegendRow color="bg-watch" label="Unidentified" />
        <LegendRow color="bg-signal" label="Sensor / live" />
        <LegendRow color="bg-muted" label="Likely prosaic" />
        <LegendRow color="bg-accent" label="Satellite / ISS" diamond />
        <LegendRow color="border-watch" label="Radiosonde" hollow />
        <LegendRow color="bg-signal" label="Public camera" square />
        <LegendRow color="bg-muted" label="ADS-B traffic" tiny />
      </ul>
    </aside>
  );
}

function LegendRow({
  color,
  label,
  ring,
  diamond,
  hollow,
  square,
  tiny,
}: {
  color: string;
  label: string;
  ring?: boolean;
  diamond?: boolean;
  hollow?: boolean;
  square?: boolean;
  tiny?: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={
          diamond
            ? `size-2.5 rotate-45 ${color}`
            : square
              ? `size-2 rotate-45 ${color}`
              : hollow
                ? `size-2.5 rounded-full border ${color}`
                : tiny
                  ? `size-1.5 rounded-full ${color}`
                  : ring
                    ? `size-2.5 rounded-full ${color} ring-2 ring-candidate/50`
                    : `size-2.5 rounded-full ${color}`
        }
      />
      <span className="leading-tight text-muted">{label}</span>
    </li>
  );
}
