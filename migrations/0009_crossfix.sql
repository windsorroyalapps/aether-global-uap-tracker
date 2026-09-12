create table if not exists cross_fixes (
  sighting_id integer primary key references sightings (id),
  radar_fix boolean not null default false,
  ir_fix boolean not null default false,
  optical_fix boolean not null default false,
  cloud_cover integer,
  weather_note text,
  kp_index double precision,
  space_fence text,
  latency_sec integer,
  dump_at timestamptz not null default now()
);
