alter table spectrum_stills add column if not exists source text not null default 'ai';
alter table spectrum_stills add column if not exists captured_at timestamptz;
alter table spectrum_stills add column if not exists note text;

create table if not exists area_frames (
  id serial primary key,
  sighting_id integer not null references sightings (id),
  seq integer not null,
  source text not null,
  captured_at timestamptz,
  note text,
  image_data text not null
);

create unique index if not exists area_frames_sighting_seq_uidx
  on area_frames (sighting_id, seq);
