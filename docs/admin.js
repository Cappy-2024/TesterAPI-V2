(() => {
  const T = window.TT;

  const el = {
    pageNav: document.getElementById("pageNav"),
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    denied: document.getElementById("denied"),
    deniedName: document.getElementById("deniedName"),
    authorized: document.getElementById("authorized"),
    loginBtn: document.getElementById("loginBtn"),
    logoutFromDenied: document.getElementById("logoutFromDenied"),
    sectionTabs: document.getElementById("sectionTabs"),
    reportsTabCount: document.getElementById("reportsTabCount"),

    // roster
    rosterView: document.getElementById("rosterView"),
    searchWrap: document.getElementById("searchWrap"),
    searchInput: document.getElementById("searchInput"),
    statline: document.getElementById("statline"),
    playerGrid: document.getElementById("playerGrid"),
    emptyState: document.getElementById("emptyState"),

    // analytics
    analyticsView: document.getElementById("analyticsView"),
    statCards: document.getElementById("statCards"),
    gamemodeSelect: document.getElementById("gamemodeSelect"),
    completionNote: document.getElementById("completionNote"),
    pathAvgList: document.getElementById("pathAvgList"),
    playtimeLeaderboard: document.getElementById("playtimeLeaderboard"),
    xpLeaderboard: document.getElementById("xpLeaderboard"),
    pointsLeaderboard: document.getElementById("pointsLeaderboard"),

    // reports
    reportsView: document.getElementById("reportsView"),
    reviewTabs: document.getElementById("reviewTabs"),
    pendingPanel: document.getElementById("pendingPanel"),
    approvedPanel: document.getElementById("approvedPanel"),
    resolvedPanel: document.getElementById("resolvedPanel"),
    trashPanel: document.getElementById("trashPanel"),
    pendingTabCount: document.getElementById("pendingTabCount"),
  };

  const playerCardTpl = document.getElementById("playerCardTemplate");
  const gamemodeTpl = document.getElementById("gamemodeTemplate");
  const pathTpl = document.getElementById("pathTemplate");
  const reportCardTpl = document.getElementById("adminReportCardTemplate");

  let allPlayers = [];
  let allReports = [];

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

  // supabase-js hides the real Edge Function/RPC error message behind a
  // generic "non-2xx status code" string — pull the actual message back out.
  async function extractFunctionError(error) {
    if (!error) return "Something went wrong. Try again.";
    try {
      if (error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        if (body?.error) return body.error;
      }
    } catch (_) {}
    return error.message || "Something went wrong. Try again.";
  }

  // ================================================================ roster
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
    const reasonInput = node.querySelector("[data-redeem-reason]");
    const redeemBtn = node.querySelector("[data-redeem-btn]");
    const message = node.querySelector("[data-redeem-message]");

    redeemBtn.addEventListener("click", async () => {
      const amount = Number(amountInput.value);
      const reason = reasonInput.value.trim();

      if (!Number.isFinite(amount) || amount <= 0) {
        setMessage(message, "Enter a positive amount.", "error");
        return;
      }
      if (!reason) {
        setMessage(message, "Enter a reason (what did they get for these points?).", "error");
        return;
      }
      if (!window.confirm(`Redeem ${amount} points from ${row.username} for "${reason}"? This can't be undone.`)) return;

      redeemBtn.disabled = true;
      setMessage(message, "Processing…", "info");

      const { data, error } = await T.sb.functions.invoke("redeem-points", {
        body: { robloxUserId: row.roblox_user_id, amount, reason },
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
      reasonInput.value = "";
      setMessage(message, `Redeemed. New balance: ${T.formatNumber(data.newBalance)}.`, "success");
    });
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

  function renderRoster() {
    updateStatline();
    renderPlayers(allPlayers);
  }

  // ============================================================ analytics
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
    const totalPoints = allPlayers.reduce((sum, p) => sum + (p.points || 0), 0);

    el.statCards.innerHTML = "";
    el.statCards.appendChild(statCard("Testers tracked", total));
    el.statCards.appendChild(statCard("Avg. playtime", playtime.count ? T.formatDuration(playtime.avg) : "No data yet", playtime.count ? reportingSub(playtime.count, total) : null));
    el.statCards.appendChild(statCard("Avg. last session", session.count ? T.formatDuration(session.avg) : "No data yet", session.count ? reportingSub(session.count, total) : null));
    el.statCards.appendChild(statCard("Avg. Global XP", xp.count ? T.formatNumber(xp.avg) : "No data yet", xp.count ? reportingSub(xp.count, total) : null));
    el.statCards.appendChild(statCard("Avg. Stars", stars.count ? T.formatNumber(stars.avg) : "No data yet", stars.count ? reportingSub(stars.count, total) : null));
    el.statCards.appendChild(statCard("Avg. Plasma", plasma.count ? T.formatNumber(plasma.avg) : "No data yet", plasma.count ? reportingSub(plasma.count, total) : null));
    el.statCards.appendChild(statCard("Points outstanding", T.formatNumber(totalPoints), "across all testers"));
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
    renderLeaderboard(el.playtimeLeaderboard, (p) => p.data?.Playtime, T.formatDuration, "No playtime recorded yet — check back soon.");
    renderLeaderboard(el.xpLeaderboard, (p) => p.data?.GlobalXP, (v) => T.formatNumber(v), "No Global XP recorded yet.");
    renderLeaderboard(el.pointsLeaderboard, (p) => p.points, (v) => T.formatNumber(v), "No points awarded yet — go approve some bugs!");
  }

  el.gamemodeSelect.addEventListener("change", renderCompletion);

  // ================================================================ reports
  function renderMedia(container, media) {
    container.innerHTML = "";
    for (const item of media || []) {
      const link = document.createElement("a");
      link.className = "media-thumb";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Loading…";
      container.appendChild(link);

      T.getSignedMediaUrl(item.path).then((url) => {
        if (!url) {
          link.textContent = "Unavailable";
          return;
        }
        link.href = url;
        link.textContent = "";
        if (T.isVideo(item)) {
          const video = document.createElement("video");
          video.src = url;
          video.muted = true;
          link.appendChild(video);
        } else {
          const img = document.createElement("img");
          img.src = url;
          img.alt = item.name || "attachment";
          link.appendChild(img);
        }
      });
    }
  }

  function daysLeft(fromDate) {
    const expiresAt = new Date(fromDate).getTime() + 7 * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  function renderReportCard(report) {
    const node = reportCardTpl.content.cloneNode(true);
    const submitterName = report.players?.username || `User ${report.roblox_user_id}`;

    node.querySelector("[data-title]").textContent = report.title;
    node.querySelector("[data-submitter]").textContent = `Submitted by ${submitterName}`;

    const severityBadge = node.querySelector("[data-severity-badge]");
    const sevMeta = T.SEVERITY_META[report.severity] || { label: report.severity, className: "" };
    severityBadge.textContent = sevMeta.label;
    severityBadge.className = `badge ${sevMeta.className}`;

    const statusBadge = node.querySelector("[data-status-badge]");
    statusBadge.textContent = report.status;
    statusBadge.className = `badge badge--status-${report.status}`;

    const metaEl = node.querySelector("[data-meta]");
    if (report.status === "pending") {
      metaEl.textContent = T.timeAgo(report.created_at);
    } else if (report.status === "approved") {
      metaEl.textContent = `+${T.formatNumber(report.points_awarded ?? 0)} pts`;
    } else if (report.status === "resolved") {
      metaEl.textContent = `${daysLeft(report.resolved_at)}d left`;
    } else {
      metaEl.textContent = `${daysLeft(report.decided_at)}d left`;
    }

    node.querySelector("[data-type-badge]").textContent = report.bug_type;
    node.querySelector("[data-env-badge]").textContent = report.game_environment;
    node.querySelector("[data-description]").textContent = report.description;
    renderMedia(node.querySelector("[data-media]"), report.media);

    const actionMessage = node.querySelector("[data-action-message]");

    if (report.status === "pending") {
      const actions = node.querySelector("[data-pending-actions]");
      actions.hidden = false;

      const pointsInput = node.querySelector("[data-points-input]");
      const approveBtn = node.querySelector("[data-approve-btn]");
      const rejectBtn = node.querySelector("[data-reject-btn]");

      approveBtn.addEventListener("click", async () => {
        const points = Number(pointsInput.value);
        if (!Number.isFinite(points) || points < 0) {
          setMessage(actionMessage, "Enter a points value (0 or more).", "error");
          return;
        }
        approveBtn.disabled = true;
        const { error } = await T.sb.rpc("approve_bug_report", { p_report_id: report.id, p_points: points });
        approveBtn.disabled = false;
        if (error) {
          setMessage(actionMessage, await extractFunctionError(error), "error");
          return;
        }
        await loadReports();
      });

      rejectBtn.addEventListener("click", async () => {
        if (!window.confirm(`Reject "${report.title}"? It'll move to Trash for 7 days.`)) return;
        rejectBtn.disabled = true;
        const { error } = await T.sb.rpc("reject_bug_report", { p_report_id: report.id });
        rejectBtn.disabled = false;
        if (error) {
          setMessage(actionMessage, await extractFunctionError(error), "error");
          return;
        }
        await loadReports();
      });
    }

    if (report.status === "approved") {
      const actions = node.querySelector("[data-approved-actions]");
      actions.hidden = false;

      const resolveBtn = node.querySelector("[data-resolve-btn]");
      resolveBtn.addEventListener("click", async () => {
        if (!window.confirm(`Mark "${report.title}" as resolved? It'll move to the Resolved tab for 7 days.`)) return;
        resolveBtn.disabled = true;
        const { error } = await T.sb.rpc("resolve_bug_report", { p_report_id: report.id });
        resolveBtn.disabled = false;
        if (error) {
          setMessage(actionMessage, await extractFunctionError(error), "error");
          return;
        }
        await loadReports();
      });
    }

    if (report.status === "rejected") {
      const actions = node.querySelector("[data-trash-actions]");
      actions.hidden = false;
      node.querySelector("[data-countdown]").textContent = `Auto-deletes in ${daysLeft(report.decided_at)}d`;

      const restoreBtn = node.querySelector("[data-restore-btn]");
      const deleteBtn = node.querySelector("[data-delete-btn]");

      restoreBtn.addEventListener("click", async () => {
        restoreBtn.disabled = true;
        const { error } = await T.sb.rpc("restore_bug_report", { p_report_id: report.id });
        restoreBtn.disabled = false;
        if (error) {
          setMessage(actionMessage, await extractFunctionError(error), "error");
          return;
        }
        await loadReports();
      });

      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`Permanently delete "${report.title}"? This can't be undone.`)) return;
        deleteBtn.disabled = true;
        const { error } = await T.sb.rpc("delete_bug_report", { p_report_id: report.id });
        deleteBtn.disabled = false;
        if (error) {
          setMessage(actionMessage, await extractFunctionError(error), "error");
          return;
        }
        await loadReports();
      });
    }

    const head = node.querySelector("[data-toggle]");
    const body = node.querySelector("[data-body]");
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
    });

    return node;
  }

  function renderReportPanel(container, reports, emptyMessage) {
    container.innerHTML = "";
    if (!reports.length) {
      const p = document.createElement("p");
      p.className = "empty-state";
      p.textContent = emptyMessage;
      container.appendChild(p);
      return;
    }
    for (const r of reports) container.appendChild(renderReportCard(r));
  }

  function renderReports() {
    const pending = allReports.filter((r) => r.status === "pending");
    const approved = allReports.filter((r) => r.status === "approved");
    const resolved = allReports.filter((r) => r.status === "resolved");
    const trash = allReports.filter((r) => r.status === "rejected");

    el.pendingTabCount.textContent = pending.length ? `(${pending.length})` : "";
    el.reportsTabCount.textContent = pending.length ? `(${pending.length})` : "";
    renderReportPanel(el.pendingPanel, pending, "All clear — nothing pending right now! 🎉");
    renderReportPanel(el.approvedPanel, approved, "No approved reports yet.");
    renderReportPanel(el.resolvedPanel, resolved, "Nothing resolved yet.");
    renderReportPanel(el.trashPanel, trash, "Trash is empty — nice and tidy! ✨");
  }

  async function loadReports() {
    const { data, error } = await T.sb
      .from("bug_reports")
      .select(
        "id, title, description, severity, bug_type, game_environment, media, status, points_awarded, roblox_user_id, created_at, decided_at, resolved_at, players(username)"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("load reports (admin) error:", error);
      return;
    }
    allReports = data || [];
    renderReports();
  }

  const setReviewTab = T.wireTabs(
    el.reviewTabs,
    {
      pending: el.pendingPanel,
      approved: el.approvedPanel,
      resolved: el.resolvedPanel,
      trash: el.trashPanel,
    },
    {
      defaultView: "pending",
      onShow: (view) => {
        if (view === "trash") T.sb.rpc("purge_expired_rejected_reports").then(() => loadReports());
        if (view === "resolved") T.sb.rpc("purge_expired_resolved_reports").then(() => loadReports());
      },
    }
  );

  // ============================================================ top-level tabs
  T.wireTabs(
    el.sectionTabs,
    {
      roster: el.rosterView,
      analytics: el.analyticsView,
      reports: el.reportsView,
    },
    { defaultView: "roster" }
  );

  // ================================================================ auth flow
  function showOnly(sectionEl) {
    for (const s of [el.gate, el.denied, el.authorized]) s.hidden = s !== sectionEl;
  }

  async function checkAccessAndLoad(user) {
    T.renderAuthArea(el.authArea, user);
    const discordId = T.getDiscordId(user);
    const isAdmin = await T.checkIsAdmin(discordId);

    T.renderNav(el.pageNav, { isAdmin, isSignedIn: true, current: "admin", basePath: "" });

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
    } else {
      allPlayers = players || [];
      renderRoster();
      renderAnalytics();
    }

    showOnly(el.authorized);
    await loadReports();
  }

  async function handleSession(session) {
    if (!session) {
      T.renderAuthArea(el.authArea, null);
      T.renderNav(el.pageNav, { isAdmin: false, isSignedIn: false, current: "admin", basePath: "" });
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
