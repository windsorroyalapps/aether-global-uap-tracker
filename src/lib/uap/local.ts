import { SEED_CONTACTS } from "./catalog";
import { inferSensor } from "./sensors";
import { zenithSky } from "./sky";
import { parseReport } from "./validate";
import type { ReportInput, Sighting } from "./types";

const REPORTS_KEY = "aether:field-reports";

function attachSky(
  s: Omit<
    Sighting,
    | "originLabel"
    | "originRa"
    | "originDec"
    | "originDist"
    | "uapIndex"
    | "aiScored"
    | "sensorType"
    | "latErrDeg"
    | "lngErrDeg"
    | "timeErrSec"
    | "correlated"
  >,
  uapIndex: number,
): Sighting {
  const sky = zenithSky(s.occurredAt, s.lat, s.lng);
  return {
    ...s,
    originLabel: sky.object.name,
    originRa: sky.ra,
    originDec: sky.dec,
    originDist: sky.object.dist,
    uapIndex,
    aiScored: false,
    sensorType: inferSensor(s),
    latErrDeg: null,
    lngErrDeg: null,
    timeErrSec: null,
    correlated: false,
  };
}

function seedSightings(): Sighting[] {
  return SEED_CONTACTS.map((c, i) =>
    attachSky(
      {
        id: i + 1,
        lat: c.lat,
        lng: c.lng,
        locationLabel: c.locationLabel,
        region: c.region,
        occurredAt: c.occurredAt,
        shape: c.shape,
        durationSec: c.durationSec,
        summary: c.summary,
        classification: c.classification,
        confidence: c.confidence,
        source: c.source,
        createdAt: c.occurredAt,
      },
      c.classification === "anomalous" ? Math.max(c.confidence, 55) : c.confidence,
    ),
  );
}

function readReports(): Sighting[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Sighting[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReports(rows: Sighting[]) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(rows.slice(0, 80)));
}

export function loadLocalSightings(): Sighting[] {
  return [...readReports(), ...seedSightings()].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
}

export function fileLocalReport(input: ReportInput): Sighting {
  const data = parseReport(input);
  const existing = readReports();
  const sighting = attachSky(
    {
      id: 10_000 + existing.length + 1,
      lat: data.lat,
      lng: data.lng,
      locationLabel: data.locationLabel,
      region: data.region,
      occurredAt: data.occurredAt,
      shape: data.shape,
      durationSec: data.durationSec,
      summary: data.summary,
      classification: "unidentified",
      confidence: 42,
      source: "field-report",
      createdAt: new Date().toISOString(),
    },
    42,
  );
  writeReports([sighting, ...existing]);
  return sighting;
}

export const STATIC_AI_UNAVAILABLE =
  "AI assessment is not available on GitHub Pages. The globe and tracker still run fully in the browser.";
