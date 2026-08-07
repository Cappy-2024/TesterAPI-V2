-- ============================================================================
-- Tester Tracker — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. players table
--    One row per Roblox player. `data` holds the entire dataTemplate.Template
--    table as jsonb, exactly as it exists in-game.
-- ----------------------------------------------------------------------------
create table if not exists public.players (
  roblox_user_id  bigint primary key,
  username        text not null,
  data            jsonb not null,
  updated_at      timestamptz not null default now()
);

-- Keep updated_at accurate on every upsert
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_players_updated_at on public.players;
create trigger trg_players_updated_at
  before update on public.players
  for each row execute procedure public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. allowed_admins table
--    Manually add the Discord user IDs of testers who are allowed to view
--    the dashboard. Right-click a user in Discord (Developer Mode on) and
--    "Copy User ID" to get this value.
-- ----------------------------------------------------------------------------
create table if not exists public.allowed_admins (
  discord_id  text primary key,
  label       text,               -- optional: a name/note so it's clear who this is
  added_at    timestamptz not null default now()
);

-- Example (edit and run separately once you know the real IDs):
-- insert into public.allowed_admins (discord_id, label) values ('123456789012345678', 'YourName');

-- ----------------------------------------------------------------------------
-- 3. Helper: pull the Discord user id out of the logged-in user's JWT.
--    Supabase's Discord OAuth stores the Discord user id in user_metadata,
--    usually under "provider_id" (sometimes "sub"). This checks both.
-- ----------------------------------------------------------------------------
create or replace function public.current_discord_id()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'user_metadata' ->> 'provider_id',
    auth.jwt() -> 'user_metadata' ->> 'sub'
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
--    - players: only readable by logged-in Discord users on the allow-list.
--               No client ever gets insert/update/delete access — the Roblox
--               game writes using the SERVICE ROLE key, which bypasses RLS.
--    - allowed_admins: a logged-in user may check ONLY their own row, so the
--               website can tell "not authorized" apart from "no players yet".
-- ----------------------------------------------------------------------------
alter table public.players enable row level security;
alter table public.allowed_admins enable row level security;

drop policy if exists "Admins can read players" on public.players;
create policy "Admins can read players"
  on public.players
  for select
  to authenticated
  using (
    exists (
      select 1 from public.allowed_admins a
      where a.discord_id = public.current_discord_id()
    )
  );

drop policy if exists "A user can check their own admin status" on public.allowed_admins;
create policy "A user can check their own admin status"
  on public.allowed_admins
  for select
  to authenticated
  using (discord_id = public.current_discord_id());

-- No insert/update/delete policies are created for the "authenticated" role
-- on either table, so the website (anon/authenticated key) can never write —
-- only the service_role key used by the Roblox server can.

-- ----------------------------------------------------------------------------
-- 5. Enable Discord as an auth provider
--    Dashboard → Authentication → Providers → Discord → toggle on, then
--    paste in a Client ID / Secret from a Discord application
--    (https://discord.com/developers/applications → OAuth2).
--    Under that Discord app's OAuth2 settings, add this redirect URL:
--       https://<your-project-ref>.supabase.co/auth/v1/callback
--    Also add your GitHub Pages URL under Supabase → Authentication → URL
--    Configuration → Redirect URLs, e.g. https://yourname.github.io/tester-tracker/
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Tester self-service verification
-- Lets any tester (not just admins) link their Discord account to their own
-- players row by proving Roblox ownership via a one-time code in their bio,
-- then view their own stats and ranking. Safe to re-run this whole file —
-- everything below is idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 6. Link column on players
--    Nullable until a tester verifies. The unique index (ignoring nulls)
--    stops one Discord account from being linked to more than one row.
-- ----------------------------------------------------------------------------
alter table public.players add column if not exists discord_id text;

create unique index if not exists players_discord_id_key
  on public.players (discord_id)
  where discord_id is not null;

-- ----------------------------------------------------------------------------
-- 7. tester_verifications
--    Holds the one-time code for a pending "prove you own this Roblox
--    account" attempt. Only the verify-roblox Edge Function (using the
--    service role key) ever touches this table — RLS is enabled with NO
--    policies for the authenticated/anon roles, so the website itself can
--    never read or forge a code.
-- ----------------------------------------------------------------------------
create table if not exists public.tester_verifications (
  id              uuid primary key default gen_random_uuid(),
  discord_id      text not null,
  roblox_user_id  bigint not null references public.players(roblox_user_id) on delete cascade,
  code            text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '15 minutes')
);

-- One pending attempt per Discord account — starting over overwrites it.
create unique index if not exists tester_verifications_discord_id_key
  on public.tester_verifications (discord_id);

alter table public.tester_verifications enable row level security;
-- (No policies added on purpose — only the service role can touch this table.)

-- ----------------------------------------------------------------------------
-- 8. Let a tester read their own linked row
--    Additive to the admin policy from section 4 — Postgres OR's multiple
--    permissive policies together, so admins still see everyone and a
--    verified tester additionally sees the one row that's theirs.
-- ----------------------------------------------------------------------------
drop policy if exists "A tester can read their own linked row" on public.players;
create policy "A tester can read their own linked row"
  on public.players
  for select
  to authenticated
  using (discord_id = public.current_discord_id());

-- ----------------------------------------------------------------------------
-- 9. get_my_placement()
--    Returns the calling tester's rank/percentile for each numeric metric,
--    computed across ALL testers, WITHOUT ever exposing other testers' rows
--    to the client — it's security definer (runs with elevated privileges)
--    and only ever returns rows matching the caller's own discord_id.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_placement()
returns table (
  metric      text,
  my_value    numeric,
  rank        bigint,
  total       bigint,
  percentile  numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  my_discord_id text := public.current_discord_id();
begin
  if my_discord_id is null then
    raise exception 'Not authenticated';
  end if;

  return query
  with metrics as (
    select 'Stars' as metric, (data->>'Stars')::numeric as value, discord_id from public.players where data ? 'Stars'
    union all
    select 'Plasma', (data->>'Plasma')::numeric, discord_id from public.players where data ? 'Plasma'
    union all
    select 'GlobalXP', (data->>'GlobalXP')::numeric, discord_id from public.players where data ? 'GlobalXP'
    union all
    select 'Playtime', (data->>'Playtime')::numeric, discord_id from public.players where data ? 'Playtime'
  ),
  ranked as (
    select
      metric, value, discord_id,
      rank() over (partition by metric order by value desc) as rnk,
      count(*) over (partition by metric) as total
    from metrics
    where value is not null
  )
  select
    metric,
    value,
    rnk,
    total,
    round(100 * (1 - (rnk - 1)::numeric / greatest(total - 1, 1)), 1) as percentile
  from ranked
  where discord_id = my_discord_id;
end;
$$;

grant execute on function public.get_my_placement() to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Deploy the verify-roblox Edge Function (see supabase/functions/) and
--     set its secrets — full walkthrough is in the project README.
-- ----------------------------------------------------------------------------
