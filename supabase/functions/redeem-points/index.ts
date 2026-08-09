// redeem-points
//
// { robloxUserId: number, amount: number, reason?: string }
//
// Admin-only. Deducts `amount` from a tester's points and posts a log
// message to a Discord webhook. Runs as an Edge Function (rather than a
// plain database RPC like the bug-report actions) specifically because
// logging to Discord means making an outbound HTTP call, which Postgres
// can't do without extra setup — this can just fetch() it directly.
//
// Deploy: supabase functions deploy redeem-points
// Needs the same secrets as verify-roblox, plus one more:
//   DISCORD_WEBHOOK_URL — a webhook URL from the Discord channel you want
//   redemption logs posted to (Channel Settings → Integrations → Webhooks).
// Set it with: supabase secrets set DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_WEBHOOK_URL = Deno.env.get("DISCORD_WEBHOOK_URL");

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
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

    const { data: adminRow } = await admin
      .from("allowed_admins")
      .select("discord_id")
      .eq("discord_id", discordId)
      .maybeSingle();
    if (!adminRow) return json({ error: "You're not authorized to do that." }, 403);

    const body = await req.json().catch(() => ({}));
    const robloxUserId = Number(body.robloxUserId);
    const amount = Number(body.amount);
    const reason = String(body.reason || "").trim().slice(0, 300);

    if (!Number.isFinite(robloxUserId)) return json({ error: "Missing or invalid robloxUserId." }, 400);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Amount must be a positive number." }, 400);

    const { data: playerRow, error: playerErr } = await admin
      .from("players")
      .select("roblox_user_id, username, points")
      .eq("roblox_user_id", robloxUserId)
      .maybeSingle();

    if (playerErr) {
      console.error("redeem-points lookup error:", playerErr);
      return json({ error: "Couldn't look up that tester right now." }, 500);
    }
    if (!playerRow) return json({ error: "No tester found with that Roblox user ID." }, 404);
    if (playerRow.points < amount) {
      return json({ error: `${playerRow.username} only has ${playerRow.points} points.` }, 409);
    }

    const newBalance = playerRow.points - amount;
    const { error: updateErr } = await admin
      .from("players")
      .update({ points: newBalance })
      .eq("roblox_user_id", robloxUserId);

    if (updateErr) {
      console.error("redeem-points update error:", updateErr);
      return json({ error: "Couldn't update their points. Try again." }, 500);
    }

    // Best-effort — a webhook failure shouldn't undo a redemption that
    // already succeeded, so this is logged but not treated as fatal.
    if (DISCORD_WEBHOOK_URL) {
      try {
        await fetch(DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [
              {
                title: "Points redeemed",
                color: 0xffe14d,
                fields: [
                  { name: "Tester", value: playerRow.username, inline: true },
                  { name: "Amount", value: String(amount), inline: true },
                  { name: "New balance", value: String(newBalance), inline: true },
                  { name: "Processed by", value: `<@${discordId}>`, inline: false },
                  ...(reason ? [{ name: "Reason", value: reason, inline: false }] : []),
                ],
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        });
      } catch (webhookErr) {
        console.error("redeem-points webhook error:", webhookErr);
      }
    }

    return json({ success: true, newBalance });
  } catch (err) {
    console.error("redeem-points error:", err);
    return json({ error: "Unexpected server error." }, 500);
  }
});
