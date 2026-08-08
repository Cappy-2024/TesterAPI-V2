(() => {
  const T = window.TT;

  const el = {
    authArea: document.getElementById("authArea"),
    searchWrap: document.getElementById("searchWrap"),
    searchInput: document.getElementById("searchInput"),
    gate: document.getElementById("gate"),
    denied: document.getElementById("denied"),
    deniedName: document.getElementById("deniedName"),
    dashboard: document.getElementById("dashboard"),
    statline: document.getElementById("statline"),
    playerGrid: document.getElementById("playerGrid"),
    emptyState: document.getElementById("emptyState"),
    loginBtn: document.getElementById("loginBtn"),
    logoutFromDenied: document.getElementById("logoutFromDenied"),
  };

  const playerCardTpl = document.getElementById("playerCardTemplate");
  const gamemodeTpl = document.getElementById("gamemodeTemplate");
  const pathTpl = document.getElementById("pathTemplate");

  let allPlayers = [];

  function renderPlayerCard(row) {
    const node = playerCardTpl.content.cloneNode(true);
    const data = row.data || {};

    node.querySelector("[data-username]").textContent = row.username;
    node.querySelector("[data-stars]").textContent = T.formatNumber(data.Stars ?? 0);
    node.querySelector("[data-plasma]").textContent = T.formatNumber(data.Plasma ?? 0);
    node.querySelector("[data-xp]").textContent = T.formatNumber(data.GlobalXP ?? 0);
    node.querySelector("[data-updated]").textContent = T.timeAgo(row.updated_at);
    node.querySelector("[data-status]").dataset.fresh = T.freshness(row.updated_at);

    node.querySelector("[data-userid]").textContent = row.roblox_user_id;
    node.querySelector("[data-version]").textContent = data.Version ?? "—";
    node.querySelector("[data-currentgame]").textContent = data.CurrentGame ?? "None";
    node.querySelector("[data-xpfull]").textContent = T.formatNumber(data.GlobalXP ?? 0);
    node.querySelector("[data-points]").textContent = T.formatNumber(row.points ?? 0);
    node.querySelector("[data-pointsfull]").textContent = T.formatNumber(row.points ?? 0);

    // Playtime / SessionTime are newer fields — not every save has them yet.
    node.querySelector("[data-playtime]").textContent = T.formatDuration(T.safeNumber(data.Playtime));
    node.querySelector("[data-sessiontime]").textContent = T.formatDuration(T.safeNumber(data.SessionTime));

    const gamemodesWrap = node.querySelector("[data-gamemodes]");
    const gamemodeData = data.GamemodeData || {};
    for (const [name, gm] of Object.entries(gamemodeData)) {
      gamemodesWrap.appendChild(T.renderGamemode(gamemodeTpl, pathTpl, name, gm));
    }

    const head = node.querySelector("[data-toggle]");
    const body = node.querySelector("[data-body]");
    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute("aria-expanded", String(open));
    });

    wireRedeem(node, row);

    return node;
  }

  function wireRedeem(node, row) {
    const amountInput = node.querySelector("[data-redeem-amount]");
    const redeemBtn = node.querySelector("[data-redeem-btn]");
    const message = node.querySelector("[data-redeem-message]");

    redeemBtn.addEventListener("click", async () => {
      const amount = Number(amountInput.value);
      if (!Number.isFinite(amount) || amount <= 0) {
        setMessage(message, "Enter a positive amount.", "error");
        return;
      }
      if (!window.confirm(`Redeem ${amount} points from ${row.username}? This can't be undone.`)) return;

      redeemBtn.disabled = true;
      setMessage(message, "Processing…", "info");

      const { data, error } = await T.sb.functions.invoke("redeem-points", {
        body: { robloxUserId: row.roblox_user_id, amount },
      });

      redeemBtn.disabled = false;

      if (error) {
        setMessage(message, await extractFunctionError(error), "error");
        return;
      }
      if (data?.error) {
        setMessage(message, data.error, "error");
        return;
      }

      row.points = data.newBalance;
      node.querySelector("[data-points]").textContent = T.formatNumber(data.newBalance);
      node.querySelector("[data-pointsfull]").textContent = T.formatNumber(data.newBalance);
      amountInput.value = "";
      setMessage(message, `Redeemed. New balance: ${T.formatNumber(data.newBalance)}.`, "success");
    });
  }

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

  // supabase-js hides the real Edge Function error message behind a generic
  // "non-2xx status code" string — pull the actual { error: "..." } back out.
  async function extractFunctionError(error) {
    if (!error) return "Something went wrong. Try again.";
    try {
      if (error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        if (body?.error) return body.error;
      }
    } catch (_) {
      // fall through
    }
    return error.message || "Something went wrong. Try again.";
  }

  function renderPlayers(rows) {
    el.playerGrid.innerHTML = "";
    el.emptyState.hidden = rows.length !== 0;
    for (const row of rows) el.playerGrid.appendChild(renderPlayerCard(row));
  }

  function applySearch() {
    const q = el.searchInput.value.trim().toLowerCase();
    const filtered = q ? allPlayers.filter((p) => p.username.toLowerCase().includes(q)) : allPlayers;
    renderPlayers(filtered);
  }

  function updateStatline() {
    const freshCount = allPlayers.filter((p) => T.freshness(p.updated_at) === "fresh").length;
    el.statline.innerHTML = `<b>${allPlayers.length}</b> tester${allPlayers.length === 1 ? "" : "s"} tracked &nbsp;·&nbsp; <b>${freshCount}</b> updated in the last hour`;
  }

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.denied, el.dashboard]) s.hidden = s !== sectionEl;
    el.searchWrap.hidden = sectionEl !== el.dashboard;
  }

  async function checkAccessAndLoad(user) {
    T.renderAuthArea(el.authArea, user);

    const discordId = T.getDiscordId(user);
    const isAdmin = await T.checkIsAdmin(discordId);

    if (!isAdmin) {
      el.deniedName.textContent = `Signed in as ${user.user_metadata?.full_name || "this account"}, but it isn't on the admin allow list.`;
      showOnly(el.denied);
      return;
    }

    const { data: players, error: playersErr } = await T.sb
      .from("players")
      .select("roblox_user_id, username, data, points, updated_at")
      .order("updated_at", { ascending: false });

    if (playersErr) {
      el.statline.textContent = `Couldn't load player data: ${playersErr.message}`;
      showOnly(el.dashboard);
      return;
    }

    allPlayers = players || [];
    updateStatline();
    renderPlayers(allPlayers);
    showOnly(el.dashboard);
  }

  async function handleSession(session) {
    if (!session) {
      T.renderAuthArea(el.authArea, null);
      showOnly(el.gate);
      return;
    }
    await checkAccessAndLoad(session.user);
  }

  el.loginBtn.addEventListener("click", () => T.signInWithDiscord());
  el.logoutFromDenied.addEventListener("click", () => T.sb.auth.signOut());
  el.searchInput.addEventListener("input", applySearch);

  T.initAuth(handleSession);
})();
