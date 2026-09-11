create table if not exists push_subscriptions (
  id serial primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_last_seen_idx
  on push_subscriptions (last_seen_at desc);
