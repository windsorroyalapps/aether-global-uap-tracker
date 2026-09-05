create table if not exists sightings (
  id serial primary key,
  lat double precision not null,
  lng double precision not null,
  location_label text not null,
  region text not null,
  occurred_at timestamptz not null,
  shape text not null,
  duration_sec integer,
  summary text not null,
  classification text not null,
  confidence integer not null,
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists sightings_occurred_at_idx on sightings (occurred_at desc);
create index if not exists sightings_region_idx on sightings (region);

create table if not exists analyses (
  id serial primary key,
  sighting_id integer not null references sightings (id),
  assessment text not null,
  likely_origin text not null,
  threat text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists analyses_sighting_id_uidx on analyses (sighting_id);
