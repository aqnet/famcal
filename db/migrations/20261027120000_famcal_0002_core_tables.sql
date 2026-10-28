-- Core tables for Phase 0/1. Everything lives in the famcal schema; RLS is on with no
-- anon/authenticated policies, and the app reads it only from the server.

-- Who may use famcal. user_id is an auth.users id; no foreign key, so nothing is added to
-- the shared auth schema.
create table famcal.members (
  user_id uuid primary key,
  email text not null,
  added_by uuid,
  added_at timestamptz not null default now()
);

-- One household row (v1 is single-tenant).
create table famcal.household (
  id smallint primary key default 1 check (id = 1),
  weather_zip text,
  weather_place text,
  weather_lat double precision,
  weather_lon double precision,
  units text not null default 'F' check (units in ('F', 'C')),
  outdoor_keywords text[] not null default array['soccer', 'park', 'hike', 'game', 'practice', 'beach', 'bike'],
  rotation_seconds integer not null default 20 check (rotation_seconds between 5 and 600),
  night_start time not null default '21:00',
  night_end time not null default '06:30',
  -- [{ "name": "Mom", "email": "…" }]
  family_members jsonb not null default '[]'::jsonb,
  -- [{ "url", "nodeId", "name", "type", "directOnly", "keyword", "newest", "galleryCount", "photoCount" }]
  photo_sources jsonb not null default '[]'::jsonb,
  pin_hash text,
  pin_failed integer not null default 0,
  pin_locked_until timestamptz,
  pin_lockout_seconds integer not null default 300,
  updated_at timestamptz not null default now()
);
insert into famcal.household default values;

-- Connected Google accounts; refresh tokens are AES-256-GCM encrypted by the app.
create table famcal.google_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  picture text,
  refresh_token_enc text not null,
  is_family boolean not null default false,
  status text not null default 'ok' check (status in ('ok', 'reconnect')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- Calendars per account, which ones show, and their colours.
create table famcal.calendars (
  account_id uuid not null references famcal.google_accounts (id) on delete cascade,
  calendar_id text not null,
  summary text not null,
  access_role text not null,
  is_primary boolean not null default false,
  color text not null,
  selected boolean not null default false,
  primary key (account_id, calendar_id)
);

-- Small shared caches (weather, photo lists, recent guests). Serverless has no memory between requests.
create table famcal.cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);

alter table famcal.members enable row level security;
alter table famcal.household enable row level security;
alter table famcal.google_accounts enable row level security;
alter table famcal.calendars enable row level security;
alter table famcal.cache enable row level security;
