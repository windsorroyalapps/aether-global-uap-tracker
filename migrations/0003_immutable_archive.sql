-- Append-only archive. Application code never issues DELETE on sightings.
alter table sightings add column if not exists review_status text not null default 'admin-reviewed';
alter table sightings add column if not exists content_hash text;
alter table sightings add column if not exists sealed_at timestamptz not null default now();

create table if not exists archive_ledger (
  id serial primary key,
  sighting_id integer,
  action text not null,
  actor text not null,
  detail text not null,
  content_hash text,
  created_at timestamptz not null default now()
);

create index if not exists archive_ledger_created_idx on archive_ledger (created_at desc);

create table if not exists archive_replicas (
  id serial primary key,
  peer_id text not null,
  snapshot_hash text not null,
  contact_count integer not null,
  created_at timestamptz not null default now()
);
