create table if not exists spectrum_stills (
  id serial primary key,
  sighting_id integer not null references sightings (id),
  band text not null,
  image_data text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists spectrum_stills_sighting_band_uidx
  on spectrum_stills (sighting_id, band);
