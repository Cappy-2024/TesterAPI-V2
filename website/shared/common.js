// Shared across every page (index.html, analytics/, profile/, and any page
// added later). Loaded after config.js and the supabase-js CDN script.
window.TT = (() => {
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

  // Mirrors numberFormatModule.formatNumber(number, decimalCount) from Roblox.
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

  // Playtime / SessionTime are assumed to be stored in seconds. Adjust if
  // your game stores them differently.
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

  // A number that's safe to average / rank — anything else (missing field,
  // null, NaN, a string) is "no data" rather than 0, so testers who don't
  // have a value yet don't skew results.
  function safeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

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

  // -------------------------------------------------------------- renderers
  // Shared by the roster cards and the tester-facing profile page so both
  // render gamemode/path data identically. Callers pass in the <template>
  // elements from their own page.
  function renderPath(pathTpl, path) {
    const node = pathTpl.content.cloneNode(true);
    node.querySelector("[data-path-name]").textContent = `Path ${path.pathIdx}`;
    node.querySelector("[data-path-count]").textContent = `[${path.done}/${path.total}]`;

    const fill = node.querySelector("[data-path-fill]");
    const percent = path.total ? Math.round((path.done / path.total) * 100) : 0;
    fill.style.width = `${percent}%`;

    const locked = path.upgrades.filter((u) => !u.value).map((u) => u.key);
    fill.parentElement.title = locked.length ? `Locked: ${locked.join(", ")}` : "All upgrades purchased";

    return node;
  }

  function renderGamemode(gamemodeTpl, pathTpl, name, gm) {
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
    for (const path of grouped) pathsWrap.appendChild(renderPath(pathTpl, path));

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

  // -------------------------------------------------------------- auth
  function getDiscordId(user) {
    return user?.user_metadata?.provider_id || user?.user_metadata?.sub || null;
  }

  function renderAuthArea(mountEl, user) {
    if (!user) {
      mountEl.innerHTML = "";
      return;
    }
    const name = user.user_metadata?.full_name || user.user_metadata?.name || "Tester";
    const avatarUrl = user.user_metadata?.avatar_url;
    const initial = esc(name.slice(0, 1).toUpperCase());
    mountEl.innerHTML = `
      <div class="auth__user">
        ${avatarUrl ? `<img class="auth__avatar" src="${esc(avatarUrl)}" alt="" style="object-fit:cover" />` : `<span class="auth__avatar">${initial}</span>`}
        <span>${esc(name)}</span>
      </div>
      <button class="btn btn--ghost btn--small" id="logoutBtn">Sign out</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", () => sb.auth.signOut());
  }

  function initAuth(handler) {
    sb.auth.onAuthStateChange((_event, session) => handler(session));
    sb.auth.getSession().then(({ data }) => handler(data.session));
  }

  function signInWithDiscord() {
    sb.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.href },
    });
  }

  async function checkIsAdmin(discordId) {
    if (!discordId) return false;
    const { data } = await sb
      .from("allowed_admins")
      .select("discord_id")
      .eq("discord_id", discordId)
      .maybeSingle();
    return !!data;
  }

  return {
    sb,
    GAMEMODE_LABELS,
    formatNumber,
    formatDuration,
    esc,
    timeAgo,
    freshness,
    safeNumber,
    averageField,
    groupUpgradesByPath,
    renderPath,
    renderGamemode,
    getDiscordId,
    renderAuthArea,
    initAuth,
    signInWithDiscord,
    checkIsAdmin,
  };
})();
