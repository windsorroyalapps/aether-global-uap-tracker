import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import type { SpectrumBand } from "./spectra";
import { mapSighting, type Sighting, type SightingRow } from "./types";

const UA = "AETHER-UAP-Console/1.0 (research; NASA GIBS)";
const WVS = "https://wvs.earthdata.nasa.gov/api/v1/snapshot";
const GEO_MS = 90 * 24 * 60 * 60 * 1000;
const MODIS_START = Date.parse("2000-02-24T00:00:00Z");
const VIIRS_START = Date.parse("2012-01-20T00:00:00Z");

export type Frame = {
  src: string;
  source: string;
  capturedAt: string | null;
  note: string | null;
};

export type AreaFeed = {
  frames: Frame[];
  source: string;
  note: string;
  timed: boolean;
};

type Snap = {
  dataUrl: string;
  acquired: string | null;
  present: boolean;
};

type BBox = { south: number; west: number; north: number; east: number };

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

function bboxFor(lat: number, lng: number, spanLat = 1.15): BBox {
  const cos = Math.max(0.22, Math.cos((lat * Math.PI) / 180));
  const spanLng = Math.min(10, (spanLat * 16) / 9 / cos);
  return {
    south: clamp(lat - spanLat / 2, -89.4, 89.4),
    north: clamp(lat + spanLat / 2, -89.4, 89.4),
    west: lng - spanLng / 2,
    east: lng + spanLng / 2,
  };
}

function localHour(iso: string, lng: number) {
  const d = new Date(iso);
  const utc = d.getUTCHours() + d.getUTCMinutes() / 60;
  return (utc + lng / 15 + 24) % 24;
}

function isDaylight(iso: string, lng: number) {
  const h = localHour(iso, lng);
  return h >= 6.2 && h < 18;
}

function dayStamp(iso: string) {
  return iso.slice(0, 10);
}

function round10(iso: string) {
  const d = new Date(iso);
  const ms = 10 * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms).toISOString().replace(".000Z", "Z");
}

function addMinutes(iso: string, m: number) {
  return new Date(new Date(iso).getTime() + m * 60_000).toISOString().replace(".000Z", "Z");
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function geoSat(lat: number, lng: number) {
  if ((lng >= 80 && lng <= 180) || lng < -155) {
    return {
      id: "himawari",
      label: "NASA Himawari-9",
      visible: "Himawari_AHI_Band3_Red_Visible_1km",
      infrared: "Himawari_AHI_Band13_Clean_Infrared",
    };
  }
  if (lng >= -180 && lng <= -90) {
    return {
      id: "goes-west",
      label: "NASA GOES-West",
      visible: "GOES-West_ABI_Band2_Red_Visible_1km",
      infrared: "GOES-West_ABI_Band13_Clean_Infrared",
    };
  }
  if (lng > -105 && lng < -18) {
    return {
      id: "goes-east",
      label: "NASA GOES-East",
      visible: "GOES-East_ABI_Band2_Red_Visible_1km",
      infrared: "GOES-East_ABI_Band13_Clean_Infrared",
    };
  }
  void lat;
  return null;
}

async function fetchSnap(
  params: Record<string, string>,
  timeoutMs = 14000,
): Promise<Snap | null> {
  const url = `${WVS}?${new URLSearchParams(params).toString()}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/jpeg" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const present = (res.headers.get("data-present") ?? "").toLowerCase() === "true";
    const acquired = res.headers.get("acquisition-time");
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    if (!mime.includes("image")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 4000 || !present) return null;
    return {
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      acquired,
      present,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function wvsDaily(
  layer: string,
  day: string,
  bbox: BBox,
  w = 1280,
  h = 720,
): Promise<Snap | null> {
  return fetchSnap({
    REQUEST: "GetSnapshot",
    TIME: day,
    BBOX: `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`,
    CRS: "EPSG:4326",
    LAYERS: layer,
    FORMAT: "image/jpeg",
    WIDTH: String(w),
    HEIGHT: String(h),
    WRAP: "DAY",
  });
}

async function wvsInstant(
  layer: string,
  time: string,
  bbox: BBox,
  w = 1280,
  h = 720,
): Promise<Snap | null> {
  return fetchSnap({
    REQUEST: "GetSnapshot",
    TIME: time,
    BBOX: `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`,
    CRS: "EPSG:4326",
    LAYERS: layer,
    FORMAT: "image/jpeg",
    WIDTH: String(w),
    HEIGHT: String(h),
  });
}

async function esriStill(bbox: BBox, w = 1280, h = 720): Promise<Snap | null> {
  const url =
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export` +
    `?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}` +
    `&bboxSR=4326&imageSR=4326&size=${w},${h}&format=jpg&f=image`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 14000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 8000) return null;
    return {
      dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
      acquired: null,
      present: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function firstDaily(
  layers: string[],
  day: string,
  bbox: BBox,
  w?: number,
  h?: number,
) {
  for (const layer of layers) {
    const snap = await wvsDaily(layer, day, bbox, w, h);
    if (snap) return { snap, layer };
  }
  const offsets = [1, -1, 2, -2, 3, -3, 5, -5];
  for (const off of offsets) {
    const d = addDays(day, off);
    for (const layer of layers) {
      const snap = await wvsDaily(layer, d, bbox, w, h);
      if (snap) return { snap, layer };
    }
  }
  return null;
}

function visibleDailyLayers(at: number) {
  if (at >= VIIRS_START) {
    return [
      "VIIRS_SNPP_CorrectedReflectance_TrueColor",
      "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
      "MODIS_Terra_CorrectedReflectance_TrueColor",
    ];
  }
  if (at >= MODIS_START) return ["MODIS_Terra_CorrectedReflectance_TrueColor"];
  return [] as string[];
}

export async function fetchRealBand(
  sighting: Sighting,
  band: SpectrumBand,
): Promise<{ src: string; source: string; capturedAt: string | null; note: string } | null> {
  const bbox = bboxFor(sighting.lat, sighting.lng);
  const at = Date.parse(sighting.occurredAt);
  const day = dayStamp(sighting.occurredAt);
  const daylit = isDaylight(sighting.occurredAt, sighting.lng);
  const geo = Date.now() - at < GEO_MS ? geoSat(sighting.lat, sighting.lng) : null;
  const instant = round10(sighting.occurredAt);

  const pack = (snap: Snap, source: string, note: string) => ({
    src: snap.dataUrl,
    source,
    capturedAt: snap.acquired,
    note,
  });

  if (band === "visible") {
    if (geo) {
      const layer = daylit ? geo.visible : geo.infrared;
      const snap = await wvsInstant(layer, instant, bbox);
      if (snap) {
        return pack(
          snap,
          geo.label,
          daylit
            ? `${geo.label} visible at event time`
            : `${geo.label} infrared at event time (local night)`,
        );
      }
    }
    if (!daylit && at >= VIIRS_START) {
      const night = await firstDaily(
        ["VIIRS_SNPP_DayNightBand_At_Sensor_Radiance"],
        day,
        bbox,
      );
      if (night) {
        return pack(night.snap, "NASA VIIRS DNB", "Night lights on the event date");
      }
    }
    const vis = await firstDaily(visibleDailyLayers(at), day, bbox);
    if (vis) {
      const src =
        vis.layer.includes("VIIRS") ? "NASA VIIRS" : vis.layer.includes("MODIS") ? "NASA MODIS" : "NASA GIBS";
      return pack(vis.snap, src, `True-color pass nearest ${day}`);
    }
    const mosaic = await esriStill(bbox);
    if (mosaic) {
      return pack(
        mosaic,
        "Esri World Imagery",
        `Current mosaic of the site — no daily satellite archive for ${day.slice(0, 4)}`,
      );
    }
    return null;
  }

  if (band === "ir") {
    if (geo) {
      const snap = await wvsInstant(geo.infrared, instant, bbox, 960, 540);
      if (snap) return pack(snap, `${geo.label} IR`, "Clean infrared at event time");
    }
    const ir = await firstDaily(
      [
        "VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1",
        "MODIS_Terra_CorrectedReflectance_Bands721",
      ],
      day,
      bbox,
      960,
      540,
    );
    if (ir) {
      return pack(
        ir.snap,
        ir.layer.includes("VIIRS") ? "NASA VIIRS IR" : "NASA MODIS IR",
        `False-color infrared nearest ${day}`,
      );
    }
    return null;
  }

  if (band === "thermal") {
    const layers = daylit
      ? [
          "VIIRS_SNPP_Land_Surface_Temp_Day",
          "MODIS_Terra_Brightness_Temp_Band31_Day",
          "MODIS_Aqua_Land_Surface_Temp_Day",
        ]
      : [
          "VIIRS_SNPP_Brightness_Temp_BandI5_Night",
          "MODIS_Aqua_Brightness_Temp_Band31_Night",
          "VIIRS_SNPP_Land_Surface_Temp_Day",
        ];
    const th = await firstDaily(layers, day, bbox, 960, 540);
    if (th) {
      return pack(th.snap, "NASA land-surface temperature", `Thermal product nearest ${day}`);
    }
    return null;
  }

  if (band === "radar") {
    const radar = await firstDaily(["IMERG_Precipitation_Rate"], day, bbox, 960, 540);
    if (radar) {
      return pack(radar.snap, "NASA GPM IMERG", `Precipitation radar nearest ${day}`);
    }
    return null;
  }

  if (band === "night") {
    const n = await firstDaily(
      ["VIIRS_SNPP_DayNightBand_At_Sensor_Radiance"],
      day,
      bbox,
      960,
      540,
    );
    if (n) return pack(n.snap, "NASA VIIRS DNB", `Day/night band nearest ${day}`);
    if (geo) {
      const snap = await wvsInstant(geo.infrared, instant, bbox, 960, 540);
      if (snap) return pack(snap, `${geo.label} IR`, "Infrared stand-in — no DNB granule");
    }
    return null;
  }

  return null;
}

async function fetchFeedFrames(sighting: Sighting): Promise<AreaFeed> {
  const bbox = bboxFor(sighting.lat, sighting.lng);
  const at = Date.parse(sighting.occurredAt);
  const day = dayStamp(sighting.occurredAt);
  const daylit = isDaylight(sighting.occurredAt, sighting.lng);
  const geo = Date.now() - at < GEO_MS ? geoSat(sighting.lat, sighting.lng) : null;
  const instant = round10(sighting.occurredAt);

  if (geo) {
    const layer = daylit ? geo.visible : geo.infrared;
    const offsets = [-20, -10, 0, 10, 20];
    const snaps = await Promise.all(
      offsets.map((m) => wvsInstant(layer, addMinutes(instant, m), bbox)),
    );
    const frames: Frame[] = [];
    offsets.forEach((m, i) => {
      const snap = snaps[i];
      if (!snap) return;
      frames.push({
        src: snap.dataUrl,
        source: geo.label,
        capturedAt: snap.acquired,
        note: daylit ? "Visible geostationary" : "Infrared geostationary (local night)",
      });
      void m;
    });
    if (frames.length > 0) {
      return {
        frames,
        source: geo.label,
        note: daylit
          ? `${geo.label} visible, ±20 min around the report`
          : `${geo.label} infrared, ±20 min around the report (local night)`,
        timed: true,
      };
    }
  }

  const layers = visibleDailyLayers(at);
  if (layers.length) {
    const days = [-2, -1, 0, 1, 2].map((n) => addDays(day, n));
    const snaps = await Promise.all(days.map((d) => wvsDaily(layers[0]!, d, bbox)));
    const frames: Frame[] = [];
    days.forEach((d, i) => {
      const snap = snaps[i];
      if (!snap) return;
      frames.push({
        src: snap.dataUrl,
        source: layers[0]!.includes("VIIRS") ? "NASA VIIRS" : "NASA MODIS",
        capturedAt: snap.acquired ?? d,
        note: `Daily true-color ${d}`,
      });
    });
    if (frames.length > 0) {
      return {
        frames,
        source: frames[0]!.source,
        note: `Daily true-color window around ${day}`,
        timed: false,
      };
    }
  }

  const vis = await fetchRealBand(sighting, "visible");
  if (vis) {
    return {
      frames: [
        { src: vis.src, source: vis.source, capturedAt: vis.capturedAt, note: vis.note },
      ],
      source: vis.source,
      note: vis.note,
      timed: false,
    };
  }

  return {
    frames: [],
    source: "none",
    note: "No satellite archive for this date and location",
    timed: false,
  };
}

type FrameRow = {
  seq: number;
  source: string;
  captured_at: string | null;
  note: string | null;
  image_data: string;
};

export const loadAreaFeed = createServerFn({ method: "POST" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<AreaFeed | { error: string }> => {
    try {
      const sql = await getSql();
      const sightingRows = await sql<SightingRow>`
        select
          id, lat, lng, location_label, region,
          occurred_at::text as occurred_at,
          shape, duration_sec, summary, classification, confidence, source,
          created_at::text as created_at
        from sightings
        where id = ${data.id}
        limit 1
      `;
      const row = sightingRows[0];
      if (!row) return { error: "Contact not found." };
      const sighting = mapSighting(row);

      const cached = await sql<FrameRow>`
        select seq, source, captured_at::text as captured_at, note, image_data
        from area_frames
        where sighting_id = ${data.id}
        order by seq
      `;
      if (cached.length > 0) {
        return {
          frames: cached.map((f) => ({
            src: f.image_data,
            source: f.source,
            capturedAt: f.captured_at,
            note: f.note,
          })),
          source: cached[0]!.source,
          note: cached[0]!.note ?? cached[0]!.source,
          timed: cached.length > 1,
        };
      }

      const feed = await fetchFeedFrames(sighting);
      for (let i = 0; i < feed.frames.length; i++) {
        const f = feed.frames[i]!;
        await sql.query(
          "insert into area_frames (sighting_id, seq, source, captured_at, note, image_data) values ($1,$2,$3,$4,$5,$6)",
          [data.id, i, f.source, f.capturedAt, f.note, f.src],
        );
      }
      const mid = feed.frames[Math.floor(feed.frames.length / 2)] ?? feed.frames[0];
      if (mid) {
        await sql.query(
          "delete from spectrum_stills where sighting_id = $1 and band = $2",
          [data.id, "visible"],
        );
        await sql.query(
          "insert into spectrum_stills (sighting_id, band, image_data, source, captured_at, note) values ($1,$2,$3,$4,$5,$6)",
          [data.id, "visible", mid.src, mid.source, mid.capturedAt, mid.note],
        );
      }
      return feed;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Archive lookup failed.";
      return { error: msg };
    }
  });
