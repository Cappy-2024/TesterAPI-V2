# Tester Tracker

A dashboard for viewing tester save data from your Roblox game. When a
player leaves, their data is upserted into Supabase. Admins get a full
roster + analytics; testers can sign in with Discord, prove they own their
Roblox account once, and see their own stats and ranking from then on.

```
roblox/    → server script that sends data to Supabase
supabase/  → SQL schema + the verify-roblox Edge Function
docs/      → the static site (now several pages, see below)
```

## Site structure — real, separate pages

Each area of the site is its own URL, and each is just a folder with an
`index.html` in it — the pattern GitHub Pages uses for clean URLs. The
whole site now lives in a folder called `docs/` specifically (not
`website/`) because GitHub Pages has a built-in "serve from `/docs`"
option — see the hosting section below for why that matters.

```
docs/
  index.html            → https://<user>.github.io/<repo>/            (Roster — admin)
  analytics/index.html  → https://<user>.github.io/<repo>/analytics/  (Analytics — admin)
  admin-reports/        → https://<user>.github.io/<repo>/admin-reports/ (Reports — admin)
  profile/index.html    → https://<user>.github.io/<repo>/profile/    (My Stats — tester)
  reports/index.html    → https://<user>.github.io/<repo>/reports/    (My Reports — tester)
  shared/                 common.js, style.css, config.js — used by every page
  assets/                 logo.png
```

**To add another page later:** make a new folder (e.g. `docs/reports/`),
give it an `index.html` that links `../shared/style.css`, `../shared/config.js`,
`../shared/common.js`, then its own `reports.js`. `shared/common.js` already
has the Supabase client, formatting helpers, and auth helpers every page
needs — you're mostly just writing the page-specific rendering logic. Add a
link to it in the `#pageNav` block in every page's `<header>`.

## How access control works

1. Everyone signs in with **Discord**, handled by Supabase Auth — no
   separate password system.
2. **Roster & Analytics** stay admin-only: a Postgres table, `allowed_admins`,
   lists the Discord IDs allowed in, enforced by Row Level Security (RLS) —
   not just hidden in JavaScript.
3. **My Stats** is open to any signed-in tester, but a Postgres RLS policy
   only ever lets them read the *one* players row linked to their own
   Discord ID (see the verification flow below for how that link gets made).
4. Ranking/placement ("you're #4 of 12 in Global XP") is computed by a
   Postgres function (`get_my_placement`) that runs with elevated privileges
   *inside the database* and only ever returns the caller's own numbers —
   it never hands other testers' rows to the browser, even though it has to
   compare against everyone's data to compute a rank.
5. The Roblox game writes using the **service role key**, which bypasses RLS
   entirely, so saving always works regardless of who can read what.

The anon key in `shared/config.js` is safe to publish — on its own it can't
read or write anything; RLS is what actually locks things down.

## 1. Create / update the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (skip if you
   already have one from before).
2. **SQL Editor** → paste in the full contents of `supabase/schema.sql` →
   Run. This file is safe to re-run in full even if you ran an earlier
   version before — everything in it is written to not duplicate or break
   existing data.
3. Add admins to the allow list (unchanged from before):
   ```sql
   insert into public.allowed_admins (discord_id, label)
   values ('123456789012345678', 'YourName');
   ```

## 2. Set up Discord OAuth

Same as before, with one addition now that there are multiple pages:

1. [Discord Developer Portal](https://discord.com/developers/applications) →
   your app (or a new one) → **OAuth2** → copy the Client ID/Secret.
2. Under OAuth2 → Redirects, make sure this is present:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
3. In Supabase: **Authentication → Providers → Discord** → paste in the
   Client ID/Secret → Save.
4. In Supabase: **Authentication → URL Configuration → Redirect URLs**, add
   a **wildcard** entry covering the whole site rather than one URL per page:
   ```
   https://<user>.github.io/<repo>/**
   ```
   This is important now — each page (`/`, `/analytics/`, `/profile/`, and
   anything you add later) sends people back to wherever they signed in
   from, so a single exact URL in this list won't cover all of them.

## 3. Configure the website

`docs/shared/config.js` is shared by every page now — one file to edit:

```js
window.TESTER_TRACKER_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
};
```

## 4. Deploy the Edge Functions

Two pieces here aren't just static files — checking someone's live Roblox
bio, and posting to a Discord webhook, both have to happen somewhere
trusted, not in the browser (more on why below). Supabase Edge Functions
are small serverless functions that live alongside your database:

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run
   `supabase login`.
2. From this project's **root folder** — the one containing `supabase/`,
   `docs/`, and `roblox/`, not from inside `supabase/` itself — run
   `supabase init` (only needed once, creates `supabase/config.toml`) then
   `supabase link --project-ref <your-project-ref>`.
3. Deploy both functions:
   ```
   supabase functions deploy verify-roblox
   supabase functions deploy redeem-points
   ```
4. They need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
   available as secrets — these are usually auto-provided to every Edge
   Function already. If a function errors on startup, set them manually:
   ```
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
5. `redeem-points` also needs a Discord webhook URL to post redemption logs
   to. Create one in your Discord server: **Channel Settings → Integrations
   → Webhooks → New Webhook** → copy its URL, then:
   ```
   supabase secrets set DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
   If this secret is missing, redemptions still work — they just won't post
   a log message anywhere, silently.

**Why these can't just be client-side JavaScript:** Roblox's public API
doesn't return the browser-friendly CORS headers needed for a page hosted
on GitHub Pages to call it directly — the request would just fail. Discord
webhook URLs are secrets that shouldn't be embedded in a public page's
source at all. And in both cases, only server-side code holding the
service role key is allowed to write to `discord_id` or `points`; the
browser's anon key deliberately can't (see the RLS policies in
`schema.sql`) — otherwise a tester could edit the page's JavaScript in
devtools and grant themselves whatever they wanted.

## 5. Host it on GitHub Pages

1. Push this whole project (`README.md`, `roblox/`, `supabase/`, `docs/`) to
   a repo, keeping `docs/` as a top-level folder — don't move its contents
   to the repo root.
2. Repo → **Settings → Pages** → **Source: Deploy from a branch** → **Branch:
   `main`, folder: `/docs`** → Save.
3. Give it a minute, then visit `https://<user>.github.io/<repo>/` — it'll
   load `docs/index.html` (the roster) directly, and
   `https://<user>.github.io/<repo>/analytics/` etc. work with no extra
   config, since GitHub Pages serves a folder's `index.html` automatically.

**Why `/docs` specifically, and not the repo root:** if you'd pushed the
site's files directly into the repo root instead, GitHub Pages would have
nothing to serve at `/` (no `index.html` there) and would fall back to
rendering your `README.md` as the homepage instead — which is exactly the
"it shows the README" problem this setup avoids. Using the `/docs` folder
as the Pages source also means `roblox/` and `supabase/` never get served
as web pages at all, only `docs/` does.

**One security note while we're on repo structure:** if this repo is
public, anyone can browse `roblox/` and `supabase/` on github.com itself
regardless of your Pages settings — GitHub Pages config only controls what
gets *served as a website*, not what's visible in the repo. So never commit
a copy of `TesterTrackerSender.server.lua` with your **real** service role
key filled in — keep the version in this repo as the placeholder template,
and paste the real key only directly into the Script in Roblox Studio,
which isn't tracked by git at all.

## 6. Wire up the Roblox side

Unchanged from before — see `roblox/TesterTrackerSender.server.lua`. It
sends the player's whole data table as-is, so `Playtime`/`SessionTime` flow
through automatically once they exist in that table in-game.

## How tester self-verification works

The first time a tester signs in on **My Stats** who isn't already linked:

1. They enter their **Roblox username**.
2. If it matches a tracked players row (and isn't already linked to someone
   else), the site shows a one-time string like `k7q2mfr9pj`.
3. They paste that code anywhere in their Roblox bio (Roblox profile → Edit
   Profile → About) and save it.
4. They click **Confirm** — the Edge Function fetches their live Roblox
   profile server-side and checks the bio for the code.
5. On a match, their Discord ID is written onto that players row. Every
   login after that skips straight to their stats — no re-verifying.

Codes expire after 15 minutes and are stored server-side only
(`tester_verifications`, a table the website itself has no read/write
access to); a tester can restart with a different username at any point,
which just overwrites their own pending attempt.

## Using the site

- **Roster**: admin-only. Now also shows each tester's points and has a
  redeem control on each card.
- **Analytics**: admin-only. Now also shows total points outstanding and a
  "Most points" leaderboard.
- **Reports**: admin-only. Review, approve, or reject pending bug reports;
  browse already-approved ones; and a Trash tab for rejected reports.
- **My Stats**: any verified tester — their own stats, points, per-gamemode
  progress, and where they rank against other testers.
- **My Reports**: any verified tester — submit new bug reports and track
  the status of ones they've already sent in.

### About `Playtime` and `SessionTime`

Same fail-safe as before: every place that reads these (roster, analytics,
profile, ranking) treats a missing/non-numeric value as "no data" rather
than 0, so testers without it yet are excluded from averages and rankings
instead of skewing them, and the page shows "—" / "No data yet" instead of
breaking. If your game stores these in a unit other than seconds, adjust
`formatDuration()` in `docs/shared/common.js`.

## Tester points

Points are a **dedicated column** on `players` (`points`), deliberately
kept separate from the `data` JSON blob the Roblox game sends. That's not
an arbitrary choice — the game upserts `data` wholesale every time a player
leaves, so if points lived inside it, the next save would silently
overwrite whatever an admin had just awarded. Keeping it as its own column
means only two things ever touch it: approving a bug report (adds points)
and redeeming points (subtracts them) — never the game sync.

- Testers see their own point balance on **My Stats**.
- Admins see everyone's on the **Roster** (as a chip and in each card's
  detail grid) and in aggregate on **Analytics**.
- Admins redeem points from a tester's roster card: enter an amount, confirm,
  and it's deducted immediately and logged to Discord via the
  `redeem-points` Edge Function (see the deploy step above). If the
  requested amount is more than the tester has, it's rejected with a clear
  error rather than going negative.

**About the `clearance` column on `allowed_admins`:** added now so a later
migration doesn't have to touch existing rows, but nothing reads it yet —
every admin behaves identically today. This is where you'd plug in the
"only some admins can hard-delete from Trash / redeem points" restriction
you mentioned wanting later: add a check like `clearance >= 2` inside
`delete_bug_report()` and the `redeem-points` function once you've decided
what the tiers should mean.

## Bug report system

**For testers (My Reports):** fill in a title, description, severity
(Low/Medium/High), bug type (Scripting/Balancing/Build), environment
(Dev/Main), and optionally up to 3 photos/videos. Submitting inserts a row
directly from the browser — no Edge Function needed here, since Row Level
Security already guarantees a tester can only file a report under their
own linked identity (see the `bug_reports` policies in `schema.sql`).
Reports show up under **Pending** until an admin reviews them, then move to
**Approved** (with the points awarded shown) or simply disappear from the
tester's view if rejected.

**For admins (Reports):** three tabs —

- **Pending** — full details, submitter's username, and any attached
  media. Approve with a points value (credited to the tester immediately)
  or reject.
- **Approved** — a read-only record of what's been approved and for how
  many points.
- **Trash** — rejected reports from the last 7 days, each with a "days
  left" countdown, a **Restore** button (sends it back to Pending), and a
  **Delete forever** button. There's no separate table for this — a
  rejected report *is* the trash; the 7-day window is just measured from
  when it was rejected.

**Automatic 7-day cleanup:** there's a `purge_expired_rejected_reports()`
function that deletes anything rejected more than 7 days ago, but nothing
schedules it to run on its own — true cron scheduling needs the `pg_cron`
extension, which isn't set up here to keep this simpler. Instead, it runs
once, automatically, every time an admin opens the **Trash** tab. In
practice that's plenty for a small tester program; if you want guaranteed
cleanup even when nobody visits Trash for a while, enable `pg_cron` in
Supabase and schedule `select public.purge_expired_rejected_reports();` to
run daily.

**Keeping storage minimal:** `bug_reports` rows never contain the actual
media — only a small JSON array of Storage file paths. The photos/videos
themselves live in a private Supabase Storage bucket
(`bug-report-media`), capped at 25MB/file, and are only ever reachable
through short-lived signed URLs generated for someone who already has
permission to see that report (their own, or an admin). One known gap: hard-deleting a report (from Trash, or automatically after 7 days)
removes the database row but doesn't currently also delete its files from
Storage — those become orphaned. For a small volume of rejected reports
this is unlikely to matter much, but if it becomes a real storage cost,
that cleanup could be added to `delete_bug_report()` and
`purge_expired_rejected_reports()` later.

## Fixing "Where you rank" showing nothing

If you saw no ranking data on My Stats even with several testers tracked,
this was a real bug, now fixed in `schema.sql`: `get_my_placement()` cast
`data->>'Stars'` (etc.) straight to `numeric`, which **throws and aborts
the entire query** if even one tester anywhere has a non-numeric or
malformed value there — not just skips that row. With a small, actively-
evolving set of testers, that's an easy way for the whole ranking feature
to quietly fail for everyone. It now runs every JSON-derived value through
a small `safe_numeric()` helper that treats anything that doesn't look
like a plain number as "no data" instead of erroring out, and Points (a
real integer column, never a risk here) was added as a fifth ranked metric
— so even in the worst case, every tester has at least one metric that's
guaranteed to show. Just re-run the full `schema.sql` to pick this up.
