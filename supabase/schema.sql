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

-- ============================================================================
-- Bug report system + tester points
-- Safe to re-run this whole file — everything below is idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 11. Tester points
--     A dedicated column, deliberately NOT inside `data`. The Roblox script
--     upserts `data` wholesale every time a player leaves — if points lived
--     inside that JSON blob, the next save would silently overwrite
--     whatever an admin had awarded. Keeping it as its own column means it's
--     only ever touched by the approve/redeem functions below, never by the
--     game's save data.
-- ----------------------------------------------------------------------------
alter table public.players add column if not exists points integer not null default 0;

-- Reserved for later: restricting hard-delete and point redemption to
-- specific admins. Not enforced anywhere yet — every admin is clearance 1
-- today, so this changes nothing until that's actually built.
alter table public.allowed_admins add column if not exists clearance integer not null default 1;

-- ----------------------------------------------------------------------------
-- 12. bug_reports
--     `media` only ever holds small JSON metadata (storage paths), never
--     the files themselves — actual photos/videos live in Storage (below),
--     which is what keeps these rows tiny regardless of how much media
--     gets attached.
-- ----------------------------------------------------------------------------
create table if not exists public.bug_reports (
  id                uuid primary key default gen_random_uuid(),
  roblox_user_id    bigint not null references public.players(roblox_user_id) on delete cascade,
  discord_id        text not null,
  title             text not null,
  description       text not null,
  severity          text not null check (severity in ('Low', 'Medium', 'High')),
  bug_type          text not null check (bug_type in ('Scripting', 'Balancing', 'Build')),
  game_environment  text not null check (game_environment in ('Dev', 'Main')),
  media             jsonb not null default '[]'::jsonb,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  points_awarded    integer,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        text
);

create index if not exists bug_reports_status_idx on public.bug_reports (status);
create index if not exists bug_reports_discord_id_idx on public.bug_reports (discord_id);

alter table public.bug_reports enable row level security;

-- A tester can see their own reports (any status)...
drop policy if exists "A tester can read their own bug reports" on public.bug_reports;
create policy "A tester can read their own bug reports"
  on public.bug_reports
  for select
  to authenticated
  using (discord_id = public.current_discord_id());

-- ...and file new ones, but only under their own linked identity — the
-- WITH CHECK also confirms roblox_user_id actually matches the row that's
-- linked to them, so nobody can file a report as a different tester.
drop policy if exists "A tester can submit their own bug report" on public.bug_reports;
create policy "A tester can submit their own bug report"
  on public.bug_reports
  for insert
  to authenticated
  with check (
    discord_id = public.current_discord_id()
    and roblox_user_id = (
      select roblox_user_id from public.players where discord_id = public.current_discord_id()
    )
  );

-- Admins can see every report.
drop policy if exists "Admins can read all bug reports" on public.bug_reports;
create policy "Admins can read all bug reports"
  on public.bug_reports
  for select
  to authenticated
  using (exists (select 1 from public.allowed_admins a where a.discord_id = public.current_discord_id()));

-- No UPDATE/DELETE policies at all, for anyone — approving, rejecting,
-- restoring, and deleting all go through the SECURITY DEFINER functions
-- below, which enforce the admin check and the points bookkeeping in one
-- place instead of trusting the client to do both correctly.

-- ----------------------------------------------------------------------------
-- 13. Storage bucket for bug report media
--     Private bucket — files are only ever reachable through short-lived
--     signed URLs the site generates for someone who already has
--     permission to see that report, never a public link.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bug-report-media',
  'bug-report-media',
  false,
  26214400, -- 25MB per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Testers upload into a folder named after their own Discord ID...
drop policy if exists "Testers upload their own report media" on storage.objects;
create policy "Testers upload their own report media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bug-report-media'
    and (storage.foldername(name))[1] = public.current_discord_id()
  );

-- ...and can read back their own files; admins can read everyone's.
drop policy if exists "Testers and admins can view relevant report media" on storage.objects;
create policy "Testers and admins can view relevant report media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'bug-report-media'
    and (
      (storage.foldername(name))[1] = public.current_discord_id()
      or exists (select 1 from public.allowed_admins a where a.discord_id = public.current_discord_id())
    )
  );

-- ----------------------------------------------------------------------------
-- 14. Small internal helper — raises if the caller isn't an admin.
--     Used by every function below so the admin check lives in one place.
-- ----------------------------------------------------------------------------
create or replace function public.assert_is_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.allowed_admins a where a.discord_id = public.current_discord_id()) then
    raise exception 'Not authorized.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15. approve_bug_report(report_id, points)
--     Approves a pending report and credits the points in one step, so a
--     report can never end up "approved" without the points actually
--     landing (or vice versa).
-- ----------------------------------------------------------------------------
create or replace function public.approve_bug_report(p_report_id uuid, p_points integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roblox_user_id bigint;
begin
  perform public.assert_is_admin();

  if p_points is null or p_points < 0 then
    raise exception 'Points must be zero or a positive number.';
  end if;

  update public.bug_reports
  set status = 'approved',
      points_awarded = p_points,
      decided_at = now(),
      decided_by = public.current_discord_id()
  where id = p_report_id and status = 'pending'
  returning roblox_user_id into v_roblox_user_id;

  if v_roblox_user_id is null then
    raise exception 'That report is no longer pending.';
  end if;

  update public.players set points = points + p_points where roblox_user_id = v_roblox_user_id;
end;
$$;

grant execute on function public.approve_bug_report(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 16. reject_bug_report(report_id)
--     Rejecting just changes status — this IS the "trash": the site shows
--     rejected reports from the last 7 days (measured from decided_at) as
--     the trash view, with no separate table needed.
-- ----------------------------------------------------------------------------
create or replace function public.reject_bug_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  update public.bug_reports
  set status = 'rejected',
      decided_at = now(),
      decided_by = public.current_discord_id()
  where id = p_report_id and status = 'pending';

  if not found then
    raise exception 'That report is no longer pending.';
  end if;
end;
$$;

grant execute on function public.reject_bug_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 17. restore_bug_report(report_id)
--     Pulls a rejected report back out of the trash into the pending queue.
-- ----------------------------------------------------------------------------
create or replace function public.restore_bug_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  update public.bug_reports
  set status = 'pending', decided_at = null, decided_by = null
  where id = p_report_id and status = 'rejected';

  if not found then
    raise exception 'That report is not in the trash.';
  end if;
end;
$$;

grant execute on function public.restore_bug_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 18. delete_bug_report(report_id)
--     Permanently deletes a rejected report before its 7 days are up.
--     (Not gated by clearance yet — see the `clearance` column above.)
-- ----------------------------------------------------------------------------
create or replace function public.delete_bug_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  delete from public.bug_reports where id = p_report_id and status = 'rejected';

  if not found then
    raise exception 'That report is not in the trash.';
  end if;
end;
$$;

grant execute on function public.delete_bug_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 19. purge_expired_rejected_reports()
--     Hard-deletes rejected reports older than 7 days. There's no cron job
--     running this automatically (that needs the pg_cron extension, which
--     isn't enabled by default) — instead, the admin Reports page calls
--     this once whenever the Trash tab is opened, which is a lot simpler
--     to set up and, in practice, plenty for a small tester program. See
--     the README if you'd rather set up true scheduled cleanup later.
-- ----------------------------------------------------------------------------
create or replace function public.purge_expired_rejected_reports()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  delete from public.bug_reports
  where status = 'rejected' and decided_at < now() - interval '7 days';
end;
$$;

grant execute on function public.purge_expired_rejected_reports() to authenticated;

-- ----------------------------------------------------------------------------
-- 20. Update get_my_placement() to include Points, and to stop a single
--     malformed value from breaking ranking for every tester (see #21).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 21. safe_numeric(text)
--     `(data->>'Stars')::numeric` throws and aborts the WHOLE query if even
--     one row anywhere has a non-numeric value there — which, with the
--     "not enough data" fallback message on the client, would silently
--     look like "no ranking data" for every single tester rather than the
--     real error it actually is. This treats a bad value as "no data" for
--     that one row instead of failing the entire function.
-- ----------------------------------------------------------------------------
create or replace function public.safe_numeric(input text)
returns numeric
language sql
immutable
as $$
  select case when input ~ '^-?[0-9]+(\.[0-9]+)?$' then input::numeric else null end;
$$;

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
    select 'Stars' as metric, public.safe_numeric(data->>'Stars') as value, discord_id from public.players
    union all
    select 'Plasma', public.safe_numeric(data->>'Plasma'), discord_id from public.players
    union all
    select 'GlobalXP', public.safe_numeric(data->>'GlobalXP'), discord_id from public.players
    union all
    select 'Playtime', public.safe_numeric(data->>'Playtime'), discord_id from public.players
    union all
    select 'Points', points::numeric, discord_id from public.players
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

-- ============================================================================
-- Resolved reports
-- An approved report can be marked "resolved" (fixed) — it moves into its
-- own tab, visible to the tester who filed it, and auto-deletes 7 days
-- after being resolved, same pattern as the rejected/trash flow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 22. Add 'resolved' as a valid status, and a resolved_at timestamp to
--     measure its own 7-day window from (separate from decided_at, which
--     stays tied to the original approve/reject decision).
--     The DO block below finds whatever the existing status check
--     constraint is actually named (rather than assuming) and replaces it,
--     so this is safe to run whether or not you've run an earlier version
--     of this file before.
-- ----------------------------------------------------------------------------
alter table public.bug_reports add column if not exists resolved_at timestamptz;

do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.bug_reports'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';

  if con_name is not null then
    execute format('alter table public.bug_reports drop constraint %I', con_name);
  end if;
end $$;

alter table public.bug_reports
  add constraint bug_reports_status_check
  check (status in ('pending', 'approved', 'rejected', 'resolved'));

-- ----------------------------------------------------------------------------
-- 23. resolve_bug_report(report_id)
--     Marks an approved report as resolved. No points/players changes here
--     — those already happened at approval time.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_bug_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  update public.bug_reports
  set status = 'resolved', resolved_at = now()
  where id = p_report_id and status = 'approved';

  if not found then
    raise exception 'That report is not approved.';
  end if;
end;
$$;

grant execute on function public.resolve_bug_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 24. purge_expired_resolved_reports()
--     Same lazy-purge pattern as purge_expired_rejected_reports() — the
--     admin Reports page calls this whenever the Resolved tab is opened.
-- ----------------------------------------------------------------------------
create or replace function public.purge_expired_resolved_reports()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  delete from public.bug_reports
  where status = 'resolved' and resolved_at < now() - interval '7 days';
end;
$$;

grant execute on function public.purge_expired_resolved_reports() to authenticated;

-- ============================================================================
-- Rank neighbors (replaces the old "everything at once" ranking view)
-- Powers a dropdown on My Stats: pick a category, see the tester ranked
-- just above you, yourself, and the tester just below you. Much smaller
-- and easier to reason about than the old get_my_placement(), which tried
-- to rank five metrics in one query and, in practice, wasn't showing
-- anything — this is a from-scratch replacement, not a patch of that one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 25. get_rank_neighbors(metric)
--     metric is one of 'Stars' | 'Plasma' | 'GlobalXP' | 'Playtime' | 'Points'.
--     Returns up to 3 rows: whoever's one spot better than you, you, and
--     whoever's one spot worse — fewer at the very top or bottom of the
--     board. Uses row_number() (not rank()) so ties still produce a clean,
--     strictly-ordered list of neighbors rather than a pile of tied rows.
-- ----------------------------------------------------------------------------
create or replace function public.get_rank_neighbors(p_metric text)
returns table (
  username  text,
  value     numeric,
  rnk       bigint,
  total     bigint,
  is_me     boolean
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

  if p_metric not in ('Stars', 'Plasma', 'GlobalXP', 'Playtime', 'Points') then
    raise exception 'Unknown metric: %', p_metric;
  end if;

  return query
  with metrics as (
    select
      p.username,
      p.discord_id,
      case
        when p_metric = 'Points' then p.points::numeric
        else public.safe_numeric(p.data ->> p_metric)
      end as value
    from public.players p
  ),
  ranked as (
    select
      username, discord_id, value,
      row_number() over (order by value desc, discord_id) as rnk,
      count(*) over () as total
    from metrics
    where value is not null
  ),
  my_row as (
    select rnk as my_rnk from ranked where discord_id = my_discord_id
  )
  select r.username, r.value, r.rnk, r.total, (r.discord_id = my_discord_id)
  from ranked r
  join my_row m on r.rnk between m.my_rnk - 1 and m.my_rnk + 1
  order by r.rnk;
end;
$$;

grant execute on function public.get_rank_neighbors(text) to authenticated;
