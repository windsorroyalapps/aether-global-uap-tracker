import { cached, fetchJson } from "./cache";
import { haversineKm, inBBox } from "./geo";
import type { CatalogCam } from "./catalog-cameras";

export type ResolvedCam = CatalogCam & { live?: boolean };

type IconeNet = {
  id: string;
  host: string;
  network: string;
  bbox: [number, number, number, number];
};

const ICONE: IconeNet[] = [
  { id: "az", host: "az511.com", network: "AZ 511", bbox: [31.2, -114.9, 37.1, -109.0] },
  { id: "fl", host: "fl511.com", network: "FL 511", bbox: [24.3, -87.7, 31.1, -79.8] },
  { id: "ga", host: "511ga.org", network: "GA 511", bbox: [30.3, -85.7, 35.1, -80.7] },
  { id: "pa", host: "www.511pa.com", network: "PA 511", bbox: [39.6, -80.6, 42.6, -74.6] },
  { id: "ny", host: "www.511ny.org", network: "NY 511", bbox: [40.4, -79.9, 45.1, -71.7] },
  { id: "wi", host: "www.511wi.gov", network: "WI 511", bbox: [42.4, -93.0, 47.2, -86.7] },
  { id: "nv", host: "www.nvroads.com", network: "NV Roads", bbox: [34.9, -120.1, 42.1, -114.0] },
  { id: "ak", host: "www.511.alaska.gov", network: "AK 511", bbox: [51.0, -170.0, 71.6, -129.5] },
];

type IconeRow = {
  id?: number | string;
  location?: string;
  roadway?: string;
  source?: string;
  images?: { id?: number; description?: string; imageUrl?: string; disabled?: boolean; blocked?: boolean }[];
  latLng?: { geography?: { wellKnownText?: string } };
  latitude?: number;
  longitude?: number;
};

function parseIconeLatLng(row: IconeRow): { lat: number; lng: number } | null {
  const wkt = row.latLng?.geography?.wellKnownText;
  if (typeof wkt === "string") {
    const m = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(wkt);
    if (m) return { lng: Number(m[1]), lat: Number(m[2]) };
  }
  if (typeof row.latitude === "number" && typeof row.longitude === "number") {
    return { lat: row.latitude, lng: row.longitude };
  }
  return null;
}

const QUERY = encodeURIComponent(
  JSON.stringify({
    columns: [{ name: "sortId" }],
    order: [],
    start: 0,
    length: 800,
    search: { value: "" },
  }),
);

async function loadIcone(net: IconeNet): Promise<ResolvedCam[]> {
  return cached(`icone-${net.id}`, 40 * 60_000, async () => {
    const json = await fetchJson<{ data?: IconeRow[] }>(
      `https://${net.host}/list/GetData/Cameras?query=${QUERY}&lang=en`,
      { timeoutMs: 14000 },
    );
    const out: ResolvedCam[] = [];
    for (const row of json.data ?? []) {
      const geo = parseIconeLatLng(row);
      const img = (row.images ?? []).find((i) => i.imageUrl && !i.disabled && !i.blocked);
      if (!geo || !img?.imageUrl) continue;
      if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) continue;
      const path = img.imageUrl.startsWith("http")
        ? img.imageUrl
        : `https://${net.host}${img.imageUrl}`;
      const name =
        img.description ||
        row.location ||
        [row.roadway, row.location].filter(Boolean).join(" ") ||
        `${net.network} camera`;
      out.push({
        id: `${net.id}:${row.id ?? img.id}`,
        name,
        lat: geo.lat,
        lng: geo.lng,
        kind: "traffic",
        network: net.network,
        snapshotPath: path,
        pageUrl: `https://${net.host}/`,
        azimuth: null,
        viewKm: 8,
        live: true,
      });
    }
    return out;
  }).catch(() => [] as ResolvedCam[]);
}

type TripFeature = {
  attributes?: {
    cameraId?: number;
    filename?: string;
    latitude?: number;
    longitude?: number;
    title?: string;
    route?: string;
  };
};

async function loadTripCheck(): Promise<ResolvedCam[]> {
  return cached("odot-tripcheck", 40 * 60_000, async () => {
    const json = await fetchJson<{ features?: TripFeature[] }>(
      "https://www.tripcheck.com/Scripts/map/data/cctvinventory.js",
      { timeoutMs: 12000 },
    );
    const out: ResolvedCam[] = [];
    for (const f of json.features ?? []) {
      const a = f.attributes ?? {};
      const lat = Number(a.latitude);
      const lng = Number(a.longitude);
      const file = a.filename?.trim();
      if (!file || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        id: `or:${a.cameraId ?? file}`,
        name: a.title || a.route || "ODOT camera",
        lat,
        lng,
        kind: "traffic",
        network: "ODOT TripCheck",
        snapshotPath: `https://tripcheck.com/RoadCams/cams/${file}`,
        pageUrl: "https://www.tripcheck.com/",
        azimuth: null,
        viewKm: 8,
        live: true,
      });
    }
    return out;
  }).catch(() => [] as ResolvedCam[]);
}

export function dotHosts(): string[] {
  return [...ICONE.map((n) => n.host), "tripcheck.com", "www.tripcheck.com"];
}

export async function loadRegionalDotCameras(lat: number, lng: number): Promise<ResolvedCam[]> {
  const tasks: Promise<ResolvedCam[]>[] = [];
  const nearby = ICONE.filter((n) => inBBox(lat, lng, n.bbox, 90)).slice(0, 2);
  for (const n of nearby) tasks.push(loadIcone(n));
  if (inBBox(lat, lng, [41.9, -124.6, 46.3, -116.4], 80)) tasks.push(loadTripCheck());
  if (tasks.length === 0) return [];
  const packs = await Promise.all(tasks);
  const eventNear = packs.flat().filter((c) => haversineKm(c.lat, c.lng, lat, lng) < 160);
  return eventNear;
}
