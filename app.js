(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TESTER_TRACKER_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const GAMEMODE_LABELS = {
    Normal: "Normal",
    ChallengeMode: "Challenge Mode",
    QuickPlay: "Quick Play",
    QuotaMode: "Quota Mode",
  };

  // Must match the `suffixes` list used by numberFormatModule.formatNumber
  // in your Roblox game exactly, in the same order, or numbers will show
  // the wrong suffix. Edit this array to match yours.
  const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

  // Mirrors numberFormatModule.formatNumber(number, decimalCount) from Roblox:
  // divide by 1000 per suffix step, format to decimalCount decimals, then
  // strip trailing zeros (and a trailing dot) before appending the suffix.
  function formatNumber(number, decimalCount = 2) {
    let n = Number(number);
    if (!Number.isFinite(n)) return String(number ?? 0);

    let suffixIndex = 0;
    while (Math.abs(n) >= 1000 && suffixIndex < SUFFIXES.length - 1) {
      n /= 1000;
      suffixIndex += 1;
    }

    let formatted = n.toFixed(decimalCount);
    formatted = formatted.replace(/\.?0+$/, "");
    return formatted + SUFFIXES[suffixIndex];
  }

  // Playtime / SessionTime are assumed to be stored in seconds (a common
  // convention for os.time()/os.clock() diffs in Roblox). If your game
  // stores them in a different unit, adjust the math below.
  function formatDuration(totalSeconds) {
    if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds)) return "—";
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  // ------------------------------------------------------------------ dom
  const el = {
    authArea: document.getElementById("authArea"),
    searchWrap: document.getElementById("searchWrap"),
    searchInput: document.getElementById("searchInput"),
    gate: document.getElementById("gate"),
    denied: document.getElementById("denied"),
    deniedName: document.getElementById("deniedName"),
    authorized: document.getElementById("authorized"),
    viewTabs: document.getElementById("viewTabs"),
    dashboard: document.getElementById("dashboard"),
    analytics: document.getElementById("analytics"),
    statline: document.getElementById("statline"),
    playerGrid: document.getElementById("playerGrid"),
    emptyState: document.getElementById("emptyState"),
    loginBtn: document.getElementById("loginBtn"),
    logoutFromDenied: document.getElementById("logoutFromDenied"),
    statCards: document.getElementById("statCards"),
    gamemodeSelect: document.getElementById("gamemodeSelect"),
    completionNote: document.getElementById("completionNote"),
    pathAvgList: document.getElementById("pathAvgList"),
    playtimeLeaderboard: document.getElementById("playtimeLeaderboard"),
    xpLeaderboard: document.getElementById("xpLeaderboard"),
  };

  const playerCardTpl = document.getElementById("playerCardTemplate");
  const gamemodeTpl = document.getElementById("gamemodeTemplate");
  const pathTpl = document.getElementById("pathTemplate");

  let allPlayers = [];

  // ------------------------------------------------------------------ helpers
  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
  }

  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    const diffSec = Math.max(0, (Date.now() - then) / 1000);
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  function freshness(iso) {
    const diffH = (Date.now() - new Date(iso).getTime()) / 3600000;
    if (diffH < 1) return "fresh";
    if (diffH < 72) return "stale";
    return "cold";
  }

  // A number that's safe to average / compare — anything else (missing
  // field, null, NaN, a string) is treated as "no data" rather than 0,
  // so testers who don't have a value yet don't skew the averages down.
  function safeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  // Average a field across players, skipping anyone missing it.
  // Returns { avg, count } where count is how many testers contributed —
  // always show this alongside the average so it's clear it's a partial
  // read while the new fields are still rolling out.
  function averageField(players, getter) {
    const values = [];
    for (const p of players) {
      const v = safeNumber(getter(p));
      if (v !== null) values.push(v);
    }
    if (!values.length) return { avg: null, count: 0 };
    return { avg: values.reduce((a, b) => a + b, 0) / values.length, count: values.length };
  }

  // Group an Upgrades table like { "0-0": true, "0-1": false, "1-0": true }
  // into paths: [{ pathIdx: 0, done: 1, total: 2, upgrades: [...] }, ...]
  function groupUpgradesByPath(upgrades) {
    const paths = new Map();
    for (const [key, value] of Object.entries(upgrades || {})) {
      const [pathIdxRaw, upgradeIdxRaw] = key.split("-");
      const pathIdx = Number(pathIdxRaw);
      const upgradeIdx = Number(upgradeIdxRaw);
      if (Number.isNaN(pathIdx) || Number.isNaN(upgradeIdx)) continue;
      if (!paths.has(pathIdx)) paths.set(pathIdx, []);
      paths.get(pathIdx).push({ key, upgradeIdx, value: !!value });
    }
    return [...paths.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pathIdx, list]) => {
        list.sort((a, b) => a.upgradeIdx - b.upgradeIdx);
        const done = list.filter((u) => u.value).length;
        return { pathIdx, total: list.length, done, upgrades: list };
      });
  }

  // ------------------------------------------------------------------ roster render
  function renderPath(path) {
    const node = pathTpl.content.cloneNode(true);
    node.querySelector("[data-path-name]").textContent = `Path ${path.pathIdx}`;
    node.querySelector("[data-path-count]").textContent = `[${path.done}/${path.total}]`;

    const fill = node.querySelector("[data-path-fill]");
    const percent = path.total ? Math.round((path.done / path.total) * 100) : 0;
    fill.style.width = `${percent}%`;

    const locked = path.upgrades.filter((u) => !u.value).map((u) => u.key);
    fill.parentElement.title = locked.length
      ? `Locked: ${locked.join(", ")}`
      : "All upgrades purchased";

    return node;
  }

  function renderGamemode(name, gm) {
    const node = gamemodeTpl.content.cloneNode(true);
    node.querySelector("[data-gm-name]").textContent = GAMEMODE_LABELS[name] || name;

    const currencies = node.querySelector("[data-currencies]");
    const currencyEntries = Object.entries(gm?.Currencies || {});
    for (const [cName, cVal] of currencyEntries) {
      const chip = document.createElement("span");
      chip.className = "currency";
      chip.innerHTML = `${esc(cName)}: <b>${esc(formatNumber(cVal))}</b>`;
      currencies.appendChild(chip);
    }

    const pathsWrap = node.querySelector("[data-paths]");
    const grouped = groupUpgradesByPath(gm?.Upgrades);
    for (const path of grouped) {
      pathsWrap.appendChild(renderPath(path));
    }

    const sub = node.querySelector("[data-gm-sub]");
    if (grouped.length) {
      const totalDone = grouped.reduce((s, p) => s + p.done, 0);
      const totalAll = grouped.reduce((s, p) => s + p.total, 0);
      sub.textContent = `${totalDone}/${totalAll} upgrades`;
    } else {
      sub.textContent = `${currencyEntries.length} currenc${currencyEntries.length === 1 ? "y" : "ies"}`;
    }

    const head = node.querySelector("[data-gm-toggle]");
    const body = node.querySelector("[data-gm-body]");
    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute("aria-expanded", String(open));
    });

    return node;
  }

  function renderPlayerCard(row) {
    const node = playerCardTpl.content.cloneNode(true);
    const data = row.data || {};

    node.querySelector("[data-username]").textContent = row.username;
    node.querySelector("[data-stars]").textContent = formatNumber(data.Stars ?? 0);
    node.querySelector("[data-plasma]").textContent = formatNumber(data.Plasma ?? 0);
    node.querySelector("[data-xp]").textContent = formatNumber(data.GlobalXP ?? 0);
    node.querySelector("[data-updated]").textContent = timeAgo(row.updated_at);
    node.querySelector("[data-status]").dataset.fresh = freshness(row.updated_at);

    node.querySelector("[data-userid]").textContent = row.roblox_user_id;
    node.querySelector("[data-version]").textContent = data.Version ?? "—";
    node.querySelector("[data-currentgame]").textContent = data.CurrentGame ?? "None";
    node.querySelector("[data-xpfull]").textContent = formatNumber(data.GlobalXP ?? 0);

    // Playtime / SessionTime are newly-added fields — not every tester's
    // save will have them yet, so fall back to "—" instead of breaking.
    node.querySelector("[data-playtime]").textContent = formatDuration(safeNumber(data.Playtime));
    node.querySelector("[data-sessiontime]").textContent = formatDuration(safeNumber(data.SessionTime));

    const gamemodesWrap = node.querySelector("[data-gamemodes]");
    const gamemodeData = data.GamemodeData || {};
    for (const [name, gm] of Object.entries(gamemodeData)) {
      gamemodesWrap.appendChild(renderGamemode(name, gm));
    }

    const head = node.querySelector("[data-toggle]");
    const body = node.querySelector("[data-body]");
    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute("aria-expanded", String(open));
    });

    return node;
  }

  function renderPlayers(rows) {
    el.playerGrid.innerHTML = "";
    el.emptyState.hidden = rows.length !== 0;
    for (const row of rows) {
      el.playerGrid.appendChild(renderPlayerCard(row));
    }
  }

  function applySearch() {
    const q = el.searchInput.value.trim().toLowerCase();
    const filtered = q
      ? allPlayers.filter((p) => p.username.toLowerCase().includes(q))
      : allPlayers;
    renderPlayers(filtered);
  }

  function updateStatline() {
    const freshCount = allPlayers.filter((p) => freshness(p.updated_at) === "fresh").length;
    el.statline.innerHTML = `<b>${allPlayers.length}</b> tester${allPlayers.length === 1 ? "" : "s"} tracked &nbsp;·&nbsp; <b>${freshCount}</b> updated in the last hour`;
  }

  // ------------------------------------------------------------------ analytics render
  function statCard(label, value, sub) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-card__label">${esc(label)}</span>
      <span class="stat-card__value">${esc(value)}</span>
      ${sub ? `<span class="stat-card__sub">${esc(sub)}</span>` : ""}
    `;
    return card;
  }

  function reportingSub(count, total) {
    return `${count}/${total} testers reporting`;
  }

  function renderStatCards() {
    const total = allPlayers.length;
    const playtime = averageField(allPlayers, (p) => p.data?.Playtime);
    const session = averageField(allPlayers, (p) => p.data?.SessionTime);
    const stars = averageField(allPlayers, (p) => p.data?.Stars);
    const plasma = averageField(allPlayers, (p) => p.data?.Plasma);
    const xp = averageField(allPlayers, (p) => p.data?.GlobalXP);

    el.statCards.innerHTML = "";
    el.statCards.appendChild(statCard("Testers tracked", total));
    el.statCards.appendChild(
      statCard("Avg. playtime", playtime.count ? formatDuration(playtime.avg) : "No data yet", playtime.count ? reportingSub(playtime.count, total) : null)
    );
    el.statCards.appendChild(
      statCard("Avg. last session", session.count ? formatDuration(session.avg) : "No data yet", session.count ? reportingSub(session.count, total) : null)
    );
    el.statCards.appendChild(
      statCard("Avg. Global XP", xp.count ? formatNumber(xp.avg) : "No data yet", xp.count ? reportingSub(xp.count, total) : null)
    );
    el.statCards.appendChild(
      statCard("Avg. Stars", stars.count ? formatNumber(stars.avg) : "No data yet", stars.count ? reportingSub(stars.count, total) : null)
    );
    el.statCards.appendChild(
      statCard("Avg. Plasma", plasma.count ? formatNumber(plasma.avg) : "No data yet", plasma.count ? reportingSub(plasma.count, total) : null)
    );
  }

  // Every gamemode name seen across all testers' saves, so the selector
  // reflects real data even if it drifts from GAMEMODE_LABELS later.
  function discoverGamemodeKeys() {
    const keys = new Set();
    for (const p of allPlayers) {
      const gmData = p.data?.GamemodeData;
      if (!gmData) continue;
      for (const key of Object.keys(gmData)) keys.add(key);
    }
    if (!keys.size) for (const key of Object.keys(GAMEMODE_LABELS)) keys.add(key);
    return [...keys];
  }

  function populateGamemodeSelect() {
    const keys = discoverGamemodeKeys();
    el.gamemodeSelect.innerHTML = keys
      .map((k) => `<option value="${esc(k)}">${esc(GAMEMODE_LABELS[k] || k)}</option>`)
      .join("");
    // Prefer "Normal" by default since it's the one most likely to have
    // upgrade paths; otherwise just take the first gamemode found.
    el.gamemodeSelect.value = keys.includes("Normal") ? "Normal" : keys[0] || "";
  }

  // Per-player completion % for a gamemode, skipping anyone who has no
  // Upgrades data for it (new field / never played that mode).
  function computeGamemodeCompletion(gamemodeKey) {
    const perPlayer = [];
    for (const p of allPlayers) {
      const gm = p.data?.GamemodeData?.[gamemodeKey];
      const upgrades = gm?.Upgrades;
      if (!upgrades || !Object.keys(upgrades).length) continue;
      const grouped = groupUpgradesByPath(upgrades);
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
      el.completionNote.textContent = `No testers have upgrade data for ${GAMEMODE_LABELS[gamemodeKey] || gamemodeKey} yet.`;
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
      .map((p) => ({ username: p.username, value: safeNumber(getter(p)) }))
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
      li.innerHTML = `<span>${esc(entry.username)}</span><b>${esc(formatter(entry.value))}</b>`;
      container.appendChild(li);
    }
  }

  function renderAnalytics() {
    renderStatCards();
    populateGamemodeSelect();
    renderCompletion();
    renderLeaderboard(el.playtimeLeaderboard, (p) => p.data?.Playtime, formatDuration, "No playtime recorded yet.");
    renderLeaderboard(el.xpLeaderboard, (p) => p.data?.GlobalXP, (v) => formatNumber(v), "No Global XP recorded yet.");
  }

  // ------------------------------------------------------------------ tabs
  function setActiveView(view) {
    el.dashboard.hidden = view !== "roster";
    el.analytics.hidden = view !== "analytics";
    el.searchWrap.hidden = view !== "roster";
    for (const btn of el.viewTabs.querySelectorAll("[data-view]")) {
      btn.classList.toggle("tab--active", btn.dataset.view === view);
    }
  }

  el.viewTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) setActiveView(btn.dataset.view);
  });

  el.gamemodeSelect.addEventListener("change", renderCompletion);

  // ------------------------------------------------------------------ auth flow
  function showOnly(sectionEl) {
    for (const s of [el.gate, el.denied, el.authorized]) {
      s.hidden = s !== sectionEl;
    }
    if (sectionEl === el.authorized) setActiveView("roster");
    else el.searchWrap.hidden = true;
  }

  function renderAuthArea(user) {
    if (!user) {
      el.authArea.innerHTML = "";
      return;
    }
    const name = user.user_metadata?.full_name || user.user_metadata?.name || "Tester";
    const avatarUrl = user.user_metadata?.avatar_url;
    const initial = esc(name.slice(0, 1).toUpperCase());
    el.authArea.innerHTML = `
      <div class="auth__user">
        ${avatarUrl ? `<img class="auth__avatar" src="${esc(avatarUrl)}" alt="" style="object-fit:cover" />` : `<span class="auth__avatar">${initial}</span>`}
        <span>${esc(name)}</span>
      </div>
      <button class="btn btn--ghost btn--small" id="logoutBtn">Sign out</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", () => sb.auth.signOut());
  }

  async function checkAccessAndLoad(user) {
    renderAuthArea(user);

    const discordId = user.user_metadata?.provider_id || user.user_metadata?.sub;

    const { data: adminRow, error: adminErr } = await sb
      .from("allowed_admins")
      .select("discord_id")
      .eq("discord_id", discordId)
      .maybeSingle();

    if (adminErr || !adminRow) {
      el.deniedName.textContent = `Signed in as ${user.user_metadata?.full_name || "this account"}, but it isn't on the allow list.`;
      showOnly(el.denied);
      return;
    }

    const { data: players, error: playersErr } = await sb
      .from("players")
      .select("roblox_user_id, username, data, updated_at")
      .order("updated_at", { ascending: false });

    if (playersErr) {
      el.statline.textContent = `Couldn't load player data: ${playersErr.message}`;
      showOnly(el.authorized);
      return;
    }

    allPlayers = players || [];
    updateStatline();
    renderPlayers(allPlayers);
    renderAnalytics();
    showOnly(el.authorized);
  }

  async function handleSession(session) {
    if (!session) {
      renderAuthArea(null);
      showOnly(el.gate);
      return;
    }
    await checkAccessAndLoad(session.user);
  }

  // ------------------------------------------------------------------ wire up
  el.loginBtn.addEventListener("click", () => {
    sb.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.href },
    });
  });

  el.logoutFromDenied.addEventListener("click", () => sb.auth.signOut());
  el.searchInput.addEventListener("input", applySearch);

  sb.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  sb.auth.getSession().then(({ data }) => handleSession(data.session));
})();
