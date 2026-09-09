export const CLASSIFICATIONS = [
  "unidentified",
  "anomalous",
  "likely-prosaic",
  "sensor-contact",
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export const SHAPES = [
  "disc",
  "triangle",
  "orb",
  "cylinder",
  "lights",
  "tic-tac",
  "unknown",
] as const;

export type Shape = (typeof SHAPES)[number];

export const SOURCES = [
  "archive",
  "sensor",
  "field-report",
  "adsb",
  "fireball",
  "social",
  "optical",
  "balloon",
  "satellite",
] as const;
export type Source = (typeof SOURCES)[number];

export const REVIEW_STATUSES = ["pending", "ai-reviewed", "admin-reviewed", "held"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type Sighting = {
  id: number;
  lat: number;
  lng: number;
  locationLabel: string;
  region: string;
  occurredAt: string;
  shape: Shape;
  durationSec: number | null;
  summary: string;
  classification: Classification;
  confidence: number;
  source: Source;
  createdAt: string;
  reviewStatus?: ReviewStatus;
  contentHash?: string | null;
};

export type LiveVerdict = {
  contactId: number;
  verdict: "prosaic" | "watch" | "uap-candidate";
  confidence: number;
  likelyOrigin: string;
  assessment: string;
  threat: "none" | "watch" | "elevated";
  opticalNotes: string;
  framesUsed: number;
  spectra: string[];
  at: string;
};

export type Contact = Sighting & {
  live: boolean;
  stream?: string;
  altitudeM?: number | null;
  speedKts?: number | null;
  headingDeg?: number | null;
  verticalFpm?: number | null;
  residual?: number | null;
  reasons?: string[];
  url?: string | null;
  liveVerdict?: LiveVerdict | null;
};

export type Analysis = {
  id: number;
  sightingId: number;
  assessment: string;
  likelyOrigin: string;
  threat: "none" | "watch" | "elevated";
  createdAt: string;
};

export type ReportInput = {
  lat: number;
  lng: number;
  locationLabel: string;
  region: string;
  occurredAt: string;
  shape: Shape;
  durationSec: number | null;
  summary: string;
  callsign: string;
};

export type SightingRow = {
  id: number;
  lat: number;
  lng: number;
  location_label: string;
  region: string;
  occurred_at: string;
  shape: Shape;
  duration_sec: number | null;
  summary: string;
  classification: Classification;
  confidence: number;
  source: Source;
  created_at: string;
  review_status?: string;
  content_hash?: string | null;
};

export function mapSighting(row: SightingRow): Sighting {
  return {
    id: row.id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    locationLabel: row.location_label,
    region: row.region,
    occurredAt: row.occurred_at,
    shape: row.shape,
    durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
    classification: row.classification,
    confidence: Number(row.confidence),
    source: row.source,
    createdAt: row.created_at,
    summary: row.summary,
    reviewStatus: (row.review_status as ReviewStatus) || "admin-reviewed",
    contentHash: row.content_hash ?? null,
  };
}

export function asContact(s: Sighting, extra: Partial<Contact> = {}): Contact {
  return { live: false, ...s, ...extra };
}

export type StreamHealth = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  count?: number;
};

export type Aircraft = {
  hex: string;
  callsign: string;
  lat: number;
  lng: number;
  altFt: number | null;
  gsKts: number | null;
  track: number | null;
  baroRate: number | null;
  type: string | null;
  mil: boolean;
  squawk: string | null;
};

export type CameraHit = {
  id: string;
  name: string;
  network: string;
  lat: number;
  lng: number;
  distanceKm: number;
  azimuth: number | null;
  bearingToEvent: number;
  facing: boolean;
  viewKm: number;
  pageUrl: string | null;
  kind: "sky" | "traffic" | "airport" | "coast" | "space";
  elevationDeg: number;
  losScore: number;
  spectrum: "visible" | "infrared" | "geocolor";
};

export type SpaceWeather = {
  kp: number;
  kpLabel: string;
  aurora: "quiet" | "active" | "storm";
};

export type SolarFlare = {
  class: string;
  flux: number;
};

export type WeatherSnap = {
  cloudCover: number | null;
  visibilityKm: number | null;
  weatherCode: number | null;
  thunder: boolean;
};

export type SafetyNote = {
  level: "info" | "watch" | "elevated";
  label: string;
  note: string;
};

export type Hypothesis = {
  label: string;
  weight: number;
  note: string;
};

export type Balloon = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  altM: number;
  velMs: number | null;
  kind: string | null;
};

export type SatelliteTrack = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  altKm: number;
  az: number | null;
  el: number | null;
  rangeKm: number | null;
};

export type SkyBody = {
  name: string;
  az: number;
  el: number;
};

export type WatchContext = {
  cameras: CameraHit[];
  cameraTotal: number;
  aircraft: Aircraft[];
  balloons: Balloon[];
  satellites: SatelliteTrack[];
  skyBodies: SkyBody[];
  iss: { lat: number; lng: number; altKm: number; distKm: number } | null;
  weather: WeatherSnap | null;
  spaceWeather: SpaceWeather;
  flare: SolarFlare | null;
  hypotheses: Hypothesis[];
  residual: number;
  satelliteViews: CameraHit[];
  safety: SafetyNote[];
};

export type LivePicture = {
  fetchedAt: string;
  detections: Contact[];
  aircraft: Aircraft[];
  balloons: Balloon[];
  satellites: SatelliteTrack[];
  iss: { lat: number; lng: number; altKm: number; velocityKms: number } | null;
  spaceWeather: SpaceWeather;
  flare: SolarFlare | null;
  streams: StreamHealth[];
  verdicts: LiveVerdict[];
};

export type LiveTrackOptics = {
  contactId: number;
  label: string;
  lat: number;
  lng: number;
  residual: number | null;
  cameras: CameraHit[];
  satelliteViews: CameraHit[];
};
