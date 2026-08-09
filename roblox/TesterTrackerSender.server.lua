--[[
	TesterTrackerSender.server.lua

	Sends each player's data to Supabase when they leave the game (and once
	on server shutdown as a safety net), so it can be viewed on the
	Tester Tracker website.

	SETUP:
	1. Place this Script in ServerScriptService.
	2. Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY below.
	   - Get these from your Supabase project: Settings → API.
	   - Use the SERVICE ROLE key here (not the anon key) so this script can
	     write to the `players` table, which is otherwise locked down by
	     Row Level Security for everyone else. This is safe because this is
	     a server-side Script, never seen by clients.
	3. Replace the body of `getPlayerData(player)` so it returns the actual
	   profile table for that player (e.g. from ProfileService, your own
	   DataStore wrapper, etc). It should return the same table shape as
	   dataTemplate.Template.
	4. In Roblox Studio / game settings, make sure HTTP Requests are enabled:
	   Game Settings → Security → Allow HTTP Requests.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

-- ============================================================================
-- CONFIG — fill these in
-- ============================================================================
local SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co"
local SUPABASE_SERVICE_ROLE_KEY = "YOUR-SERVICE-ROLE-KEY"

-- ============================================================================
-- Plug in your real data source here.
-- Must return a table matching dataTemplate.Template for the given player.
-- ============================================================================
local function getPlayerData(player)
	-- Example if you're using a ProfileService-style profile store:
	--   local profile = ProfileStore:GetProfile(player)
	--   return profile and profile.Data
	--
	-- Replace this with whatever actually holds this player's live data.
	local playerDataModule = require(game.ServerScriptService.PlayerDataModule) -- placeholder path
	return playerDataModule.Get(player)
end

-- ============================================================================
-- Networking
-- ============================================================================
local ENDPOINT = SUPABASE_URL .. "/rest/v1/players?on_conflict=roblox_user_id"

local function sendPlayerData(player)
	local ok, data = pcall(getPlayerData, player)
	if not ok or not data then
		warn(string.format("[TesterTracker] Could not read data for %s: %s", player.Name, tostring(data)))
		return
	end

	local payload = {
		roblox_user_id = player.UserId,
		username = player.Name,
		data = data,
	}

	local ok2, body = pcall(HttpService.JSONEncode, HttpService, payload)
	if not ok2 then
		warn("[TesterTracker] Failed to JSON-encode payload for " .. player.Name .. ": " .. tostring(body))
		return
	end

	local requestOptions = {
		Url = ENDPOINT,
		Method = "POST",
		Headers = {
			["apikey"] = SUPABASE_SERVICE_ROLE_KEY,
			["Authorization"] = "Bearer " .. SUPABASE_SERVICE_ROLE_KEY,
			["Content-Type"] = "application/json",
			-- "resolution=merge-duplicates" makes this an upsert keyed on
			-- roblox_user_id (see ?on_conflict= in ENDPOINT above).
			["Prefer"] = "resolution=merge-duplicates,return=minimal",
		},
		Body = body,
	}

	local success, response = pcall(HttpService.RequestAsync, HttpService, requestOptions)
	if not success then
		warn("[TesterTracker] HTTP request errored for " .. player.Name .. ": " .. tostring(response))
		return
	end

	if not response.Success then
		warn(string.format(
			"[TesterTracker] Supabase rejected data for %s (status %s): %s",
			player.Name,
			tostring(response.StatusCode),
			tostring(response.Body)
		))
	end
end

-- ============================================================================
-- Hooks
-- ============================================================================
Players.PlayerRemoving:Connect(sendPlayerData)

-- Safety net: also flush everyone's data if the server shuts down
-- (BindToClose pauses shutdown until this finishes or times out).
game:BindToClose(function()
	local threads = 0
	for _, player in ipairs(Players:GetPlayers()) do
		threads += 1
		task.spawn(function()
			sendPlayerData(player)
			threads -= 1
		end)
	end
	while threads > 0 do
		task.wait()
	end
end)
