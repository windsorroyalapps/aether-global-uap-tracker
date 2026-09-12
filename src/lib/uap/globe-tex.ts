import { createServerFn } from "@tanstack/react-start";

const UA = "AETHER-UAP-Console/1.0 (research; NASA GIBS)";
const WVS = "https://wvs.earthdata.nasa.gov/api/v1/snapshot";

export const SAT_MODES = ["auto", "visible", "night", "ir"] as const;
export type SatMode = (typeof SAT_MODES)[number];

export const SAT_LAYERS = ["visible", "night", "ir"] as const;
export type SatLayer = (typeof SAT_LAYERS)[number];

export const SAT_LAYER_META: Record<SatMode, { label: string; short: string }> = {
  auto: { label: "Live terminator", short: "DAY" },
  visible: { label: "True color", short: "VIS" },
  night: { label: "Night lights", short: "NGT" },
  ir: { label: "Infrared", short: "IR" },
};

export type GlobeTexture = {
  src: string;
  source: string;
  acquired: string | null;
  layer: SatLayer;
};

type LayerTry = { layer: string; source: string; time: string; wrap: boolean };

const cache = new Map<string, GlobeTexture>();

function dayStamp(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function tries(layer: SatLayer): LayerTry[] {
  const today = dayStamp(0);
  const yday = dayStamp(-1);
  if (layer === "night") {
    return [
      { layer: "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance", source: "NASA VIIRS night", time: today, wrap: true },
      { layer: "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance", source: "NASA VIIRS night", time: yday, wrap: true },
      { layer: "VIIRS_Black_Marble", source: "NASA Black Marble", time: "2016-01-01", wrap: false },
    ];
  }
  if (layer === "ir") {
    return [
      { layer: "VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1", source: "NASA VIIRS IR", time: today, wrap: true },
      { layer: "VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1", source: "NASA VIIRS IR", time: yday, wrap: true },
      { layer: "MODIS_Terra_CorrectedReflectance_Bands721", source: "NASA MODIS IR", time: yday, wrap: true },
    ];
  }
  return [
    { layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor", source: "NASA VIIRS true color", time: today, wrap: true },
    { layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor", source: "NASA VIIRS true color", time: yday, wrap: true },
    { layer: "BlueMarble_NextGeneration", source: "NASA Blue Marble", time: "2004-08-01", wrap: false },
  ];
}

async function fetchWorld(spec: LayerTry): Promise<GlobeTexture | null> {
  const params = new URLSearchParams({
    REQUEST: "GetSnapshot",
    TIME: spec.time,
    BBOX: "-90,-180,90,180",
    CRS: "EPSG:4326",
    LAYERS: spec.layer,
    FORMAT: "image/jpeg",
    WIDTH: "1600",
    HEIGHT: "800",
  });
  if (spec.wrap) params.set("WRAP", "DAY");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 18000);
  try {
    const res = await fetch(`${WVS}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "image/jpeg" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const present = (res.headers.get("data-present") ?? "").toLowerCase() === "true";
    const acquired = res.headers.get("acquisition-time");
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    if (!mime.includes("image") || !present) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 12_000) return null;
    return {
      src: `data:${mime};base64,${buf.toString("base64")}`,
      source: spec.source,
      acquired,
      layer: "visible",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const loadGlobeTexture = createServerFn({ method: "GET" })
  .validator((input: { layer: SatLayer }) => {
    if (!SAT_LAYERS.includes(input.layer)) throw new Error("Unknown satellite layer.");
    return input;
  })
  .handler(async ({ data }): Promise<GlobeTexture | { error: string }> => {
    const key = `${data.layer}:${dayStamp(0)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    for (const spec of tries(data.layer)) {
      const snap = await fetchWorld(spec);
      if (!snap) continue;
      const packed = { ...snap, layer: data.layer };
      cache.set(key, packed);
      return packed;
    }
    return { error: "Global satellite mosaic unavailable." };
  });
