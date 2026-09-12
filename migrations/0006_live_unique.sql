delete from sightings a
where a.id not in (
  select min(id) from sightings
  group by occurred_at, round(lat::numeric, 2), round(lng::numeric, 2), source
);

create unique index if not exists sightings_event_uidx
  on sightings (occurred_at, round(lat::numeric, 2), round(lng::numeric, 2), source);
