(() => {
  const T = window.TT;

  const el = {
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    denied: document.getElementById("denied"),
    deniedName: document.getElementById("deniedName"),
    analytics: document.getElementById("analytics"),
    loginBtn: document.getElementById("loginBtn"),
    logoutFromDenied: document.getElementById("logoutFromDenied"),
    statCards: document.getElementById("statCards"),
    gamemodeSelect: document.getElementById("gamemodeSelect"),
    completionNote: document.getElementById("completionNote"),
    pathAvgList: document.getElementById("pathAvgList"),
    playtimeLeaderboard: document.getElementById("playtimeLeaderboard"),
    xpLeaderboard: document.getElementById("xpLeaderboard"),
  };

  let allPlayers = [];

  function statCard(label, value, sub) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-card__label">${T.esc(label)}</span>
      <span class="stat-card__value">${T.esc(value)}</span>
      ${sub ? `<span class="stat-card__sub">${T.esc(sub)}</span>` : ""}
    `;
    return card;
  }

  function reportingSub(count, total) {
    return `${count}/${total} testers reporting`;
  }

  function renderStatCards() {
    const total = allPlayers.length;
    const playtime = T.averageField(allPlayers, (p) => p.data?.Playtime);
    const session = T.averageField(allPlayers, (p) => p.data?.SessionTime);
    const stars = T.averageField(allPlayers, (p) => p.data?.Stars);
    const plasma = T.averageField(allPlayers, (p) => p.data?.Plasma);
    const xp = T.averageField(allPlayers, (p) => p.data?.GlobalXP);

    el.statCards.innerHTML = "";
    el.statCards.appendChild(statCard("Testers tracked", total));
    el.statCards.appendChild(statCard("Avg. playtime", playtime.count ? T.formatDuration(playtime.avg) : "No data yet", playtime.count ? reportingSub(playtime.count, total) : null));
    el.statCards.appendChild(statCard("Avg. last session", session.count ? T.formatDuration(session.avg) : "No data yet", session.count ? reportingSub(session.count, total) : null));
    el.statCards.appendChild(statCard("Avg. Global XP", xp.count ? T.formatNumber(xp.avg) : "No data yet", xp.count ? reportingSub(xp.count, total) : null));
    el.statCards.appendChild(statCard("Avg. Stars", stars.count ? T.formatNumber(stars.avg) : "No data yet", stars.count ? reportingSub(stars.count, total) : null));
    el.statCards.appendChild(statCard("Avg. Plasma", plasma.count ? T.formatNumber(plasma.avg) : "No data yet", plasma.count ? reportingSub(plasma.count, total) : null));
  }

  function discoverGamemodeKeys() {
    const keys = new Set();
    for (const p of allPlayers) {
      const gmData = p.data?.GamemodeData;
      if (!gmData) continue;
      for (const key of Object.keys(gmData)) keys.add(key);
    }
    if (!keys.size) for (const key of Object.keys(T.GAMEMODE_LABELS)) keys.add(key);
    return [...keys];
  }

  function populateGamemodeSelect() {
    const keys = discoverGamemodeKeys();
    el.gamemodeSelect.innerHTML = keys.map((k) => `<option value="${T.esc(k)}">${T.esc(T.GAMEMODE_LABELS[k] || k)}</option>`).join("");
    el.gamemodeSelect.value = keys.includes("Normal") ? "Normal" : keys[0] || "";
  }

  function computeGamemodeCompletion(gamemodeKey) {
    const perPlayer = [];
    for (const p of allPlayers) {
      const gm = p.data?.GamemodeData?.[gamemodeKey];
      const upgrades = gm?.Upgrades;
      if (!upgrades || !Object.keys(upgrades).length) continue;
      const grouped = T.groupUpgradesByPath(upgrades);
      const total = grouped.reduce((s, g) => s + g.total, 0);
      const done = grouped.reduce((s, g) => s + g.done, 0);
      if (!total) continue;
      perPlayer.push({ username: p.username, percent: (done / total) * 100, grouped });
    }
    return perPlayer;
  }

  function computePathAverages(perPlayer) {
    const byPath = new Map();
    for (const entry of perPlayer) {
      for (const g of entry.grouped) {
        if (!g.total) continue;
        if (!byPath.has(g.pathIdx)) byPath.set(g.pathIdx, []);
        byPath.get(g.pathIdx).push((g.done / g.total) * 100);
      }
    }
    return [...byPath.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pathIdx, percents]) => ({
        pathIdx,
        avg: percents.reduce((a, b) => a + b, 0) / percents.length,
        count: percents.length,
      }));
  }

  function renderCompletion() {
    const gamemodeKey = el.gamemodeSelect.value;
    if (!gamemodeKey) {
      el.completionNote.textContent = "No gamemode data available yet.";
      el.pathAvgList.innerHTML = "";
      return;
    }

    const perPlayer = computeGamemodeCompletion(gamemodeKey);
    const total = allPlayers.length;

    if (!perPlayer.length) {
      el.completionNote.textContent = `No testers have upgrade data for ${T.GAMEMODE_LABELS[gamemodeKey] || gamemodeKey} yet.`;
      el.pathAvgList.innerHTML = "";
      return;
    }

    const avgPercent = perPlayer.reduce((s, p) => s + p.percent, 0) / perPlayer.length;
    el.completionNote.innerHTML = `Average completion: <b>${avgPercent.toFixed(1)}%</b> &nbsp;·&nbsp; based on ${perPlayer.length}/${total} testers with data for this mode`;

    const pathAverages = computePathAverages(perPlayer);
    el.pathAvgList.innerHTML = "";
    for (const pathAvg of pathAverages) {
      const row = document.createElement("div");
      row.className = "path";
      row.innerHTML = `
        <div class="path__label">
          <span>Path ${pathAvg.pathIdx}</span>
          <span class="path__count">avg ${pathAvg.avg.toFixed(0)}% (${pathAvg.count} testers)</span>
        </div>
        <div class="path__track"><div class="path__fill" style="width:${pathAvg.avg}%"></div></div>
      `;
      el.pathAvgList.appendChild(row);
    }
  }

  function renderLeaderboard(container, getter, formatter, emptyMessage) {
    const ranked = allPlayers
      .map((p) => ({ username: p.username, value: T.safeNumber(getter(p)) }))
      .filter((p) => p.value !== null)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    container.innerHTML = "";
    if (!ranked.length) {
      const li = document.createElement("li");
      li.className = "leaderboard__empty";
      li.textContent = emptyMessage;
      container.appendChild(li);
      return;
    }
    for (const entry of ranked) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${T.esc(entry.username)}</span><b>${T.esc(formatter(entry.value))}</b>`;
      container.appendChild(li);
    }
  }

  function renderAnalytics() {
    renderStatCards();
    populateGamemodeSelect();
    renderCompletion();
    renderLeaderboard(el.playtimeLeaderboard, (p) => p.data?.Playtime, T.formatDuration, "No playtime recorded yet.");
    renderLeaderboard(el.xpLeaderboard, (p) => p.data?.GlobalXP, (v) => T.formatNumber(v), "No Global XP recorded yet.");
  }

  el.gamemodeSelect.addEventListener("change", renderCompletion);

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.denied, el.analytics]) s.hidden = s !== sectionEl;
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
      .select("roblox_user_id, username, data, updated_at")
      .order("updated_at", { ascending: false });

    if (playersErr) {
      el.completionNote.textContent = `Couldn't load player data: ${playersErr.message}`;
      showOnly(el.analytics);
      return;
    }

    allPlayers = players || [];
    renderAnalytics();
    showOnly(el.analytics);
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

  T.initAuth(handleSession);
})();
