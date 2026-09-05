import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { SEED_CONTACTS } from "./catalog";
import {
  CLASSIFICATIONS,
  SHAPES,
  mapSighting,
  type ReportInput,
  type Sighting,
  type SightingRow,
} from "./types";

async function ensureSeeded() {
  const sql = await getSql();
  const countRows = await sql<{ n: number }>`select count(*)::int as n from sightings`;
  const n = Number(countRows[0]?.n ?? 0);
  if (n > 0) return;

  for (const c of SEED_CONTACTS) {
    await sql`
      insert into sightings (
        lat, lng, location_label, region, occurred_at, shape,
        duration_sec, summary, classification, confidence, source
      ) values (
        ${c.lat}, ${c.lng}, ${c.locationLabel}, ${c.region}, ${c.occurredAt}::timestamptz,
        ${c.shape}, ${c.durationSec}, ${c.summary}, ${c.classification}, ${c.confidence}, ${c.source}
      )
    `;
  }
}

export const listSightings = createServerFn({ method: "GET" }).handler(
  async (): Promise<Sighting[]> => {
    await ensureSeeded();
    const sql = await getSql();
    const rows = await sql<SightingRow>`
      select
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at
      from sightings
      order by occurred_at desc
    `;
    return rows.map(mapSighting);
  },
);

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export const fileReport = createServerFn({ method: "POST" })
  .validator((input: ReportInput) => {
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error("Latitude must be between -90 and 90.");
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error("Longitude must be between -180 and 180.");
    }
    const locationLabel = input.locationLabel.trim().slice(0, 80);
    if (locationLabel.length < 2) throw new Error("Add a location label.");
    const region = input.region.trim().slice(0, 40) || "Unspecified";
    const summary = input.summary.trim().slice(0, 800);
    if (summary.length < 24) {
      throw new Error("Describe the contact in at least a sentence.");
    }
    if (!SHAPES.includes(input.shape)) throw new Error("Unknown shape.");
    const durationSec =
      input.durationSec === null || input.durationSec === undefined
        ? null
        : clamp(Math.round(Number(input.durationSec)), 1, 86400);
    const occurredAt = input.occurredAt || new Date().toISOString();
    if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Invalid time.");
    const callsign = (input.callsign ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 16);
    const stamped =
      callsign.length > 0 ? `[${callsign}] ${summary}` : summary;
    return {
      lat,
      lng,
      locationLabel,
      region,
      occurredAt,
      shape: input.shape,
      durationSec,
      summary: stamped,
      callsign,
    };
  })
  .handler(async ({ data }): Promise<Sighting> => {
    const sql = await getSql();
    await ensureSeeded();
    const rows = await sql<SightingRow>`
      insert into sightings (
        lat, lng, location_label, region, occurred_at, shape,
        duration_sec, summary, classification, confidence, source
      ) values (
        ${data.lat}, ${data.lng}, ${data.locationLabel}, ${data.region},
        ${data.occurredAt}::timestamptz, ${data.shape}, ${data.durationSec},
        ${data.summary}, ${"unidentified"}, ${42}, ${"field-report"}
      )
      returning
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at
    `;
    const row = rows[0];
    if (!row) throw new Error("Report was not stored.");
    return mapSighting(row);
  });

export const classificationOptions = CLASSIFICATIONS;
