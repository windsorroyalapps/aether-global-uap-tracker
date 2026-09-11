import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { hashId } from "./geo";
import { mapSighting, type Contact, type ReviewStatus, type Sighting, type SightingRow } from "./types";

export function sealHash(c: { lat: number; lng: number; occurredAt: string; summary: string }) {
  const raw = `${c.lat.toFixed(4)}|${c.lng.toFixed(4)}|${c.occurredAt}|${c.summary.slice(0, 240)}`;
  return `h${Math.abs(hashId(raw)).toString(16)}`;
}

export async function ensureArchiveSchema() {
  const sql = await getSql();
  await sql.query(
    `ALTER TABLE sightings ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'admin-reviewed'`,
  );
  await sql.query(`ALTER TABLE sightings ADD COLUMN IF NOT EXISTS content_hash text`);
  await sql.query(
    `ALTER TABLE sightings ADD COLUMN IF NOT EXISTS sealed_at timestamptz NOT NULL DEFAULT now()`,
  );
  await sql.query(`
    CREATE TABLE IF NOT EXISTS archive_ledger (
      id serial PRIMARY KEY,
      sighting_id integer,
      action text NOT NULL,
      actor text NOT NULL,
      detail text NOT NULL,
      content_hash text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS archive_replicas (
      id serial PRIMARY KEY,
      peer_id text NOT NULL,
      snapshot_hash text NOT NULL,
      contact_count integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS archive_snapshots (
      id serial PRIMARY KEY,
      snapshot_hash text NOT NULL,
      contact_count integer NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const missing = await sql<{
    id: number;
    lat: number;
    lng: number;
    occurred_at: string;
    summary: string;
  }>`
    select id, lat, lng, occurred_at::text as occurred_at, summary
    from sightings
    where content_hash is null
    limit 500
  `;
  const used = new Set<string>();
  const existing = await sql<{ content_hash: string }>`
    select content_hash from sightings where content_hash is not null
  `;
  for (const row of existing) used.add(row.content_hash);
  for (const r of missing) {
    let hash = sealHash({
      lat: Number(r.lat),
      lng: Number(r.lng),
      occurredAt: r.occurred_at,
      summary: r.summary,
    });
    if (used.has(hash)) hash = `${hash}-${r.id}`;
    used.add(hash);
    await sql`update sightings set content_hash = ${hash} where id = ${r.id} and content_hash is null`;
  }
  try {
    await sql.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS sightings_content_hash_uidx ON sightings (content_hash)`,
    );
  } catch {
    /* duplicate hashes — archive stays append-only without the index */
  }
}

export async function logLedger(
  sightingId: number | null,
  action: string,
  actor: string,
  detail: string,
  contentHash: string | null,
) {
  const sql = await getSql();
  await sql`
    insert into archive_ledger (sighting_id, action, actor, detail, content_hash)
    values (${sightingId}, ${action}, ${actor}, ${detail.slice(0, 800)}, ${contentHash})
  `;
}

export const listQueue = createServerFn({ method: "GET" }).handler(async (): Promise<Sighting[]> => {
  await ensureArchiveSchema();
  const sql = await getSql();
  const rows = await sql<SightingRow>`
    select
      id, lat, lng, location_label, region,
      occurred_at::text as occurred_at,
      shape, duration_sec, summary, classification, confidence, source,
      created_at::text as created_at,
      review_status, content_hash
    from sightings
    where review_status in ('pending', 'held')
    order by created_at desc
    limit 80
  `;
  return rows.map(mapSighting);
});

export const listLedger = createServerFn({ method: "GET" }).handler(async () => {
  await ensureArchiveSchema();
  const sql = await getSql();
  return sql<{ id: number; action: string; actor: string; detail: string; created_at: string }>`
    select id, action, actor, detail, created_at::text as created_at
    from archive_ledger
    order by id desc
    limit 40
  `;
});

async function adminOk(token: string) {
  const { officerTokenOk } = await import("./officer.server");
  if (await officerTokenOk(token)) return true;
  const expected = process.env.ARCHIVE_ADMIN_KEY;
  if (expected) return token === expected;
  return false;
}

export const reviewReport = createServerFn({ method: "POST" })
  .validator((input: { id: number; status: ReviewStatus; token: string; note?: string }) => input)
  .handler(async ({ data }): Promise<Sighting | { error: string }> => {
    if (data.status === "admin-reviewed" && !(await adminOk(data.token))) {
      return { error: "Administrator token rejected." };
    }
    if (data.status === "pending") return { error: "Cannot un-seal a report." };
    await ensureArchiveSchema();
    const sql = await getSql();
    const rows = await sql<SightingRow>`
      update sightings
      set review_status = ${data.status}
      where id = ${data.id}
        and review_status in ('pending', 'held')
      returning
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at,
        review_status, content_hash
    `;
    const row = rows[0];
    if (!row) return { error: "Already sealed or missing." };
    const s = mapSighting(row);
    await logLedger(
      s.id,
      data.status,
      data.status === "admin-reviewed" ? "admin" : "ai",
      data.note ?? data.status,
      s.contentHash ?? null,
    );
    return s;
  });

export type ReplicaRecord = {
  lat: number;
  lng: number;
  locationLabel: string;
  region: string;
  occurredAt: string;
  shape: string;
  durationSec: number | null;
  summary: string;
  classification: string;
  confidence: number;
  source: string;
  reviewStatus: ReviewStatus;
  contentHash: string;
};

export const exportSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  await ensureArchiveSchema();
  const sql = await getSql();
  const rows = await sql<SightingRow>`
    select
      id, lat, lng, location_label, region,
      occurred_at::text as occurred_at,
      shape, duration_sec, summary, classification, confidence, source,
      created_at::text as created_at,
      review_status, content_hash
    from sightings
    order by occurred_at desc
    limit 120
  `;
  const records: ReplicaRecord[] = rows.map((r) => {
    const s = mapSighting(r);
    return {
      lat: s.lat,
      lng: s.lng,
      locationLabel: s.locationLabel,
      region: s.region,
      occurredAt: s.occurredAt,
      shape: s.shape,
      durationSec: s.durationSec,
      summary: s.summary,
      classification: s.classification,
      confidence: s.confidence,
      source: s.source,
      reviewStatus: s.reviewStatus ?? "admin-reviewed",
      contentHash: s.contentHash || sealHash(s),
    };
  });
  return { at: new Date().toISOString(), count: records.length, records };
});

export const ingestReplica = createServerFn({ method: "POST" })
  .validator((input: { peerId: string; records: ReplicaRecord[] }) => input)
  .handler(async ({ data }): Promise<{ inserted: number }> => {
    await ensureArchiveSchema();
    const sql = await getSql();
    let inserted = 0;
    for (const r of data.records.slice(0, 80)) {
      const hash = r.contentHash || sealHash(r);
      const dup = await sql<{ id: number }>`
        select id from sightings where content_hash = ${hash} limit 1
      `;
      if (dup[0]) continue;
      const status: ReviewStatus =
        r.reviewStatus === "pending" || r.reviewStatus === "held" ? r.reviewStatus : r.reviewStatus;
      try {
        const rows = await sql<{ id: number }>`
          insert into sightings (
            lat, lng, location_label, region, occurred_at, shape,
            duration_sec, summary, classification, confidence, source,
            review_status, content_hash
          ) values (
            ${r.lat}, ${r.lng}, ${r.locationLabel.slice(0, 80)}, ${r.region.slice(0, 40)},
            ${r.occurredAt}::timestamptz, ${r.shape}, ${r.durationSec}, ${r.summary.slice(0, 800)},
            ${r.classification}, ${r.confidence}, ${r.source},
            ${status}, ${hash}
          )
          returning id
        `;
        if (rows[0]) {
          inserted += 1;
          await logLedger(rows[0].id, "replicate", `p2p:${data.peerId.slice(0, 24)}`, "peer merge", hash);
        }
      } catch {
        /* unique race — already sealed */
      }
    }
    await sql`
      insert into archive_replicas (peer_id, snapshot_hash, contact_count)
      values (${data.peerId.slice(0, 64)}, ${`n${data.records.length}`}, ${inserted})
    `;
    return { inserted };
  });

export const listSnapshots = createServerFn({ method: "GET" }).handler(async () => {
  await ensureArchiveSchema();
  const sql = await getSql();
  return sql<{ id: number; snapshot_hash: string; contact_count: number; created_at: string }>`
    select id, snapshot_hash, contact_count, created_at::text as created_at
    from archive_snapshots
    order by id desc
    limit 12
  `;
});

export const sealServerBackup = createServerFn({ method: "POST" }).handler(async () => {
  const snap = await exportSnapshot();
  const sql = await getSql();
  const hash = sealHash({
    lat: 0,
    lng: 0,
    occurredAt: snap.at,
    summary: `backup:${snap.count}`,
  });
  await sql`
    insert into archive_snapshots (snapshot_hash, contact_count, payload)
    values (${hash}, ${snap.count}, ${JSON.stringify(snap)}::jsonb)
  `;
  await logLedger(null, "server-backup", "server", `${snap.count} records sealed — no deletions`, hash);
  return { hash, count: snap.count, at: snap.at };
});

export function liveIdentityHash(c: Pick<Contact, "lat" | "lng" | "occurredAt" | "summary" | "source" | "locationLabel" | "url">) {
  if (c.url) {
    return sealHash({ lat: 0, lng: 0, occurredAt: "url", summary: c.url.slice(0, 240) });
  }
  if (c.source === "adsb") {
    return sealHash({
      lat: Number(c.lat.toFixed(1)),
      lng: Number(c.lng.toFixed(1)),
      occurredAt: c.locationLabel,
      summary: `adsb:${c.locationLabel}`,
    });
  }
  return sealHash({
    lat: Number(c.lat.toFixed(2)),
    lng: Number(c.lng.toFixed(2)),
    occurredAt: (c.occurredAt || "").slice(0, 10),
    summary: (c.summary || "").slice(0, 240),
  });
}

export async function sealLiveContacts(list: Contact[]) {
  await ensureArchiveSchema();
  const sql = await getSql();
  let inserted = 0;
  let skipped = 0;
  const sealed: Contact[] = [];
  for (const c of list.slice(0, 40)) {
    const residual = c.residual ?? c.confidence;
    if (c.source !== "fireball" && c.source !== "social" && residual < 28) {
      skipped += 1;
      continue;
    }
    const hash = liveIdentityHash(c);
    const dup = await sql<{ id: number }>`select id from sightings where content_hash = ${hash} limit 1`;
    if (dup[0]) {
      skipped += 1;
      continue;
    }
    try {
      const rows = await sql<{ id: number }>`
        insert into sightings (
          lat, lng, location_label, region, occurred_at, shape,
          duration_sec, summary, classification, confidence, source,
          review_status, content_hash
        ) values (
          ${c.lat}, ${c.lng}, ${c.locationLabel.slice(0, 80)}, ${c.region.slice(0, 40)},
          ${c.occurredAt}::timestamptz, ${c.shape}, ${c.durationSec}, ${c.summary.slice(0, 800)},
          ${c.classification}, ${Math.round(residual)}, ${c.source},
          ${"pending"}, ${hash}
        )
        returning id
      `;
      if (rows[0]) {
        inserted += 1;
        sealed.push({ ...c, id: rows[0].id });
        await logLedger(rows[0].id, "duty-seal", "duty", "auto ingest — no deletions", hash);
      }
    } catch {
      skipped += 1;
    }
  }
  return { inserted, skipped, sealed };
}

export async function writeServerBackup() {
  await ensureArchiveSchema();
  const sql = await getSql();
  const rows = await sql<SightingRow>`
    select
      id, lat, lng, location_label, region,
      occurred_at::text as occurred_at,
      shape, duration_sec, summary, classification, confidence, source,
      created_at::text as created_at,
      review_status, content_hash
    from sightings
    order by occurred_at desc
    limit 120
  `;
  const at = new Date().toISOString();
  const hash = sealHash({ lat: 0, lng: 0, occurredAt: at, summary: `backup:${rows.length}` });
  const payload = JSON.stringify({
    at,
    count: rows.length,
    records: rows.map((r) => {
      const s = mapSighting(r);
      return { ...s, contentHash: s.contentHash || sealHash(s) };
    }),
  });
  await sql`
    insert into archive_snapshots (snapshot_hash, contact_count, payload)
    values (${hash}, ${rows.length}, ${payload}::jsonb)
  `;
  await logLedger(null, "server-backup", "duty", `${rows.length} records sealed — no deletions`, hash);
  return { hash, count: rows.length, at };
}
