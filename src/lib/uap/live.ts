import { getSql } from "@/lib/db";
import { radiantFromEcef, regionFor, zenithSky, uapIndexFor, type SkyHit } from "./sky";
import { inferSensor } from "./sensors";
import { mapSighting, type SightingRow } from "./types";

const FIREBALL_URL =
  "https://ssd-api.jpl.nasa.gov/fireball.api?limit=24&req-loc=true&vel-comp=true";

type Fireball = {
  date: string;
  lat: number;
  lng: number;
  alt: number | null;
  vel: number | null;
  vx: number | null;
  vy: number | null;
  vz: number | null;
  energy: number | null;
  impact: number | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function signed(value: unknown, dir: unknown) {
  const n = num(value);
  if (n === null) return null;
  const d = String(dir ?? "").toUpperCase();
  if (d === "S" || d === "W") return -Math.abs(n);
  return n;
}

function parseFireballs(body: {
  fields?: string[];
  data?: unknown[][];
}): Fireball[] {
  const fields = body.fields ?? [];
  const idx = (name: string) => fields.indexOf(name);
  const out: Fireball[] = [];
  for (const row of body.data ?? []) {
    const date = String(row[idx("date")] ?? "");
    const lat = signed(row[idx("lat")], row[idx("lat-dir")]);
    const lng = signed(row[idx("lon")], row[idx("lon-dir")]);
    if (!date || lat === null || lng === null) continue;
    out.push({
      date,
      lat,
      lng,
      alt: num(row[idx("alt")]),
      vel: num(row[idx("vel")]),
      vx: num(row[idx("vx")]),
      vy: num(row[idx("vy")]),
      vz: num(row[idx("vz")]),
      energy: num(row[idx("energy")]),
      impact: num(row[idx("impact-e")]),
    });
  }
  return out;
}

export function skyForEvent(
  iso: string,
  lat: number,
  lng: number,
  vx?: number | null,
  vy?: number | null,
  vz?: number | null,
): SkyHit {
  if (vx != null && vy != null && vz != null) {
    const rad = radiantFromEcef(iso, vx, vy, vz);
    if (rad) return rad;
  }
  return zenithSky(iso, lat, lng);
}

function isoFromCneos(date: string) {
  return `${date.replace(" ", "T")}Z`;
}

export async function syncLiveDetections(): Promise<void> {
  const sql = await getSql();
  await sql.query(`
    delete from sightings a
    where a.id not in (
      select min(id) from sightings
      group by occurred_at, round(lat::numeric, 2), round(lng::numeric, 2), source
    )
  `);
  const syncRows = await sql<{ synced_at: string }>`
    select synced_at::text as synced_at from live_sync where id = 1
  `;
  const last = syncRows[0]?.synced_at ? Date.parse(syncRows[0].synced_at) : 0;
  const stale = !Number.isFinite(last) || Date.now() - last > 180_000;

  if (stale) {
    try {
      const res = await fetch(FIREBALL_URL, {
        headers: { Accept: "application/json", "User-Agent": "AETHER-UAP-Console/1.0" },
      });
      if (res.ok) {
        const body = (await res.json()) as { fields?: string[]; data?: unknown[][] };
        const events = parseFireballs(body);
        const existing = await sql<{ k: string }>`
          select (occurred_at::text || ':' || round(lat::numeric,2) || ':' || round(lng::numeric,2)) as k
          from sightings
          where source = 'live'
        `;
        const have = new Set(existing.map((r) => r.k));
        for (const ev of events) {
          const iso = isoFromCneos(ev.date);
          const key = `${iso}:${ev.lat.toFixed(2)}:${ev.lng.toFixed(2)}`;
          if (have.has(key)) continue;
          const sky = skyForEvent(iso, ev.lat, ev.lng, ev.vx, ev.vy, ev.vz);
          const uap = uapIndexFor({
            vel: ev.vel,
            alt: ev.alt,
            energy: ev.energy,
            live: true,
          });
          const loc = `Live bolide, ${Math.abs(ev.lat).toFixed(1)}°${ev.lat >= 0 ? "N" : "S"} ${Math.abs(ev.lng).toFixed(1)}°${ev.lng >= 0 ? "E" : "W"}`;
          const bits = [
            `USG sensors recorded a bolide over ${regionFor(ev.lat, ev.lng)}.`,
            ev.alt != null ? `Peak brightness ${ev.alt.toFixed(0)} km.` : null,
            ev.vel != null ? `Entry ${ev.vel.toFixed(1)} km/s.` : "Velocity components incomplete.",
            ev.impact != null ? `Impact energy ~${ev.impact} kt.` : null,
            `Inbound sky direction nearest ${sky.object.name} (${sky.object.dist}), ${sky.sepDeg.toFixed(0)}° off radiant.`,
          ]
            .filter(Boolean)
            .join(" ");
          try {
            await sql.query(
              `insert into sightings (
                lat, lng, location_label, region, occurred_at, shape,
                duration_sec, summary, classification, confidence, source,
                origin_label, origin_ra, origin_dec, origin_dist, uap_index, sensor_type
              ) values ($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
              [
                ev.lat,
                ev.lng,
                loc,
                regionFor(ev.lat, ev.lng),
                iso,
                "orb",
                4,
                bits,
                "sensor-contact",
                uap,
                "live",
                sky.object.name,
                sky.ra,
                sky.dec,
                sky.object.dist,
                uap,
                "space-ir",
              ],
            );
          } catch {
            // Duplicate live event — skip.
          }
        }
      }
    } catch {
      // Keep the board up if CNEOS is unreachable.
    }
    await sql`
      insert into live_sync (id, synced_at) values (1, now())
      on conflict (id) do update set synced_at = now()
    `;
  }

  const missing = await sql<SightingRow>`
    select
      id, lat, lng, location_label, region,
      occurred_at::text as occurred_at,
      shape, duration_sec, summary, classification, confidence, source,
      created_at::text as created_at,
      origin_label, origin_ra, origin_dec, origin_dist, uap_index
    from sightings
    where origin_label is null
  `;
  for (const row of missing) {
    const s = mapSighting(row);
    const sky = zenithSky(s.occurredAt, s.lat, s.lng);
    const uap = uapIndexFor({
      vel: null,
      alt: null,
      energy: null,
      live: s.source === "live",
      classification: s.classification,
      confidence: s.confidence,
    });
    await sql`
      update sightings
      set origin_label = ${sky.object.name},
          origin_ra = ${sky.ra},
          origin_dec = ${sky.dec},
          origin_dist = ${sky.object.dist},
          uap_index = ${uap}
      where id = ${s.id}
    `;
  }

  const noSensor = await sql<{ id: number; source: string; summary: string; shape: string }>`
    select id, source, summary, shape from sightings where sensor_type is null
  `;
  for (const row of noSensor) {
    const sensor = inferSensor(row);
    await sql`update sightings set sensor_type = ${sensor} where id = ${row.id}`;
  }
}
