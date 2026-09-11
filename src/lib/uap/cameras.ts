import { CATALOG_CAMERAS, SNAPSHOT_HOSTS, type CatalogCam } from "./catalog-cameras";
import { cached, fetchBuf, fetchJson } from "./cache";
import { loadRegionalDotCameras, type ResolvedCam } from "./dot-cameras";
import { angularDiff, bearingDeg, elevationToTarget, haversineKm, opticalRangeKm } from "./geo";
import type { CameraHit } from "./types";

const g = globalThis as typeof globalThis & {
  __aetherCamIndex__?: Map<string, ResolvedCam>;
};

function index() {
  if (!g.__aetherCamIndex__) {
    g.__aetherCamIndex__ = new Map();
    for (const c of CATALOG_CAMERAS) g.__aetherCamIndex__.set(`catalog:${c.id}`, c);
  }
  return g.__aetherCamIndex__;
}

function remember(id: string, cam: ResolvedCam) {
  index().set(id, cam);
}

export function lookupCamera(id: string) {
  return index().get(id) ?? null;
}

export function isAllowedSnapshot(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (SNAPSHOT_HOSTS.has(u.hostname)) return true;
    if (u.hostname.endsWith(".dot.ca.gov")) return true;
    if (u.hostname.endsWith(".alertcalifornia.org")) return true;
    if (u.hostname.endsWith(".tfl.gov.uk")) return true;
    if (u.hostname.endsWith(".nyctmc.org")) return true;
    if (u.hostname.endsWith(".amazonaws.com") && u.hostname.includes("tfl")) return true;
    if (u.hostname.endsWith(".nesdis.noaa.gov")) return true;
    if (/\b511\b/.test(u.hostname) && /\.(com|org|gov)$/.test(u.hostname)) return true;
    if (u.hostname.endsWith("tripcheck.com")) return true;
    if (u.hostname.endsWith("nvroads.com")) return true;
    return false;
  } catch {
    return false;
  }
}

function toHit(cam: ResolvedCam, id: string, lat: number, lng: number, altM: number | null): CameraHit {
  const distanceKm = haversineKm(cam.lat, cam.lng, lat, lng);
  const bearingToEvent = bearingDeg(cam.lat, cam.lng, lat, lng);
  const elevationDeg = elevationToTarget(cam.lat, cam.lng, 12, lat, lng, altM ?? 350);
  const facing =
    cam.azimuth === null || cam.kind === "space"
      ? true
      : angularDiff(cam.azimuth, bearingToEvent) <= 75;
  const reach = Math.max(cam.viewKm, opticalRangeKm(12, altM ?? 350));
  const inHorizon = cam.kind === "space" || distanceKm <= reach * 1.2;
  const losScore = scoreHit(
    { kind: cam.kind, distanceKm, facing, elevationDeg, inHorizon, viewKm: cam.viewKm },
    altM,
  );
  return {
    id,
    name: cam.name,
    network: cam.network,
    lat: cam.lat,
    lng: cam.lng,
    distanceKm,
    azimuth: cam.azimuth,
    bearingToEvent,
    facing,
    viewKm: cam.viewKm,
    pageUrl: cam.pageUrl,
    kind: cam.kind,
    elevationDeg,
    losScore,
    spectrum: cam.spectrum ?? (cam.kind === "space" ? "geocolor" : "visible"),
  };
}

type AlertFeature = {
  geometry?: { x: number; y: number };
  attributes?: {
    camName?: string;
    camHostname?: string;
    camAzimuth?: number;
    camOffline?: number;
    camPrivate?: number;
    camCounty?: string;
    imgFullURL?: string;
    liveCameraURL?: string;
  };
};

async function loadAlertCA(): Promise<ResolvedCam[]> {
  return cached("alertca-index", 15 * 60_000, async () => {
    const url =
      "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/AlertCA_Cameras_Updated_Includes_Last_Moved_view/FeatureServer/0/query?where=camPrivate=0+AND+camOffline=0&outFields=camName,camHostname,camAzimuth,camOffline,camPrivate,camCounty,imgFullURL,liveCameraURL&returnGeometry=true&outSR=4326&f=json&resultRecordCount=600";
    const json = await fetchJson<{ features?: AlertFeature[] }>(url, { timeoutMs: 12000 });
    const out: ResolvedCam[] = [];
    for (const f of json.features ?? []) {
      const a = f.attributes ?? {};
      const host = a.camHostname?.trim();
      const lng = f.geometry?.x;
      const lat = f.geometry?.y;
      if (!host || lat == null || lng == null) continue;
      if (a.camPrivate) continue;
      const snap = a.imgFullURL?.startsWith("https://")
        ? a.imgFullURL
        : `https://cameras.alertcalifornia.org/public-camera-data/${host}/latest-frame.jpg`;
      const cam: ResolvedCam = {
        id: host,
        name: `${a.camName?.replaceAll("_", " ") ?? host}${a.camCounty ? ` (${a.camCounty})` : ""}`,
        lat,
        lng,
        kind: "sky",
        network: "ALERTCalifornia",
        snapshotPath: snap,
        pageUrl: a.liveCameraURL ?? `https://cameras.alertcalifornia.org/?id=${host}`,
        azimuth: typeof a.camAzimuth === "number" ? a.camAzimuth : null,
        viewKm: 90,
        live: true,
      };
      remember(`alertca:${host}`, cam);
      out.push(cam);
    }
    return out;
  });
}

type NycCam = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isOnline?: string;
  imageUrl?: string;
  area?: string;
};

async function loadNyc(): Promise<ResolvedCam[]> {
  return cached("nyc-cams", 10 * 60_000, async () => {
    const json = await fetchJson<NycCam[]>("https://webcams.nyctmc.org/api/cameras", {
      timeoutMs: 10000,
    });
    const out: ResolvedCam[] = [];
    for (const c of json) {
      if (!c.id || c.isOnline === "false") continue;
      const snap = c.imageUrl ?? `https://webcams.nyctmc.org/api/cameras/${c.id}/image`;
      const cam: ResolvedCam = {
        id: c.id,
        name: c.name || "NYC camera",
        lat: Number(c.latitude),
        lng: Number(c.longitude),
        kind: "traffic",
        network: "NYC DOT",
        snapshotPath: snap,
        pageUrl: "https://webcams.nyctmc.org/",
        azimuth: null,
        viewKm: 8,
        live: true,
      };
      if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lng)) continue;
      remember(`nyc:${c.id}`, cam);
      out.push(cam);
    }
    return out;
  });
}

type TflPlace = {
  id?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: { key?: string; value?: string }[];
};

async function loadTfl(): Promise<ResolvedCam[]> {
  return cached("tfl-jamcam", 10 * 60_000, async () => {
    const json = await fetchJson<TflPlace[]>("https://api.tfl.gov.uk/Place/Type/JamCam", {
      timeoutMs: 10000,
    });
    const out: ResolvedCam[] = [];
    for (const p of json) {
      const props = p.additionalProperties ?? [];
      const image = props.find((x) => x.key === "imageUrl")?.value;
      if (!p.id || p.lat == null || p.lon == null || !image) continue;
      const cam: ResolvedCam = {
        id: p.id,
        name: p.commonName ?? "London JamCam",
        lat: p.lat,
        lng: p.lon,
        kind: "traffic",
        network: "TfL JamCam",
        snapshotPath: image,
        pageUrl: "https://tfl.gov.uk/traffic/status/",
        azimuth: null,
        viewKm: 6,
        live: true,
      };
      remember(`tfl:${p.id}`, cam);
      out.push(cam);
    }
    return out;
  });
}

type CaltransFile = {
  data?: {
    cctv?: {
      inService?: string;
      location?: { locationName?: string; latitude?: string; longitude?: string };
      imageData?: { currentImageURL?: string };
    };
  }[];
};

const CALTRANS_DISTRICTS: { id: string; lat: number; lng: number }[] = [
  { id: "d03", lat: 38.58, lng: -121.49 },
  { id: "d04", lat: 37.77, lng: -122.42 },
  { id: "d05", lat: 35.28, lng: -120.66 },
  { id: "d06", lat: 36.74, lng: -119.77 },
  { id: "d07", lat: 34.05, lng: -118.24 },
  { id: "d08", lat: 34.1, lng: -117.29 },
  { id: "d10", lat: 37.96, lng: -121.29 },
  { id: "d11", lat: 32.72, lng: -117.16 },
  { id: "d12", lat: 33.75, lng: -117.87 },
];

async function loadCaltrans(lat: number, lng: number): Promise<ResolvedCam[]> {
  const near = CALTRANS_DISTRICTS.filter((d) => haversineKm(d.lat, d.lng, lat, lng) < 280).slice(
    0,
    3,
  );
  const packs = await Promise.all(
    near.map((d) =>
      cached(`caltrans-${d.id}`, 8 * 60_000, async () => {
        const num = d.id.slice(1);
        const url = `https://cwwp2.dot.ca.gov/data/${d.id}/cctv/cctvStatusD${num}.json`;
        const json = await fetchJson<CaltransFile>(url, { timeoutMs: 10000 });
        const out: ResolvedCam[] = [];
        for (const row of json.data ?? []) {
          const c = row.cctv;
          if (!c || c.inService === "false") continue;
          const clat = Number(c.location?.latitude);
          const clng = Number(c.location?.longitude);
          const snap = c.imageData?.currentImageURL;
          if (!snap || !Number.isFinite(clat) || !Number.isFinite(clng)) continue;
          const id = `${d.id}:${c.location?.locationName ?? snap}`;
          const cam: ResolvedCam = {
            id,
            name: c.location?.locationName ?? "Caltrans camera",
            lat: clat,
            lng: clng,
            kind: "traffic",
            network: `Caltrans ${d.id.toUpperCase()}`,
            snapshotPath: snap,
            pageUrl: "https://cwwp2.dot.ca.gov/",
            azimuth: null,
            viewKm: 6,
            live: true,
          };
          remember(`caltrans:${id}`, cam);
          out.push(cam);
        }
        return out;
      }).catch(() => [] as ResolvedCam[]),
    ),
  );
  return packs.flat();
}

function inCalifornia(lat: number, lng: number) {
  return lat > 32.4 && lat < 42.1 && lng > -124.6 && lng < -114.0;
}
function inNyc(lat: number, lng: number) {
  return lat > 40.4 && lat < 41.1 && lng > -74.4 && lng < -73.5;
}
function inLondon(lat: number, lng: number) {
  return lat > 51.2 && lat < 51.75 && lng > -0.6 && lng < 0.4;
}

function scoreHit(
  h: {
    kind: CatalogCam["kind"];
    distanceKm: number;
    facing: boolean;
    elevationDeg: number;
    inHorizon: boolean;
    viewKm: number;
  },
  altM: number | null,
) {
  if (h.kind === "space") return h.distanceKm < 9000 ? 18 - h.distanceKm / 2000 : 4;
  if (!h.inHorizon) return -1;
  let s = 100 - h.distanceKm * (h.kind === "sky" ? 0.5 : 1.35);
  if (h.facing) s += 18;
  if (h.kind === "sky") s += 16;
  if (h.kind === "airport") s += 8;
  if (h.kind === "traffic" && h.elevationDeg > 38) s -= 36;
  if (h.kind === "sky" && h.elevationDeg > 8) s += 10;
  if (altM && altM > 5000 && h.kind === "traffic") s -= 8;
  return s;
}

function prefixFor(cam: ResolvedCam) {
  if (cam.network.startsWith("ALERT")) return "alertca";
  if (cam.network.startsWith("NYC")) return "nyc";
  if (cam.network.startsWith("TfL")) return "tfl";
  if (cam.network.startsWith("Caltrans")) return "caltrans";
  if (cam.network.includes("511") || cam.network === "NV Roads" || cam.network.includes("TripCheck")) {
    return "dot";
  }
  return "catalog";
}

function settleCams(p: Promise<ResolvedCam[]>, ms = 4000): Promise<ResolvedCam[]> {
  return Promise.race([
    p,
    new Promise<ResolvedCam[]>((resolve) => setTimeout(() => resolve([]), ms)),
  ]);
}

export async function camerasNear(
  lat: number,
  lng: number,
  altM: number | null,
): Promise<{ ground: CameraHit[]; space: CameraHit[]; total: number }> {
  const tasks: Promise<ResolvedCam[]>[] = [];
  if (inCalifornia(lat, lng)) {
    tasks.push(settleCams(loadAlertCA().catch(() => [])));
    tasks.push(settleCams(loadCaltrans(lat, lng).catch(() => [])));
  }
  if (inNyc(lat, lng)) tasks.push(settleCams(loadNyc().catch(() => [])));
  if (inLondon(lat, lng)) tasks.push(settleCams(loadTfl().catch(() => [])));
  tasks.push(settleCams(loadRegionalDotCameras(lat, lng).catch(() => [])));

  const extra = (await Promise.all(tasks)).flat();
  const pool: { id: string; cam: ResolvedCam }[] = [
    ...CATALOG_CAMERAS.map((c) => ({ id: `catalog:${c.id}`, cam: c })),
    ...extra.map((c) => {
      const id = `${prefixFor(c)}:${c.id}`;
      remember(id, c);
      return { id, cam: c };
    }),
  ];

  const ground: CameraHit[] = [];
  const space: CameraHit[] = [];
  for (const { id, cam } of pool) {
    const hit = toHit(cam, id, lat, lng, altM);
    if (hit.losScore < 0) continue;
    if (cam.kind === "space") space.push(hit);
    else ground.push(hit);
  }
  ground.sort((a, b) => b.losScore - a.losScore || a.distanceKm - b.distanceKm);
  space.sort((a, b) => a.distanceKm - b.distanceKm);
  const ir = space.filter((s) => s.spectrum === "infrared").slice(0, 3);
  const vis = space.filter((s) => s.spectrum !== "infrared").slice(0, 3);
  return { ground: ground.slice(0, 24), space: [...ir, ...vis].slice(0, 6), total: ground.length };
}

export async function snapshotFor(id: string): Promise<{ mime: string; b64: string } | null> {
  const cam = lookupCamera(id);
  if (!cam) return null;
  if (!isAllowedSnapshot(cam.snapshotPath)) return null;
  const { buf, mime } = await fetchBuf(cam.snapshotPath, { timeoutMs: 9000, maxBytes: 2_500_000 });
  const b64 = Buffer.from(buf).toString("base64");
  return { mime: mime.split(";")[0] || "image/jpeg", b64 };
}
