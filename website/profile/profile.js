(() => {
  const T = window.TT;

  const el = {
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    loading: document.getElementById("loading"),
    verifyStart: document.getElementById("verifyStart"),
    verifyPending: document.getElementById("verifyPending"),
    statsView: document.getElementById("statsView"),
    loginBtn: document.getElementById("loginBtn"),
    usernameForm: document.getElementById("usernameForm"),
    usernameInput: document.getElementById("usernameInput"),
    findBtn: document.getElementById("findBtn"),
    startMessage: document.getElementById("startMessage"),
    verifyCode: document.getElementById("verifyCode"),
    pendingUsername: document.getElementById("pendingUsername"),
    confirmBtn: document.getElementById("confirmBtn"),
    restartBtn: document.getElementById("restartBtn"),
    pendingMessage: document.getElementById("pendingMessage"),
    placementNote: document.getElementById("placementNote"),
    placementCards: document.getElementById("placementCards"),
  };

  const gamemodeTpl = document.getElementById("gamemodeTemplate");
  const pathTpl = document.getElementById("pathTemplate");

  const METRIC_META = {
    Stars: { label: "Stars", formatter: T.formatNumber },
    Plasma: { label: "Plasma", formatter: T.formatNumber },
    GlobalXP: { label: "Global XP", formatter: T.formatNumber },
    Playtime: { label: "Playtime", formatter: T.formatDuration },
  };

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.loading, el.verifyStart, el.verifyPending, el.statsView]) {
      s.hidden = s !== sectionEl;
    }
  }

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

  // -------------------------------------------------------------- stats view
  function renderStats(row) {
    const data = row.data || {};
    const scope = el.statsView;

    scope.querySelector("[data-username]").textContent = row.username;
    scope.querySelector("[data-status]").dataset.fresh = T.freshness(row.updated_at);
    scope.querySelector("[data-updated]").textContent = `Last synced ${T.timeAgo(row.updated_at)}`;

    scope.querySelector("[data-stars]").textContent = T.formatNumber(data.Stars ?? 0);
    scope.querySelector("[data-plasma]").textContent = T.formatNumber(data.Plasma ?? 0);
    scope.querySelector("[data-xp]").textContent = T.formatNumber(data.GlobalXP ?? 0);
    scope.querySelector("[data-playtime]").textContent = T.formatDuration(T.safeNumber(data.Playtime));
    scope.querySelector("[data-sessiontime]").textContent = T.formatDuration(T.safeNumber(data.SessionTime));
    scope.querySelector("[data-currentgame]").textContent = data.CurrentGame ?? "None";

    const gamemodesWrap = scope.querySelector("[data-gamemodes]");
    gamemodesWrap.innerHTML = "";
    const gamemodeData = data.GamemodeData || {};
    for (const [name, gm] of Object.entries(gamemodeData)) {
      gamemodesWrap.appendChild(T.renderGamemode(gamemodeTpl, pathTpl, name, gm));
    }
  }

  async function renderPlacement() {
    el.placementCards.innerHTML = "";
    const { data, error } = await T.sb.rpc("get_my_placement");

    if (error || !data || !data.length) {
      el.placementNote.textContent = "Not enough tester data yet to calculate your ranking.";
      return;
    }

    el.placementNote.textContent = "Compared against all tracked testers.";
    for (const row of data) {
      const meta = METRIC_META[row.metric] || { label: row.metric, formatter: (v) => v };
      const card = document.createElement("div");
      card.className = "stat-card";
      card.innerHTML = `
        <span class="stat-card__label">${T.esc(meta.label)}</span>
        <span class="stat-card__value">${T.esc(meta.formatter(row.my_value))}</span>
        <span class="stat-card__sub">#${row.rank} of ${row.total} &nbsp;·&nbsp; top ${row.percentile}%</span>
      `;
      el.placementCards.appendChild(card);
    }
  }

  async function loadLinkedProfile(discordId) {
    const { data: row, error } = await T.sb
      .from("players")
      .select("roblox_user_id, username, data, updated_at")
      .eq("discord_id", discordId)
      .maybeSingle();

    if (error) {
      // RLS or network hiccup — treat as "not linked yet" rather than break the page.
      return null;
    }
    return row;
  }

  async function showLinkedProfile(row) {
    renderStats(row);
    showOnly(el.statsView);
    await renderPlacement();
  }

  // -------------------------------------------------------------- verification
  let pendingUsernameValue = "";

  el.usernameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = el.usernameInput.value.trim();
    if (!username) return;

    el.findBtn.disabled = true;
    setMessage(el.startMessage, "Looking that up…", "info");

    const { data, error } = await T.sb.functions.invoke("verify-roblox", {
      body: { action: "start", robloxUsername: username },
    });

    el.findBtn.disabled = false;

    if (error) {
      setMessage(el.startMessage, error.message || "Something went wrong. Try again.", "error");
      return;
    }
    if (data?.error) {
      setMessage(el.startMessage, data.error, "error");
      return;
    }
    if (data?.alreadyLinked) {
      // Already linked to this Discord account — just load their stats.
      const discordId = T.getDiscordId((await T.sb.auth.getUser()).data.user);
      const row = await loadLinkedProfile(discordId);
      if (row) { await showLinkedProfile(row); return; }
    }

    pendingUsernameValue = data.username;
    el.pendingUsername.textContent = data.username;
    el.verifyCode.textContent = data.code;
    setMessage(el.pendingMessage, "", "");
    showOnly(el.verifyPending);
  });

  el.confirmBtn.addEventListener("click", async () => {
    el.confirmBtn.disabled = true;
    setMessage(el.pendingMessage, "Checking your bio…", "info");

    const { data, error } = await T.sb.functions.invoke("verify-roblox", {
      body: { action: "confirm" },
    });

    el.confirmBtn.disabled = false;

    if (error) {
      setMessage(el.pendingMessage, error.message || "Something went wrong. Try again.", "error");
      return;
    }
    if (data?.error) {
      setMessage(el.pendingMessage, data.error, "error");
      return;
    }
    if (!data?.verified) {
      setMessage(el.pendingMessage, data?.message || "Code not found in your bio yet.", "error");
      return;
    }

    const discordId = T.getDiscordId((await T.sb.auth.getUser()).data.user);
    const row = await loadLinkedProfile(discordId);
    if (row) {
      await showLinkedProfile(row);
    } else {
      setMessage(el.pendingMessage, "Verified, but couldn't load your stats — refresh the page.", "error");
    }
  });

  el.restartBtn.addEventListener("click", () => {
    el.usernameInput.value = pendingUsernameValue;
    setMessage(el.startMessage, "", "");
    showOnly(el.verifyStart);
  });

  // -------------------------------------------------------------- auth flow
  async function handleSession(session) {
    if (!session) {
      T.renderAuthArea(el.authArea, null);
      showOnly(el.gate);
      return;
    }

    T.renderAuthArea(el.authArea, session.user);
    showOnly(el.loading);

    const discordId = T.getDiscordId(session.user);
    if (!discordId) {
      setMessage(el.startMessage, "Couldn't determine your Discord ID from this login.", "error");
      showOnly(el.verifyStart);
      return;
    }

    const row = await loadLinkedProfile(discordId);
    if (row) {
      await showLinkedProfile(row);
    } else {
      showOnly(el.verifyStart);
    }
  }

  el.loginBtn.addEventListener("click", () => T.signInWithDiscord());

  T.initAuth(handleSession);
})();
