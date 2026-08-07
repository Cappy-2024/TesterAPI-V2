# Tester Tracker

A dashboard for viewing tester save data from your Roblox game. When a
player leaves, their data is upserted into Supabase. Admins get a full
roster + analytics; testers can sign in with Discord, prove they own their
Roblox account once, and see their own stats and ranking from then on.

```
roblox/    → server script that sends data to Supabase
supabase/  → SQL schema + the verify-roblox Edge Function
website/   → the static site (now several pages, see below)
```

## Site structure — real, separate pages

Each area of the site is its own URL, and each is just a folder with an
`index.html` in it — the pattern GitHub Pages uses for clean URLs:

```
website/
  index.html            → https://<user>.github.io/<repo>/            (Roster)
  analytics/index.html  → https://<user>.github.io/<repo>/analytics/  (Analytics)
  profile/index.html    → https://<user>.github.io/<repo>/profile/    (My Stats)
  shared/                 common.js, style.css, config.js — used by every page
  assets/                 logo.png
```

**To add another page later:** make a new folder (e.g. `website/reports/`),
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

`website/shared/config.js` is shared by every page now — one file to edit:

```js
window.TESTER_TRACKER_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
};
```

## 4. Deploy the verify-roblox Edge Function

This is new, and it's the one piece that isn't just static files — checking
someone's live Roblox bio and linking their Discord account has to happen
somewhere trusted, not in the browser (more on why below). Supabase Edge
Functions are small serverless functions that live alongside your database:

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run
   `supabase login`.
2. From the `supabase/` folder in this project: `supabase link --project-ref <your-project-ref>`.
3. Deploy it: `supabase functions deploy verify-roblox`.
4. It needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
   available as secrets — these are usually auto-provided to every Edge
   Function already. If the function errors on startup, set them manually:
   ```
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

**Why this can't just be client-side JavaScript:** Roblox's public API
doesn't return the browser-friendly CORS headers needed for a page hosted
on GitHub Pages to call it directly — the request would just fail. And even
if it didn't, only server-side code holding the service role key is allowed
to write `discord_id` onto a players row; the browser's anon key is
deliberately not allowed to (see the RLS policies in `schema.sql`). A tester
could otherwise edit the page's JavaScript in devtools and claim any
account they wanted.

## 5. Host it on GitHub Pages

1. Push the `website/` folder's contents to a repo (root or `/docs`).
2. Repo → **Settings → Pages** → set the source → Save.
3. Visit `https://<user>.github.io/<repo>/analytics/` — GitHub Pages serves
   a folder's `index.html` automatically, so no extra config is needed for
   the new pages.

## 6. Wire up the Roblox side

Unchanged from before — see `roblox/TesterTrackerSender.server.lua`. It
sends the player's whole data table as-is, so `Playtime`/`SessionTime` flow
through automatically once they exist in that table in-game.

## How tester self-verification works

The first time a tester signs in on **My Stats** who isn't already linked:

1. They enter their **Roblox username**.
2. If it matches a tracked players row (and isn't already linked to someone
   else), the site shows a one-time code like `TT-7F3KQ2`.
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

- **Roster / Analytics**: unchanged, admin-only, same as before.
- **My Stats**: any tester signs in, verifies once (above), then sees their
  own Stars/Plasma/Global XP/Playtime/last session, their per-gamemode
  upgrade progress, and a "Where you rank" section showing their placement
  and percentile for each metric against all tracked testers — without ever
  seeing anyone else's individual data.

### About `Playtime` and `SessionTime`

Same fail-safe as before: every place that reads these (roster, analytics,
profile, ranking) treats a missing/non-numeric value as "no data" rather
than 0, so testers without it yet are excluded from averages and rankings
instead of skewing them, and the page shows "—" / "No data yet" instead of
breaking. If your game stores these in a unit other than seconds, adjust
`formatDuration()` in `website/shared/common.js`.

## About future bug-report posts (title + description + photos/videos)

Feasible, and worth answering now even though it's not built yet: Supabase
has built-in file storage (**Supabase Storage**) alongside the database —
you'd create a bucket (e.g. `bug-report-media`), and a signed-in tester's
browser can upload images or short video clips to it directly using their
existing session (no separate file server needed). A `bug_reports` table
would hold the title/description/status/uploader's discord_id, plus the
storage path(s) for any attached media, with an RLS policy so a tester can
create their own reports and read only their own, while admins can read
everyone's. Storage has per-file size limits you configure per bucket
(worth capping video size for cost reasons), and file types can be
restricted to images/video at the bucket level. This slots in cleanly as a
new `website/reports/` page whenever you want to build it — the multi-page
structure and the auth helpers in `shared/common.js` are already set up to
support it.
