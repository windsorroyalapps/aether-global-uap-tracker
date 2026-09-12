alter table sightings add column if not exists ai_scored boolean not null default false;
alter table analyses add column if not exists uap_probability integer;
