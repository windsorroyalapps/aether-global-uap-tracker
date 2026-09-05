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

export const SOURCES = ["archive", "sensor", "field-report"] as const;
export type Source = (typeof SOURCES)[number];

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
  };
}
