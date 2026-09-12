import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { SEED_CONTACTS } from "./catalog";
import { enrichMissingLive } from "./crossfix";
import { syncLiveDetections, skyForEvent } from "./live";
import { uapIndexFor } from "./sky";
import {
  CLASSIFICATIONS,
  mapSighting,
  type ReportInput,
  type Sighting,
  type SightingRow,
} from "./types";
import { parseReport } from "./validate";

async function ensureSeeded() {
  const sql = await getSql();
  const countRows = await sql<{ n: number }>`select count(*)::int as n from sightings`;
  const n = Number(countRows[0]?.n ?? 0);
  if (n > 0) return;

  for (const c of SEED_CONTACTS) {
    try {
      await sql`
        insert into sightings (
          lat, lng, location_label, region, occurred_at, shape,
          duration_sec, summary, classification, confidence, source
        ) values (
          ${c.lat}, ${c.lng}, ${c.locationLabel}, ${c.region}, ${c.occurredAt}::timestamptz,
          ${c.shape}, ${c.durationSec}, ${c.summary}, ${c.classification}, ${c.confidence}, ${c.source}
        )
      `;
    } catch {
      // Unique event already present from a parallel boot.
    }
  }
}

export const listSightings = createServerFn({ method: "GET" }).handler(
  async (): Promise<Sighting[]> => {
    await ensureSeeded();
    try {
      await syncLiveDetections();
      await enrichMissingLive(1);
    } catch {
      // Board still loads from archive if the live ingest fails.
    }
    const sql = await getSql();
    const rows = await sql<SightingRow>`
      select
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at,
        origin_label, origin_ra, origin_dec, origin_dist, uap_index, ai_scored, sensor_type,
        lat_err_deg, lng_err_deg, time_err_sec, correlated
      from sightings
      order by occurred_at desc
    `;
    return rows.map(mapSighting);
  },
);

export const fileReport = createServerFn({ method: "POST" })
  .validator((input: ReportInput) => parseReport(input))
  .handler(async ({ data }): Promise<Sighting> => {
    const sql = await getSql();
    await ensureSeeded();
    const sky = skyForEvent(data.occurredAt, data.lat, data.lng);
    const uap = uapIndexFor({
      vel: null,
      alt: null,
      energy: null,
      live: false,
      classification: "unidentified",
      confidence: 42,
    });
    const rows = await sql<SightingRow>`
      insert into sightings (
        lat, lng, location_label, region, occurred_at, shape,
        duration_sec, summary, classification, confidence, source,
        origin_label, origin_ra, origin_dec, origin_dist, uap_index, sensor_type
      ) values (
        ${data.lat}, ${data.lng}, ${data.locationLabel}, ${data.region},
        ${data.occurredAt}::timestamptz, ${data.shape}, ${data.durationSec},
        ${data.summary}, ${"unidentified"}, ${42}, ${"field-report"},
        ${sky.object.name}, ${sky.ra}, ${sky.dec}, ${sky.object.dist}, ${uap},
        ${data.sensorType}
      )
      returning
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at,
        origin_label, origin_ra, origin_dec, origin_dist, uap_index, ai_scored, sensor_type,
        lat_err_deg, lng_err_deg, time_err_sec, correlated
    `;
    const row = rows[0];
    if (!row) throw new Error("Report was not stored.");
    return mapSighting(row);
  });

export const classificationOptions = CLASSIFICATIONS;
