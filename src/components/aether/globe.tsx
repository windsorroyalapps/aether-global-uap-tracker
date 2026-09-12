import { useEffect, useRef } from "react";
import { geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopo from "world-atlas/land-110m.json";
import type { GlobeTexture, SatMode } from "@/lib/uap/globe-tex";
import type { SensorType } from "@/lib/uap/sensors";
import { solarCosine, subsolar } from "@/lib/uap/sky";
import type { Sighting } from "@/lib/uap/types";

type Props = {
  contacts: Sighting[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pickMode: boolean;
  onPick: (lat: number, lng: number) => void;
  texture: GlobeTexture | null;
  nightTexture?: GlobeTexture | null;
  mode?: SatMode;
};

const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topo, topo.objects.land);

function token(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function drawSensorMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad: number,
  kind: SensorType,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  if (kind === "radar") {
    ctx.beginPath();
    ctx.moveTo(x, y - rad);
    ctx.lineTo(x + rad, y);
    ctx.lineTo(x, y + rad);
    ctx.lineTo(x - rad, y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === "space-ir") {
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    return;
  }
  if (kind === "infrared") {
    ctx.beginPath();
    ctx.moveTo(x, y - rad);
    ctx.lineTo(x + rad, y + rad);
    ctx.lineTo(x - rad, y + rad);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === "rf") {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - rad, y);
    ctx.lineTo(x + rad, y);
    ctx.stroke();
    return;
  }
  if (kind === "acoustic") {
    ctx.beginPath();
    ctx.arc(x, y, rad, -0.8, 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, rad + 3, -0.8, 0.8);
    ctx.stroke();
    return;
  }
  if (kind === "multi") {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rad + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
}

function sampleTex(tex: ImageData, lon: number, lat: number) {
  const tw = tex.width;
  const th = tex.height;
  const u = ((lon + 180) / 360) * tw;
  const v = ((90 - lat) / 180) * th;
  const tx = Math.min(tw - 1, Math.max(0, u | 0));
  const ty = Math.min(th - 1, Math.max(0, v | 0));
  const si = (ty * tw + tx) * 4;
  return [tex.data[si]!, tex.data[si + 1]!, tex.data[si + 2]!] as const;
}

function paintSatellite(
  out: CanvasRenderingContext2D,
  day: ImageData,
  night: ImageData | null,
  rotLon: number,
  rotLat: number,
  size: number,
  mode: SatMode,
) {
  const img = out.createImageData(size, size);
  const dst = img.data;
  const r = (size - 1) / 2;
  const λ0 = (-rotLon * Math.PI) / 180;
  const φ0 = (-rotLat * Math.PI) / 180;
  const sinφ0 = Math.sin(φ0);
  const cosφ0 = Math.cos(φ0);
  const sun = subsolar();
  const src = mode === "night" && night ? night : day;

  for (let py = 0; py < size; py++) {
    const y = (r - py) / r;
    for (let px = 0; px < size; px++) {
      const x = (px - r) / r;
      const ρ2 = x * x + y * y;
      if (ρ2 > 1) continue;
      const z = Math.sqrt(1 - ρ2);
      const φ = Math.asin(Math.min(1, Math.max(-1, z * sinφ0 + y * cosφ0)));
      const λ = λ0 + Math.atan2(x, z * cosφ0 - y * sinφ0);
      let lon = (λ * 180) / Math.PI;
      const lat = (φ * 180) / Math.PI;
      lon = ((lon + 180) % 360 + 360) % 360 - 180;
      let r8: number;
      let g8: number;
      let b8: number;
      if (mode === "auto") {
        const cosz = solarCosine(lat, lon, sun);
        let t = (cosz + 0.14) / 0.28;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = t * t * (3 - 2 * t);
        const d = sampleTex(day, lon, lat);
        if (night && t < 0.995) {
          const n = sampleTex(night, lon, lat);
          const nr = n[0] * 0.55 + 8;
          const ng = n[1] * 0.62 + 10;
          const nb = n[2] * 0.85 + 18;
          r8 = d[0] * t + nr * (1 - t);
          g8 = d[1] * t + ng * (1 - t);
          b8 = d[2] * t + nb * (1 - t);
        } else if (t < 0.995) {
          r8 = d[0] * (0.08 + 0.92 * t);
          g8 = d[1] * (0.09 + 0.91 * t);
          b8 = d[2] * (0.16 + 0.84 * t);
        } else {
          r8 = d[0];
          g8 = d[1];
          b8 = d[2];
        }
      } else {
        const s = sampleTex(src, lon, lat);
        r8 = s[0];
        g8 = s[1];
        b8 = s[2];
      }
      const limb = 1 - Math.pow(ρ2, 3) * 0.35;
      const di = (py * size + px) * 4;
      dst[di] = (r8 * limb) | 0;
      dst[di + 1] = (g8 * limb) | 0;
      dst[di + 2] = (b8 * limb) | 0;
      dst[di + 3] = 255;
    }
  }
  out.putImageData(img, 0, 0);
}

export function Globe({
  contacts,
  selectedId,
  onSelect,
  pickMode,
  onPick,
  texture,
  nightTexture = null,
  mode = "visible",
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
    tex: null as ImageData | null,
    night: null as ImageData | null,
    mode: "visible" as SatMode,
    earth: null as HTMLCanvasElement | null,
    earthKey: "",
  });
  state.current.contacts = contacts;
  state.current.selectedId = selectedId;
  state.current.pickMode = pickMode;
  state.current.mode = mode;

  useEffect(() => {
    let dead = false;
    const load = (src: string | undefined, assign: (img: ImageData) => void) => {
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        if (dead) return;
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        assign(ctx.getImageData(0, 0, img.width, img.height));
        state.current.earthKey = "";
      };
      img.src = src;
    };
    if (!texture?.src) state.current.tex = null;
    else load(texture.src, (d) => {
      state.current.tex = d;
    });
    if (!nightTexture?.src) state.current.night = null;
    else load(nightTexture.src, (d) => {
      state.current.night = d;
    });
    return () => {
      dead = true;
    };
  }, [texture?.src, nightTexture?.src]);

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
      state.current.earthKey = "";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const st = state.current;
      if (!st.dragging && !st.reduced) {
        st.rot[0] = (st.rot[0] + dt * 6.2) % 360;
        st.scan = (st.scan + dt * 28) % 360;
      } else if (!st.reduced) {
        st.scan = (st.scan + dt * 18) % 360;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const r = Math.min(w, h) * 0.42;
      const cx = w / 2;
      const cy = h / 2 + 4;

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

      projection.translate([cx, cy]).scale(r).rotate([st.rot[0], st.rot[1], 0]).clipAngle(90);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const fill = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.15, r * 0.1, cx, cy, r);
      fill.addColorStop(0, surface);
      fill.addColorStop(1, bg);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      if (st.tex) {
        const size = Math.max(160, Math.min(520, Math.round(r * 2)));
        const step = st.dragging ? 1.2 : 0.7;
        const sunMin = Math.floor(Date.now() / 60_000);
        const key = `${size}|${(st.rot[0] / step) | 0}|${(st.rot[1] / step) | 0}|${st.mode}|${sunMin}|${st.night ? 1 : 0}`;
        if (st.earthKey !== key) {
          if (!st.earth) st.earth = document.createElement("canvas");
          st.earth.width = size;
          st.earth.height = size;
          const ect = st.earth.getContext("2d");
          if (ect) {
            paintSatellite(ect, st.tex, st.night, st.rot[0], st.rot[1], size, st.mode);
            st.earthKey = key;
          }
        }
        if (st.earth) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(st.earth, cx - r, cy - r, r * 2, r * 2);
          ctx.restore();
        }
      }

      ctx.save();
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = st.tex ? `${fg}14` : `${muted}33`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      path(land);
      if (!st.tex) {
        ctx.fillStyle = `${accent}18`;
        ctx.fill();
      }
      ctx.strokeStyle = st.tex ? `${fg}28` : `${accent}55`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const limb = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, r * 1.04);
      limb.addColorStop(0, "transparent");
      limb.addColorStop(0.7, "transparent");
      limb.addColorStop(1, `${signal}33`);
      ctx.fillStyle = limb;
      ctx.fill();
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

      for (const s of st.contacts) {
        const p = projection([s.lng, s.lat]);
        if (!p) continue;
        const dist2 = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
        if (dist2 > r * r * 0.98) continue;

        const selected = s.id === st.selectedId;
        const hover = s.id === st.hoverId;
        const live = s.source === "live";
        const color = live
          ? signal
          : s.classification === "anomalous"
            ? alert
            : s.classification === "sensor-contact"
              ? signal
              : s.classification === "unidentified"
                ? watch
                : muted;
        if (live && s.latErrDeg && s.lngErrDeg) {
          const north = projection([s.lng, s.lat + s.latErrDeg]);
          const east = projection([s.lng + s.lngErrDeg, s.lat]);
          if (north && east) {
            ctx.beginPath();
            ctx.ellipse(
              p[0],
              p[1],
              Math.max(4, Math.abs(east[0] - p[0])),
              Math.max(4, Math.abs(north[1] - p[1])),
              0,
              0,
              Math.PI * 2,
            );
            ctx.strokeStyle = `${signal}66`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        const rad = selected ? 4.4 : hover ? 3.6 : live ? 3 : 2.4;
        if (live && !st.reduced) {
          const pulse = 5 + (Math.sin(ts / 320) + 1) * 3;
          ctx.beginPath();
          ctx.arc(p[0], p[1], rad + pulse, 0, Math.PI * 2);
          ctx.strokeStyle = `${signal}55`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        drawSensorMark(ctx, p[0], p[1], rad, s.sensorType, color);
        if (selected || hover) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], rad + 6, 0, Math.PI * 2);
          ctx.strokeStyle = `${color}99`;
          ctx.lineWidth = 1;
          ctx.stroke();
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
        aria-label="Global satellite imagery globe"
      />
    </div>
  );
}
