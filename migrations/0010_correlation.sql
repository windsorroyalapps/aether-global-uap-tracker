alter table sightings add column if not exists lat_err_deg double precision;
alter table sightings add column if not exists lng_err_deg double precision;
alter table sightings add column if not exists time_err_sec integer;
alter table sightings add column if not exists correlated boolean not null default false;

alter table cross_fixes add column if not exists eo_fix boolean not null default false;
alter table cross_fixes add column if not exists lat_err_deg double precision;
alter table cross_fixes add column if not exists lng_err_deg double precision;
alter table cross_fixes add column if not exists time_err_sec integer;
alter table cross_fixes add column if not exists icao_id text;
alter table cross_fixes add column if not exists metar text;
alter table cross_fixes add column if not exists notam_note text;
alter table cross_fixes add column if not exists correlated boolean not null default false;
