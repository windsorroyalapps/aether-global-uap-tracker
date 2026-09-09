import { cached, fetchJson } from "./cache";
import { geoparse } from "./cities";
import { haversineKm, hashId, regionOf } from "./geo";
import type { Aircraft, Contact, SolarFlare, SpaceWeather, StreamHealth, WeatherSnap } from "./types";

function acFrom(raw: Record<string, unknown>, mil = false): Aircraft | null {
  const lat = Number(raw.lat);
  const lng = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const alt = raw.alt_baro;
  const altFt = typeof alt === "number" ? alt : alt === "ground" ? 0 : null;
  return {
    hex: String(raw.hex ?? ""),
    callsign: String(raw.flight ?? "").trim() || "NO-CALL",
    lat,
    lng,
    altFt,
    gsKts: typeof raw.gs === "number" ? raw.gs : null,
    track: typeof raw.track === "number" ? raw.track : null,
    baroRate: typeof raw.baro_rate === "number" ? raw.baro_rate : null,
    type: typeof raw.t === "string" ? raw.t : null,
    mil: mil || raw.dbFlags === 1,
    squawk: typeof raw.squawk === "string" ? raw.squawk : null,
  };
}

type AdsbResp = { ac?: Record<string, unknown>[] };

const HUBS = [
  { name: "Los Angeles", lat: 34.05, lon: -118.25, dist: 110 },
  { name: "New York", lat: 40.75, lon: -73.98, dist: 90 },
  { name: "London", lat: 51.5, lon: -0.12, dist: 90 },
  { name: "Tokyo", lat: 35.68, lon: 139.76, dist: 90 },
  { name: "Sydney", lat: -33.87, lon: 151.21, dist: 90 },
  { name: "Chicago", lat: 41.88, lon: -87.63, dist: 90 },
  { name: "Honolulu", lat: 21.31, lon: -157.86, dist: 80 },
  { name: "Frankfurt", lat: 50.11, lon: 8.68, dist: 90 },
  { name: "Sao Paulo", lat: -23.55, lon: -46.63, dist: 90 },
  { name: "Dubai", lat: 25.2, lon: 55.27, dist: 80 },
  { name: "Seattle", lat: 47.61, lon: -122.33, dist: 80 },
  { name: "Miami", lat: 25.76, lon: -80.19, dist: 80 },
  { name: "Phoenix", lat: 33.45, lon: -112.07, dist: 90 },
  { name: "Denver", lat: 39.74, lon: -104.99, dist: 80 },
  { name: "Washington", lat: 38.91, lon: -77.04, dist: 80 },
  { name: "Las Vegas", lat: 36.17, lon: -115.14, dist: 70 },
  { name: "Vancouver", lat: 49.28, lon: -123.12, dist: 80 },
  { name: "Singapore", lat: 1.35, lon: 103.82, dist: 70 },
  { name: "Melbourne", lat: -37.81, lon: 144.96, dist: 80 },
  { name: "Mexico City", lat: 19.43, lon: -99.13, dist: 80 },
];

async function adsbAround(lat: number, lon: number, distNm: number) {
  const json = await fetchJson<AdsbResp>(
    `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${distNm}`,
    { timeoutMs: 7000 },
  );
  return (json.ac ?? []).map((r) => acFrom(r)).filter((x): x is Aircraft => x !== null);
}

export async function sampleAircraft(): Promise<{ aircraft: Aircraft[]; ok: boolean; detail: string }> {
  return cached("adsb-sample", 40_000, async () => {
    const milP = fetchJson<AdsbResp>("https://api.adsb.lol/v2/mil", { timeoutMs: 7000 })
      .then((j) => (j.ac ?? []).map((r) => acFrom(r, true)).filter((x): x is Aircraft => x !== null))
      .catch(() => [] as Aircraft[]);
    const emerP = fetchJson<AdsbResp>("https://api.adsb.lol/v2/squawk/7700", { timeoutMs: 6000 })
      .then((j) => (j.ac ?? []).map((r) => acFrom(r)).filter((x): x is Aircraft => x !== null))
      .catch(() => [] as Aircraft[]);
    const hubP = Promise.all(
      HUBS.map((h) => adsbAround(h.lat, h.lon, h.dist).catch(() => [] as Aircraft[])),
    );
    const [mil, emer, hubs] = await Promise.all([milP, emerP, hubP]);
    const map = new Map<string, Aircraft>();
    for (const a of [...mil, ...emer, ...hubs.flat()]) {
      if (a.hex) map.set(a.hex, a);
    }
    const aircraft = [...map.values()];
    return {
      aircraft,
      ok: aircraft.length > 0,
      detail: aircraft.length > 0 ? `${aircraft.length} tracks` : "ADS-B unreachable",
    };
  });
}

export async function aircraftNear(lat: number, lng: number, nm = 80) {
  return cached(`adsb-near-${lat.toFixed(1)}-${lng.toFixed(1)}-${nm}`, 25_000, () =>
    adsbAround(lat, lng, nm),
  ).catch(() => [] as Aircraft[]);
}

export async function fetchIss() {
  return cached("iss", 20_000, async () => {
    const j = await fetchJson<{
      latitude: number;
      longitude: number;
      altitude: number;
      velocity: number;
    }>("https://api.wheretheiss.at/v1/satellites/25544", { timeoutMs: 6000 });
    return {
      lat: j.latitude,
      lng: j.longitude,
      altKm: j.altitude,
      velocityKms: j.velocity / 3600,
    };
  });
}

type FireballRow = (string | number | null)[];

export async function fetchFireballs() {
  return cached("fireballs", 15 * 60_000, async () => {
    const j = await fetchJson<{ fields: string[]; data: FireballRow[] }>(
      "https://ssd-api.jpl.nasa.gov/fireball.api?limit=18",
      { timeoutMs: 8000 },
    );
    const idx = Object.fromEntries(j.fields.map((f, i) => [f, i]));
    const out: Contact[] = [];
    for (const row of j.data ?? []) {
      const date = String(row[idx.date] ?? "");
      const latRaw = row[idx.lat];
      const lonRaw = row[idx.lon];
      if (latRaw == null || lonRaw == null || !date) continue;
      let lat = Number(latRaw);
      let lng = Number(lonRaw);
      if (row[idx["lat-dir"]] === "S") lat = -Math.abs(lat);
      if (row[idx["lon-dir"]] === "W") lng = -Math.abs(lng);
      const energy = Number(row[idx.energy] ?? 0);
      const alt = row[idx.alt] == null ? null : Number(row[idx.alt]) * 1000;
      const vel = row[idx.vel] == null ? null : Number(row[idx.vel]);
      const vx = row[idx.vx] == null ? null : Number(row[idx.vx]);
      const vy = row[idx.vy] == null ? null : Number(row[idx.vy]);
      const vz = row[idx.vz] == null ? null : Number(row[idx.vz]);
      let headingDeg: number | null = null;
      let verticalFpm: number | null = null;
      if (vx != null && vy != null && vz != null && Number.isFinite(vx + vy + vz)) {
        const φ = (lat * Math.PI) / 180;
        const λ = (lng * Math.PI) / 180;
        const east = -Math.sin(λ) * vx + Math.cos(λ) * vy;
        const north =
          -Math.sin(φ) * Math.cos(λ) * vx - Math.sin(φ) * Math.sin(λ) * vy + Math.cos(φ) * vz;
        const up = Math.cos(φ) * Math.cos(λ) * vx + Math.cos(φ) * Math.sin(λ) * vy + Math.sin(φ) * vz;
        headingDeg = (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;
        verticalFpm = up * 1000 * 196.85;
      }
      const id = hashId(`fb:${date}:${lat}:${lng}`);
      out.push({
        id,
        lat,
        lng,
        locationLabel: `Fireball ${Math.abs(lat).toFixed(1)}°, ${Math.abs(lng).toFixed(1)}°`,
        region: regionOf(lat, lng),
        occurredAt: date.endsWith("Z") ? date : `${date}Z`,
        shape: "orb",
        durationSec: 4,
        summary: `NASA CNEOS bolide. Radiated energy ${energy || "n/a"} J, altitude ${alt ? `${(alt / 1000).toFixed(0)} km` : "unknown"}${vel ? `, velocity ${vel.toFixed(1)} km/s` : ""}. Treated as a prosaic meteor unless residual kinematics remain after correlation.`,
        classification: energy > 20 ? "unidentified" : "likely-prosaic",
        confidence: energy > 20 ? 58 : 36,
        source: "fireball",
        createdAt: new Date().toISOString(),
        live: true,
        stream: "NASA CNEOS",
        altitudeM: alt,
        speedKts: vel ? vel * 1943.8 : null,
        headingDeg,
        verticalFpm,
        residual: energy > 20 ? 40 : 18,
        reasons: ["bolide / atmospheric entry"],
        url: "https://cneos.jpl.nasa.gov/fireballs/",
      });
    }
    return out;
  });
}

export async function fetchSpaceWeather(): Promise<SpaceWeather> {
  return cached("swpc-kp", 60_000, async () => {
    const j = await fetchJson<{ kp_index?: number; estimated_kp?: number }[]>(
      "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
      { timeoutMs: 6000 },
    );
    const last = j.at(-1);
    const kp = Number(last?.estimated_kp ?? last?.kp_index ?? 0);
    const aurora: SpaceWeather["aurora"] = kp >= 6 ? "storm" : kp >= 4 ? "active" : "quiet";
    const kpLabel = kp >= 6 ? `Kp ${kp.toFixed(1)} storm` : `Kp ${kp.toFixed(1)}`;
    return { kp, kpLabel, aurora };
  }).catch(
    (): SpaceWeather => ({ kp: 0, kpLabel: "Kp unavailable", aurora: "quiet" }),
  );
}

export async function fetchSolarFlare(): Promise<SolarFlare | null> {
  return cached("swpc-xray", 60_000, async () => {
    const j = await fetchJson<{ flux?: number; time_tag?: string }[]>(
      "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
      { timeoutMs: 6000 },
    );
    const last = j.at(-1);
    const flux = Number(last?.flux ?? 0);
    if (!Number.isFinite(flux) || flux <= 0) return null;
    let cls = "A";
    if (flux >= 1e-4) cls = `X${(flux / 1e-4).toFixed(1)}`;
    else if (flux >= 1e-5) cls = `M${(flux / 1e-5).toFixed(1)}`;
    else if (flux >= 1e-6) cls = `C${(flux / 1e-6).toFixed(1)}`;
    else if (flux >= 1e-7) cls = `B${(flux / 1e-7).toFixed(1)}`;
    else cls = `A${(flux / 1e-8).toFixed(1)}`;
    return { class: cls, flux };
  }).catch(() => null);
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherSnap | null> {
  return cached(`meteo-${lat.toFixed(1)}-${lng.toFixed(1)}`, 10 * 60_000, async () => {
    const j = await fetchJson<{
      current?: { cloud_cover?: number; visibility?: number; weather_code?: number };
    }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=cloud_cover,visibility,weather_code`,
      { timeoutMs: 5000 },
    );
    const vis = j.current?.visibility;
    const code = typeof j.current?.weather_code === "number" ? j.current.weather_code : null;
    return {
      cloudCover: typeof j.current?.cloud_cover === "number" ? j.current.cloud_cover : null,
      visibilityKm: typeof vis === "number" ? vis / 1000 : null,
      weatherCode: code,
      thunder: code != null && code >= 95,
    };
  }).catch(() => null);
}

type GdeltArt = { url?: string; title?: string; seendate?: string; sourcecountry?: string };

function newsContact(key: string, title: string, url: string | null, when: string, stream: string): Contact | null {
  const geo = geoparse(title);
  if (!geo) return null;
  return {
    id: hashId(key),
    lat: geo.lat,
    lng: geo.lng,
    locationLabel: geo.name,
    region: regionOf(geo.lat, geo.lng),
    occurredAt: when,
    shape: "unknown",
    durationSec: null,
    summary: title,
    classification: "unidentified",
    confidence: 34,
    source: "social",
    createdAt: new Date().toISOString(),
    live: true,
    stream,
    residual: 50,
    reasons: ["open-source media"],
    url,
  };
}

async function fetchGdelt(): Promise<Contact[]> {
  const q = encodeURIComponent('(UFO OR UAP OR "unidentified aerial" OR "unidentified anomalous")');
  const j = await fetchJson<{ articles?: GdeltArt[] }>(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=20&sort=datedesc&format=json`,
    { timeoutMs: 8000 },
  );
  const out: Contact[] = [];
  for (const a of j.articles ?? []) {
    if (!a.title) continue;
    const when = a.seendate
      ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(8, 10) || "00"}:${a.seendate.slice(10, 12) || "00"}:00Z`
      : new Date().toISOString();
    const c = newsContact(`gdelt:${a.url ?? a.title}`, a.title, a.url ?? null, when, "Open news (GDELT)");
    if (c) out.push(c);
  }
  return out;
}

async function fetchHn(): Promise<Contact[]> {
  const j = await fetchJson<{ hits?: { title?: string; url?: string; objectID?: string; created_at?: string }[] }>(
    "https://hn.algolia.com/api/v1/search?query=UAP%20OR%20UFO%20OR%20%22unidentified%20aerial%22&hitsPerPage=16",
    { timeoutMs: 7000 },
  );
  const out: Contact[] = [];
  for (const h of j.hits ?? []) {
    if (!h.title) continue;
    const when = h.created_at ?? new Date().toISOString();
    const c = newsContact(
      `hn:${h.objectID ?? h.title}`,
      h.title,
      h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      when,
      "Hacker News",
    );
    if (c) out.push(c);
  }
  return out;
}

export async function fetchSocial(): Promise<Contact[]> {
  return cached("news-uap", 8 * 60_000, async () => {
    const [g, h] = await Promise.all([fetchGdelt().catch(() => [] as Contact[]), fetchHn().catch(() => [] as Contact[])]);
    const map = new Map<number, Contact>();
    for (const c of [...g, ...h]) map.set(c.id, c);
    return [...map.values()];
  }).catch(() => [] as Contact[]);
}

export function issFootprintKm(iss: { lat: number; lng: number }, lat: number, lng: number) {
  return haversineKm(iss.lat, iss.lng, lat, lng);
}

export function health(
  id: string,
  label: string,
  ok: boolean,
  detail: string,
  count?: number,
): StreamHealth {
  return { id, label, ok, detail, count };
}
