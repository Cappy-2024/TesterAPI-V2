(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TESTER_TRACKER_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const GAMEMODE_LABELS = {
    Normal: "Normal",
    ChallengeMode: "Challenge Mode",
    QuickPlay: "Quick Play",
    QuotaMode: "Quota Mode",
  };

  // ------------------------------------------------------------------ dom
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

  // Group an Upgrades table like { "0-0": true, "0-1": false, "1-0": true }
  // into paths: [{ index: 0, done: 1, total: 2, upgrades: [...] }, ...]
  function groupUpgradesByPath(upgrades) {
    const paths = new Map();
    for (const [key, value] of Object.entries(upgrades || {})) {
      const [pathIdxRaw, upgradeIdxRaw] = key.split("-");
      const pathIdx = Number(pathIdxRaw);
      const upgradeIdx = Number(upgradeIdxRaw);
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

  // ------------------------------------------------------------------ render
  function renderPath(path) {
    const node = pathTpl.content.cloneNode(true);
    node.querySelector("[data-path-name]").textContent = `Path ${path.pathIdx + 1}`;
    node.querySelector("[data-path-count]").textContent = `[${path.done}/${path.total}]`;
    const meter = node.querySelector("[data-path-meter]");
    for (const u of path.upgrades) {
      const seg = document.createElement("div");
      seg.className = "seg";
      seg.dataset.on = String(u.value);
      seg.title = `${u.key} — ${u.value ? "purchased" : "locked"}`;
      meter.appendChild(seg);
    }
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
      chip.innerHTML = `${esc(cName)}: <b>${esc(cVal)}</b>`;
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
    const card = node.querySelector("[data-card]");
    const data = row.data || {};

    node.querySelector("[data-username]").textContent = row.username;
    node.querySelector("[data-stars]").textContent = data.Stars ?? 0;
    node.querySelector("[data-plasma]").textContent = data.Plasma ?? 0;
    node.querySelector("[data-xp]").textContent = data.GlobalXP ?? 0;
    node.querySelector("[data-updated]").textContent = timeAgo(row.updated_at);
    node.querySelector("[data-status]").dataset.fresh = freshness(row.updated_at);

    node.querySelector("[data-userid]").textContent = row.roblox_user_id;
    node.querySelector("[data-version]").textContent = data.Version ?? "—";
    node.querySelector("[data-currentgame]").textContent = data.CurrentGame ?? "None";
    node.querySelector("[data-xpfull]").textContent = data.GlobalXP ?? 0;

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

  // ------------------------------------------------------------------ auth flow
  function showOnly(sectionEl) {
    for (const s of [el.gate, el.denied, el.dashboard]) {
      s.hidden = s !== sectionEl;
    }
    el.searchWrap.hidden = sectionEl !== el.dashboard;
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
