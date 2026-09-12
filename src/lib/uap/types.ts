import { inferSensor, isSensorType, type SensorType } from "./sensors";

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

export const SOURCES = ["archive", "sensor", "field-report", "live"] as const;
export type Source = (typeof SOURCES)[number];

export type { SensorType };

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
  originLabel: string | null;
  originRa: number | null;
  originDec: number | null;
  originDist: string | null;
  uapIndex: number;
  aiScored: boolean;
  sensorType: SensorType;
  latErrDeg: number | null;
  lngErrDeg: number | null;
  timeErrSec: number | null;
  correlated: boolean;
};

export type Analysis = {
  id: number;
  sightingId: number;
  assessment: string;
  likelyOrigin: string;
  threat: "none" | "watch" | "elevated";
  uapProbability: number | null;
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
  sensorType: SensorType;
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
  origin_label?: string | null;
  origin_ra?: number | null;
  origin_dec?: number | null;
  origin_dist?: string | null;
  uap_index?: number | null;
  ai_scored?: boolean | null;
  sensor_type?: string | null;
  lat_err_deg?: number | null;
  lng_err_deg?: number | null;
  time_err_sec?: number | null;
  correlated?: boolean | null;
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
    summary: row.summary,
    classification: row.classification,
    confidence: Number(row.confidence),
    source: row.source,
    createdAt: row.created_at,
    originLabel: row.origin_label ?? null,
    originRa: row.origin_ra == null ? null : Number(row.origin_ra),
    originDec: row.origin_dec == null ? null : Number(row.origin_dec),
    originDist: row.origin_dist ?? null,
    uapIndex: row.uap_index == null ? Number(row.confidence) : Number(row.uap_index),
    aiScored: Boolean(row.ai_scored),
    sensorType: isSensorType(row.sensor_type ?? "")
      ? (row.sensor_type as SensorType)
      : inferSensor({ source: row.source, summary: row.summary, shape: row.shape }),
    latErrDeg: row.lat_err_deg == null ? null : Number(row.lat_err_deg),
    lngErrDeg: row.lng_err_deg == null ? null : Number(row.lng_err_deg),
    timeErrSec: row.time_err_sec == null ? null : Number(row.time_err_sec),
    correlated: Boolean(row.correlated),
  };
}
