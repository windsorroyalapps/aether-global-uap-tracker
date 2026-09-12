alter table sightings add column if not exists origin_label text;
alter table sightings add column if not exists origin_ra double precision;
alter table sightings add column if not exists origin_dec double precision;
alter table sightings add column if not exists origin_dist text;
alter table sightings add column if not exists uap_index integer;

create table if not exists live_sync (
  id integer primary key,
  synced_at timestamptz not null default now()
);
