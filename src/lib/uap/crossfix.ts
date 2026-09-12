import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { solarCosine, subsolar } from "./sky";
import { mapSighting, type Sighting, type SightingRow } from "./types";

export type CrossFix = {
  sightingId: number;
  radarFix: boolean;
  irFix: boolean;
  opticalFix: boolean;
  eoFix: boolean;
  cloudCover: number | null;
  weatherNote: string | null;
  kpIndex: number | null;
  spaceFence: string | null;
  latencySec: number | null;
  dumpAt: string;
  latErrDeg: number | null;
  lngErrDeg: number | null;
  timeErrSec: number | null;
  icaoId: string | null;
  metar: string | null;
  notamNote: string | null;
  correlated: boolean;
};

type FixRow = {
  sighting_id: number;
  radar_fix: boolean;
  ir_fix: boolean;
  optical_fix: boolean;
  eo_fix?: boolean;
  cloud_cover: number | null;
  weather_note: string | null;
  kp_index: number | null;
  space_fence: string | null;
  latency_sec: number | null;
  dump_at: string;
  lat_err_deg?: number | null;
  lng_err_deg?: number | null;
  time_err_sec?: number | null;
  icao_id?: string | null;
  metar?: string | null;
  notam_note?: string | null;
  correlated?: boolean | null;
};

function mapFix(row: FixRow): CrossFix {
  return {
    sightingId: row.sighting_id,
    radarFix: Boolean(row.radar_fix),
    irFix: Boolean(row.ir_fix),
    opticalFix: Boolean(row.optical_fix),
    eoFix: Boolean(row.eo_fix),
    cloudCover: row.cloud_cover == null ? null : Number(row.cloud_cover),
    weatherNote: row.weather_note,
    kpIndex: row.kp_index == null ? null : Number(row.kp_index),
    spaceFence: row.space_fence,
    latencySec: row.latency_sec == null ? null : Number(row.latency_sec),
    dumpAt: row.dump_at,
    latErrDeg: row.lat_err_deg == null ? null : Number(row.lat_err_deg),
    lngErrDeg: row.lng_err_deg == null ? null : Number(row.lng_err_deg),
    timeErrSec: row.time_err_sec == null ? null : Number(row.time_err_sec),
    icaoId: row.icao_id ?? null,
    metar: row.metar ?? null,
    notamNote: row.notam_note ?? null,
    correlated: Boolean(row.correlated),
  };
}

function weatherLabel(code: number | null, cloud: number | null) {
  if (cloud != null && cloud >= 80) return "Overcast";
  if (code === 0) return "Clear";
  if (code != null && code <= 3) return "Mostly clear";
  if (code === 45 || code === 48) return "Fog";
  if (code != null && code >= 51 && code < 70) return "Rain";
  if (code != null && code >= 71 && code < 80) return "Snow";
  if (code != null && code >= 80) return "Showers / storm";
  if (cloud != null && cloud < 25) return "Fair";
  if (cloud != null && cloud < 60) return "Broken cloud";
  if (cloud != null) return "Overcast";
  return "Weather unknown";
}

async function fetchWeather(lat: number, lng: number, iso: string) {
  const day = iso.slice(0, 10);
  const age = Date.now() - Date.parse(iso);
  const recent = Number.isFinite(age) && age < 8 * 86400000;
  const url = recent
    ? `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover,visibility,weather_code&past_days=8&forecast_days=1&timezone=UTC`
    : `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${day}&end_date=${day}&hourly=cloud_cover,visibility,weather_code&timezone=UTC`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { cloud: null as number | null, code: null as number | null };
    const body = (await res.json()) as {
      hourly?: { time?: string[]; cloud_cover?: (number | null)[]; weather_code?: (number | null)[] };
    };
    const times = body.hourly?.time ?? [];
    const hour = iso.slice(0, 13);
    let idx = times.findIndex((x) => x.startsWith(hour));
    if (idx < 0) idx = 0;
    return {
      cloud: body.hourly?.cloud_cover?.[idx] ?? null,
      code: body.hourly?.weather_code?.[idx] ?? null,
    };
  } catch {
    return { cloud: null as number | null, code: null as number | null };
  } finally {
    clearTimeout(t);
  }
}

async function fetchKp(iso: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json", {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { time_tag?: string; kp_index?: number; estimated_kp?: number }[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const target = Date.parse(iso);
    let best = rows[rows.length - 1]!;
    let bestD = Infinity;
    for (const r of rows) {
      const d = Math.abs(Date.parse(r.time_tag ?? "") - target);
      if (Number.isFinite(d) && d < bestD) {
        best = r;
        bestD = d;
      }
    }
    const kp = Number(best.estimated_kp ?? best.kp_index);
    return Number.isFinite(kp) ? kp : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function kinematicsRadar(summary: string) {
  return /entry \d/i.test(summary) && !/velocity components incomplete/i.test(summary);
}

function errorBars(lat: number, radar: boolean) {
  const latErr = radar ? 0.12 : 0.32;
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    latErr,
    lngErr: Math.min(1.8, latErr / cos),
    timeErr: radar ? 2 : 45,
  };
}

const HUBS: { icao: string; lat: number; lng: number }[] = [
  { icao: "KJFK", lat: 40.64, lng: -73.78 },
  { icao: "KLAX", lat: 33.94, lng: -118.41 },
  { icao: "KORD", lat: 41.98, lng: -87.91 },
  { icao: "KDEN", lat: 39.86, lng: -104.67 },
  { icao: "KDFW", lat: 32.9, lng: -97.04 },
  { icao: "KMIA", lat: 25.8, lng: -80.29 },
  { icao: "KSEA", lat: 47.45, lng: -122.31 },
  { icao: "PANC", lat: 61.17, lng: -150.0 },
  { icao: "CYYZ", lat: 43.68, lng: -79.63 },
  { icao: "EGLL", lat: 51.48, lng: -0.46 },
  { icao: "LFPG", lat: 49.01, lng: 2.55 },
  { icao: "EDDF", lat: 50.04, lng: 8.56 },
  { icao: "EHAM", lat: 52.31, lng: 4.76 },
  { icao: "LIRF", lat: 41.8, lng: 12.25 },
  { icao: "OMDB", lat: 25.25, lng: 55.36 },
  { icao: "FAOR", lat: -26.13, lng: 28.24 },
  { icao: "FACT", lat: -33.97, lng: 18.6 },
  { icao: "VABB", lat: 19.09, lng: 72.87 },
  { icao: "VIDP", lat: 28.56, lng: 77.1 },
  { icao: "WSSS", lat: 1.36, lng: 103.99 },
  { icao: "RJTT", lat: 35.55, lng: 139.78 },
  { icao: "RKSI", lat: 37.46, lng: 126.44 },
  { icao: "ZBAA", lat: 40.08, lng: 116.58 },
  { icao: "VHHH", lat: 22.31, lng: 113.91 },
  { icao: "YSSY", lat: -33.95, lng: 151.18 },
  { icao: "YMML", lat: -37.67, lng: 144.84 },
  { icao: "NZAA", lat: -37.01, lng: 174.79 },
  { icao: "SCEL", lat: -33.39, lng: -70.79 },
  { icao: "SBGR", lat: -23.44, lng: -46.47 },
  { icao: "MMMX", lat: 19.44, lng: -99.07 },
];

function nearestHub(lat: number, lng: number) {
  let best = HUBS[0]!;
  let bestD = 1e9;
  for (const h of HUBS) {
    const dlat = (h.lat - lat) * 111;
    const dlng = (h.lng - lng) * 111 * Math.cos((lat * Math.PI) / 180);
    const d = dlat * dlat + dlng * dlng;
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return { ...best, km: Math.sqrt(bestD) };
}

function pointInPoly(lat: number, lng: number, coords: { lat: number; lon: number }[]) {
  if (coords.length < 3) return false;
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const yi = coords[i]!.lat;
    const xi = coords[i]!.lon;
    const yj = coords[j]!.lat;
    const xj = coords[j]!.lon;
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

type SigItem = {
  hazard: string;
  qualifier?: string;
  coords?: { lat: number; lon: number }[];
  validTimeFrom?: number;
  validTimeTo?: number;
};

let sigCache: { at: number; items: SigItem[] } | null = null;

async function fetchSigmets(): Promise<SigItem[]> {
  if (sigCache && Date.now() - sigCache.at < 8 * 60_000) return sigCache.items;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://aviationweather.gov/api/data/isigmet?format=json", {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return sigCache?.items ?? [];
    const rows = (await res.json()) as SigItem[];
    const items = Array.isArray(rows) ? rows : [];
    sigCache = { at: Date.now(), items };
    return items;
  } catch {
    return sigCache?.items ?? [];
  } finally {
    clearTimeout(t);
  }
}

async function fetchMetar(icao: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { rawOb?: string; fltCat?: string; visib?: string; cover?: string }[];
    const m = rows[0];
    if (!m) return null;
    return `${icao} ${m.fltCat ?? ""} ${m.cover ?? ""} vis ${m.visib ?? "—"} · ${m.rawOb ?? ""}`.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function probeEo(lat: number, lng: number, iso: string) {
  const span = 1.2;
  const cos = Math.max(0.22, Math.cos((lat * Math.PI) / 180));
  const spanLng = span / cos;
  const south = Math.max(-89.4, lat - span / 2);
  const north = Math.min(89.4, lat + span / 2);
  const day = iso.slice(0, 10);
  const layer =
    Date.parse(iso) >= Date.parse("2012-01-20T00:00:00Z")
      ? "VIIRS_SNPP_CorrectedReflectance_TrueColor"
      : "MODIS_Terra_CorrectedReflectance_TrueColor";
  const params = new URLSearchParams({
    REQUEST: "GetSnapshot",
    TIME: day,
    BBOX: `${south},${lng - spanLng / 2},${north},${lng + spanLng / 2}`,
    CRS: "EPSG:4326",
    LAYERS: layer,
    FORMAT: "image/jpeg",
    WIDTH: "256",
    HEIGHT: "256",
    WRAP: "DAY",
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://wvs.earthdata.nasa.gov/api/v1/snapshot?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: "image/jpeg", "User-Agent": "AETHER-UAP-Console/1.0" },
    });
    return (res.headers.get("data-present") ?? "").toLowerCase() === "true";
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function enrichLiveCrossFix(s: Sighting): Promise<CrossFix | null> {
  const started = Date.now();
  const hub = nearestHub(s.lat, s.lng);
  const [wx, kp, eo, metar, sigs] = await Promise.all([
    fetchWeather(s.lat, s.lng, s.occurredAt),
    fetchKp(s.occurredAt),
    probeEo(s.lat, s.lng, s.occurredAt),
    fetchMetar(hub.icao),
    fetchSigmets(),
  ]);
  const sun = subsolar(new Date(s.occurredAt));
  const day = solarCosine(s.lat, s.lng, sun) > 0.05;
  const radar = kinematicsRadar(s.summary) || s.sensorType === "radar" || s.sensorType === "multi";
  const ir = s.sensorType === "space-ir" || s.sensorType === "infrared" || s.source === "live";
  const optical = !day && (wx.cloud == null || wx.cloud < 45);
  const bars = errorBars(s.lat, radar);
  const nowSec = Date.now() / 1000;
  const hit = sigs.find((g) => {
    const from = Number(g.validTimeFrom ?? 0);
    const to = Number(g.validTimeTo ?? 0);
    if (from && nowSec < from) return false;
    if (to && nowSec > to) return false;
    return pointInPoly(s.lat, s.lng, g.coords ?? []);
  });
  const notam = hit
    ? `SIGMET ${hit.hazard}${hit.qualifier ? ` ${hit.qualifier}` : ""} in error ellipse`
    : `No active SIGMET in ±${bars.latErr.toFixed(2)}° ellipse · nearest ${hub.icao} ${Math.round(hub.km)} km`;
  const latency = Math.max(0, Math.round((started - Date.parse(s.occurredAt)) / 1000));
  const fence = [
    kp != null ? `NOAA Kp ${kp.toFixed(1)}` : "Kp dump missed",
    day ? "dayside" : "nightside",
    `EO ${eo ? "lock" : "gap"}`,
    `IR ${ir ? "lock" : "gap"}`,
    `radar ${radar ? "lock" : "gap"}`,
  ].join(" · ");
  const note = weatherLabel(wx.code, wx.cloud);
  const sql = await getSql();
  const rows = await sql<FixRow>`
    insert into cross_fixes (
      sighting_id, radar_fix, ir_fix, optical_fix, eo_fix, cloud_cover, weather_note,
      kp_index, space_fence, latency_sec, dump_at,
      lat_err_deg, lng_err_deg, time_err_sec, icao_id, metar, notam_note, correlated
    ) values (
      ${s.id}, ${radar}, ${ir}, ${optical}, ${eo}, ${wx.cloud}, ${note},
      ${kp}, ${fence}, ${latency}, now(),
      ${bars.latErr}, ${bars.lngErr}, ${bars.timeErr}, ${hub.icao}, ${metar}, ${notam}, ${true}
    )
    on conflict (sighting_id) do update set
      radar_fix = excluded.radar_fix,
      ir_fix = excluded.ir_fix,
      optical_fix = excluded.optical_fix,
      eo_fix = excluded.eo_fix,
      cloud_cover = excluded.cloud_cover,
      weather_note = excluded.weather_note,
      kp_index = excluded.kp_index,
      space_fence = excluded.space_fence,
      latency_sec = excluded.latency_sec,
      dump_at = excluded.dump_at,
      lat_err_deg = excluded.lat_err_deg,
      lng_err_deg = excluded.lng_err_deg,
      time_err_sec = excluded.time_err_sec,
      icao_id = excluded.icao_id,
      metar = excluded.metar,
      notam_note = excluded.notam_note,
      correlated = excluded.correlated
    returning
      sighting_id, radar_fix, ir_fix, optical_fix, eo_fix, cloud_cover, weather_note,
      kp_index, space_fence, latency_sec, dump_at::text as dump_at,
      lat_err_deg, lng_err_deg, time_err_sec, icao_id, metar, notam_note, correlated
  `;
  await sql`
    update sightings
    set lat_err_deg = ${bars.latErr},
        lng_err_deg = ${bars.lngErr},
        time_err_sec = ${bars.timeErr},
        correlated = true
    where id = ${s.id}
  `;
  return rows[0] ? mapFix(rows[0]) : null;
}

export async function enrichMissingLive(limit = 4) {
  const sql = await getSql();
  const rows = await sql<SightingRow>`
    select
      s.id, s.lat, s.lng, s.location_label, s.region,
      s.occurred_at::text as occurred_at,
      s.shape, s.duration_sec, s.summary, s.classification, s.confidence, s.source,
      s.created_at::text as created_at,
      s.origin_label, s.origin_ra, s.origin_dec, s.origin_dist, s.uap_index, s.ai_scored, s.sensor_type,
      s.lat_err_deg, s.lng_err_deg, s.time_err_sec, s.correlated
    from sightings s
    left join cross_fixes f on f.sighting_id = s.id
    where s.source = 'live' and (f.sighting_id is null or coalesce(s.correlated, false) = false)
    order by s.occurred_at desc
    limit ${limit}
  `;
  await Promise.all(
    rows.map(async (row) => {
      try {
        await enrichLiveCrossFix(mapSighting(row));
      } catch {
        // Keep the board live if a dump fails.
      }
    }),
  );
  return rows.length;
}

export const getCrossFix = createServerFn({ method: "GET" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<CrossFix | null> => {
    const sql = await getSql();
    const rows = await sql<FixRow>`
      select
        sighting_id, radar_fix, ir_fix, optical_fix, eo_fix, cloud_cover, weather_note,
        kp_index, space_fence, latency_sec, dump_at::text as dump_at,
        lat_err_deg, lng_err_deg, time_err_sec, icao_id, metar, notam_note, correlated
      from cross_fixes
      where sighting_id = ${data.id}
      limit 1
    `;
    return rows[0] ? mapFix(rows[0]) : null;
  });
