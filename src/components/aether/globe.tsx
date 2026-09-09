import { useEffect, useRef } from "react";
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
  const δ = distKm / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

export function Globe({
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
  const state = useRef({
    rot: [-20, -18] as [number, number],
    dragging: false,
    moved: false,
    last: [0, 0],
    scan: 0,
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

    let raf = 0;
    let lastTs = performance.now();

    const projection = geoOrthographic();
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const visible = (lng: number, lat: number, w: number, h: number, r: number) => {
      const p = projection([lng, lat]);
      if (!p) return null;
      const dist2 = (p[0] - w / 2) ** 2 + (p[1] - (h / 2 + 4)) ** 2;
      if (dist2 > r * r * 0.98) return null;
      return p;
    };

    const draw = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const st = state.current;
      const selected = st.contacts.find((c) => c.id === st.selectedId);
      if (selected && !st.dragging) {
        const wantX = -selected.lng;
        const wantY = Math.max(-68, Math.min(68, -selected.lat * 0.55));
        st.rot[0] += (wantX - st.rot[0]) * Math.min(1, dt * 2.4);
        st.rot[1] += (wantY - st.rot[1]) * Math.min(1, dt * 2.4);
      } else if (!st.dragging && !st.reduced) {
        st.rot[0] = (st.rot[0] + dt * 6.2) % 360;
      }
      if (!st.reduced) st.scan = (st.scan + dt * (st.dragging ? 18 : 28)) % 360;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const r = Math.min(w, h) * 0.42;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bg = token("--color-bg", "#09090b");
      const surface = token("--color-surface", "#121418");
      const fg = token("--color-fg", "#ecece8");
      const muted = token("--color-muted", "#8b908c");
      const accent = token("--color-accent", "#b8c4c0");
      const signal = token("--color-signal", "#9eb8ae");
      const alert = token("--color-alert", "#c4897a");
      const watch = token("--color-watch", "#c4b08a");
      const candidate = token("--color-candidate", "#3dff6a");

      projection
        .translate([w / 2, h / 2 + 4])
        .scale(r)
        .rotate([st.rot[0], st.rot[1], 0])
        .clipAngle(90);

      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 + 4, r, 0, Math.PI * 2);
      const fill = ctx.createRadialGradient(
        w / 2 - r * 0.25,
        h / 2 - r * 0.15,
        r * 0.1,
        w / 2,
        h / 2 + 4,
        r,
      );
      fill.addColorStop(0, surface);
      fill.addColorStop(1, bg);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = `${muted}33`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      path(land);
      ctx.fillStyle = `${accent}18`;
      ctx.fill();
      ctx.strokeStyle = `${accent}55`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 + 4, r, 0, Math.PI * 2);
      ctx.strokeStyle = `${fg}22`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      if (!st.reduced) {
        ctx.save();
        const scanRot = projection.rotate();
        projection.rotate([st.scan, st.rot[1], 0]);
        ctx.beginPath();
        path({
          type: "LineString",
          coordinates: Array.from({ length: 37 }, (_, i) => [0, -90 + i * 5]),
        });
        ctx.strokeStyle = `${signal}55`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        projection.rotate(scanRot);
        ctx.restore();
      }

      if (st.showTraffic) {
        for (const a of st.aircraft) {
          const p = visible(a.lng, a.lat, w, h, r);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 1.15, 0, Math.PI * 2);
          ctx.fillStyle = `${muted}99`;
          ctx.fill();
        }
      }

      for (const b of st.balloons) {
        const p = visible(b.lng, b.lat, w, h, r);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = `${watch}aa`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const s of st.satellites) {
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
        ctx.fillStyle = `${accent}cc`;
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

      for (const cam of st.cameras) {
        const p = visible(cam.lng, cam.lat, w, h, r);
        if (!p) continue;
        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = `${signal}cc`;
        ctx.fillRect(-2.2, -2.2, 4.4, 4.4);
        ctx.restore();
      }

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
      ctx.textBaseline = "bottom";

      for (const s of st.contacts) {
        const p = visible(s.lng, s.lat, w, h, r);
        if (!p) continue;
        const selectedDot = s.id === st.selectedId;
        const hover = s.id === st.hoverId;
        const uap = isUapCandidate(s);
        const color = uap
          ? candidate
          : s.classification === "anomalous"
            ? alert
            : s.classification === "sensor-contact"
              ? signal
              : s.classification === "unidentified"
                ? watch
                : muted;
        const rad = selectedDot ? 4.8 : hover ? 3.6 : s.live ? 3.1 : 2.4;
        ctx.beginPath();
        ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (selectedDot || hover || s.live || uap) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], rad + (uap ? 7 : s.live && !selectedDot ? 5 : 6), 0, Math.PI * 2);
          ctx.strokeStyle = `${color}${uap ? "cc" : s.live ? "66" : "99"}`;
          ctx.lineWidth = uap ? 1.4 : 1;
          ctx.stroke();
        }
        if (uap) {
          const label = `${s.locationLabel.slice(0, 18)}  ${uapProbability(s)}%`;
          ctx.fillStyle = candidate;
          ctx.fillText(label, p[0] + 8, p[1] - 6);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

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
    };
    const onMove = (e: PointerEvent) => {
      const xy = localXY(e);
      state.current.hoverId = nearest(xy);
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
      if (wasDrag) return;
      const xy = localXY(e);
      if (state.current.pickMode) {
        const inv = projection.invert?.(xy);
        if (inv) onPick(inv[1], inv[0]);
        return;
      }
      const id = nearest(xy);
      if (id !== null) onSelect(id);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [onPick, onSelect]);

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
}

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
