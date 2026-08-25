// verify-roblox
//
// Handles the two steps of tester self-verification:
//   { action: "start",   robloxUsername: string }  -> issues a one-time code
//   { action: "confirm" }                           -> checks the Roblox bio
//
// This has to run server-side (as an Edge Function) rather than in the
// browser for two reasons:
//   1. Roblox's public API doesn't allow direct browser fetches (no CORS
//      headers), so the bio check would fail if run from client-side JS.
//   2. Writing `discord_id` onto a players row needs the service role key,
//      which must never be shipped to the browser.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy verify-roblox
//
// Needs these secrets set on the project (Dashboard → Edge Functions →
// verify-roblox → Secrets, or `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (the first three are usually already available to every Edge Function
// automatically — check the dashboard if this errors on startup).

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Avoids visually ambiguous characters (0/O, 1/I, etc).
// A random sequence of emoji rather than letters/numbers — alphanumeric
// strings (hyphenated or not) were getting silently mangled by Roblox's
// bio text filter, which treats that kind of pattern as possible contact
// info. Plain emoji from a curated, moderation-safe pool sidesteps that
// entirely, and they're just as easy to copy-paste and check for.
const EMOJI_POOL = [
  "🍕", "🐸", "🚀", "🎲", "🍩", "🌵", "🦊", "🍎", "🎈", "🐢",
  "🍉", "🎯", "🍔", "🌸", "🦖", "🍪", "🎨", "🐙", "🍇", "🚗",
  "🌈", "🍒", "🦋", "🍋", "🐳", "🎵", "🍓", "🦄", "🍀", "🎪",
  "🐝", "🍑", "🌟", "🐧", "🍰", "🦉", "🍄", "🎸", "🐬", "🍭",
];

function randomCode(count = 4) {
  const pool = [...EMOJI_POOL];
  const chosen: string[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1); // no repeats within one code — easier to eyeball
  }
  return chosen.join(" ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    // Identify the caller from their Supabase session (not from anything
    // the client claims in the request body).
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();

    if (userErr || !user) return json({ error: "You need to be signed in." }, 401);

    const discordId = user.user_metadata?.provider_id || user.user_metadata?.sub;
    if (!discordId) return json({ error: "Couldn't determine your Discord ID." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));

    // ------------------------------------------------------------ start
    if (body.action === "start") {
      const username = String(body.robloxUsername || "").trim();
      if (!username) return json({ error: "Enter a Roblox username." }, 400);

      const { data: playerRow, error: lookupErr } = await admin
        .from("players")
        .select("roblox_user_id, username, discord_id")
        .ilike("username", username)
        .maybeSingle();

      if (lookupErr) {
        console.error("verify-roblox lookup error:", lookupErr);
        return json({ error: "Couldn't look up that username right now. Try again shortly." }, 500);
      }

      if (!playerRow) {
        console.log(`verify-roblox: no players row matched username="${username}"`);
        return json(
          { error: "No tester data found for that username yet. Play a session first, then try again." },
          404
        );
      }
      if (playerRow.discord_id && playerRow.discord_id !== discordId) {
        return json({ error: "That Roblox account is already linked to a different Discord account." }, 409);
      }
      if (playerRow.discord_id === discordId) {
        return json({ alreadyLinked: true, username: playerRow.username });
      }

      const code = randomCode();
      const { error: upsertErr } = await admin.from("tester_verifications").upsert(
        {
          discord_id: discordId,
          roblox_user_id: playerRow.roblox_user_id,
          code,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
        { onConflict: "discord_id" }
      );
      if (upsertErr) return json({ error: "Couldn't start verification. Try again." }, 500);

      return json({ robloxUserId: playerRow.roblox_user_id, username: playerRow.username, code });
    }

    // ---------------------------------------------------------- confirm
    if (body.action === "confirm") {
      const { data: pending } = await admin
        .from("tester_verifications")
        .select("*")
        .eq("discord_id", discordId)
        .maybeSingle();

      if (!pending) return json({ error: "No pending verification found. Start over." }, 404);

      if (new Date(pending.expires_at) < new Date()) {
        await admin.from("tester_verifications").delete().eq("discord_id", discordId);
        return json({ error: "Those emoji expired. Start over to get a new set." }, 410);
      }

      const robloxRes = await fetch(`https://users.roblox.com/v1/users/${pending.roblox_user_id}`);
      if (!robloxRes.ok) return json({ error: "Couldn't reach Roblox's API right now. Try again shortly." }, 502);

      const profile = await robloxRes.json();
      const bio: string = profile?.description || "";

      if (!bio.includes(pending.code)) {
        return json({
          verified: false,
          message: "Those emoji aren't in your bio yet. Make sure you saved it, then try again.",
        });
      }

      const { error: linkErr } = await admin
        .from("players")
        .update({ discord_id: discordId })
        .eq("roblox_user_id", pending.roblox_user_id);
      if (linkErr) return json({ error: "Verified, but couldn't save the link. Try again." }, 500);

      await admin.from("tester_verifications").delete().eq("discord_id", discordId);

      return json({ verified: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("verify-roblox error:", err);
    return json({ error: "Unexpected server error." }, 500);
  }
});
