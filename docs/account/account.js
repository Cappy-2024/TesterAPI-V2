(() => {
  const T = window.TT;

  const el = {
    pageNav: document.getElementById("pageNav"),
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    loading: document.getElementById("loading"),
    verifyStart: document.getElementById("verifyStart"),
    verifyPending: document.getElementById("verifyPending"),
    authorized: document.getElementById("authorized"),
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

    accountTabs: document.getElementById("accountTabs"),
    reportsTabCount: document.getElementById("reportsTabCount"),

    // stats
    statsView: document.getElementById("statsView"),
    rankMetricSelect: document.getElementById("rankMetricSelect"),
    rankNote: document.getElementById("rankNote"),
    rankList: document.getElementById("rankList"),

    // reports
    reportsView: document.getElementById("reportsView"),
    newReportBtn: document.getElementById("newReportBtn"),
    pendingList: document.getElementById("pendingList"),
    pendingEmpty: document.getElementById("pendingEmpty"),
    pendingCount: document.getElementById("pendingCount"),
    approvedList: document.getElementById("approvedList"),
    approvedEmpty: document.getElementById("approvedEmpty"),
    approvedCount: document.getElementById("approvedCount"),
    resolvedList: document.getElementById("resolvedList"),
    resolvedEmpty: document.getElementById("resolvedEmpty"),
    resolvedCount: document.getElementById("resolvedCount"),
    overlay: document.getElementById("newReportOverlay"),
    form: document.getElementById("newReportForm"),
    titleInput: document.getElementById("titleInput"),
    descriptionInput: document.getElementById("descriptionInput"),
    severityInput: document.getElementById("severityInput"),
    typeInput: document.getElementById("typeInput"),
    envInput: document.getElementById("envInput"),
    mediaInput: document.getElementById("mediaInput"),
    formMessage: document.getElementById("formMessage"),
    submitBtn: document.getElementById("submitReportBtn"),
    cancelBtn: document.getElementById("cancelReportBtn"),
  };

  const gamemodeTpl = document.getElementById("gamemodeTemplate");
  const pathTpl = document.getElementById("pathTemplate");
  const reportCardTpl = document.getElementById("reportCardTemplate");

  const RANK_METRICS = {
    Stars: { label: "Stars", formatter: T.formatNumber },
    Plasma: { label: "Plasma", formatter: T.formatNumber },
    GlobalXP: { label: "Global XP", formatter: T.formatNumber },
    Playtime: { label: "Playtime", formatter: T.formatDuration },
    Points: { label: "Points", formatter: T.formatNumber },
  };

  let myDiscordId = null;
  let myRobloxUserId = null;

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

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

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.loading, el.verifyStart, el.verifyPending, el.authorized]) {
      s.hidden = s !== sectionEl;
    }
  }

  // ================================================================ stats
  function renderStats(row) {
    const data = row.data || {};
    const scope = el.statsView;

    scope.querySelector("[data-username]").textContent = row.username;
    scope.querySelector("[data-status]").dataset.fresh = T.freshness(row.updated_at);
    scope.querySelector("[data-updated]").textContent = `Last synced ${T.timeAgo(row.updated_at)}`;

    scope.querySelector("[data-stars]").textContent = T.formatNumber(data.Stars ?? 0);
    scope.querySelector("[data-plasma]").textContent = T.formatNumber(data.Plasma ?? 0);
    scope.querySelector("[data-points]").textContent = T.formatNumber(row.points ?? 0);
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

  async function renderRankNeighbors() {
    const metric = el.rankMetricSelect.value;
    const meta = RANK_METRICS[metric];

    el.rankList.innerHTML = `<p class="rank-loading">Loading…</p>`;

    const { data, error } = await T.sb.rpc("get_rank_neighbors", { p_metric: metric });

    if (error) {
      console.error("get_rank_neighbors error:", error);
      el.rankNote.textContent = "Couldn't load your ranking right now.";
      el.rankList.innerHTML = `<p class="empty-state">${T.esc(error.message || "Something went wrong.")}</p>`;
      return;
    }

    if (!data || !data.length) {
      el.rankNote.textContent = `No ${meta.label} data to rank yet.`;
      el.rankList.innerHTML = "";
      return;
    }

    const total = data[0].total;
    el.rankNote.textContent = `Ranked by ${meta.label.toLowerCase()}, out of ${total} tracked tester${total === 1 ? "" : "s"}.`;

    el.rankList.innerHTML = "";
    for (const row of data) {
      const item = document.createElement("div");
      item.className = "rank-row";
      item.dataset.isMe = String(row.is_me);
      item.innerHTML = `
        <span class="rank-row__num">#${row.rnk}</span>
        <span class="rank-row__name">${T.esc(row.is_me ? "You" : row.username)}</span>
        <span class="rank-row__value">${T.esc(meta.formatter(row.value))}</span>
      `;
      el.rankList.appendChild(item);
    }
  }

  el.rankMetricSelect.addEventListener("change", renderRankNeighbors);

  // ============================================================== reports
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

  function renderReportCard(report) {
    const node = reportCardTpl.content.cloneNode(true);

    node.querySelector("[data-title]").textContent = report.title;
    node.querySelector("[data-meta]").textContent = `Submitted ${T.timeAgo(report.created_at)}`;
    node.querySelector("[data-created]").textContent = T.timeAgo(report.created_at);

    const severityBadge = node.querySelector("[data-severity-badge]");
    const meta = T.SEVERITY_META[report.severity] || { label: report.severity, className: "" };
    severityBadge.textContent = meta.label;
    severityBadge.className = `badge ${meta.className}`;

    const pointsBadge = node.querySelector("[data-points-badge]");
    if ((report.status === "approved" || report.status === "resolved") && report.points_awarded != null) {
      pointsBadge.textContent = `+${T.formatNumber(report.points_awarded)} pts`;
      pointsBadge.hidden = false;
    }

    node.querySelector("[data-type-badge]").textContent = report.bug_type;
    node.querySelector("[data-env-badge]").textContent = report.game_environment;
    node.querySelector("[data-description]").textContent = report.description;
    renderMedia(node.querySelector("[data-media]"), report.media);

    const head = node.querySelector("[data-toggle]");
    const body = node.querySelector("[data-body]");
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
    });

    return node;
  }

  function renderReportLists(reports) {
    const pending = reports.filter((r) => r.status === "pending");
    const approved = reports.filter((r) => r.status === "approved");
    const resolved = reports.filter((r) => r.status === "resolved");

    el.pendingList.innerHTML = "";
    el.pendingCount.textContent = pending.length ? `(${pending.length})` : "";
    el.pendingEmpty.hidden = pending.length !== 0;
    for (const r of pending) el.pendingList.appendChild(renderReportCard(r));

    el.approvedList.innerHTML = "";
    el.approvedCount.textContent = approved.length ? `(${approved.length})` : "";
    el.approvedEmpty.hidden = approved.length !== 0;
    for (const r of approved) el.approvedList.appendChild(renderReportCard(r));

    el.resolvedList.innerHTML = "";
    el.resolvedCount.textContent = resolved.length ? `(${resolved.length})` : "";
    el.resolvedEmpty.hidden = resolved.length !== 0;
    for (const r of resolved) el.resolvedList.appendChild(renderReportCard(r));

    el.reportsTabCount.textContent = pending.length ? `(${pending.length})` : "";
  }

  async function loadReports() {
    const { data, error } = await T.sb
      .from("bug_reports")
      .select("id, title, description, severity, bug_type, game_environment, media, status, points_awarded, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("load reports error:", error);
      return;
    }
    renderReportLists(data || []);
  }

  function openModal() {
    el.form.reset();
    setMessage(el.formMessage, "", "");
    el.overlay.hidden = false;
  }
  function closeModal() {
    el.overlay.hidden = true;
  }

  el.newReportBtn.addEventListener("click", openModal);
  el.cancelBtn.addEventListener("click", closeModal);
  el.overlay.addEventListener("click", (e) => {
    if (e.target === el.overlay) closeModal();
  });

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const files = Array.from(el.mediaInput.files || []);
    if (files.length > 3) {
      setMessage(el.formMessage, "Please attach 3 files or fewer.", "error");
      return;
    }

    el.submitBtn.disabled = true;
    setMessage(el.formMessage, files.length ? "Uploading media…" : "Submitting…", "info");

    const reportId = crypto.randomUUID();

    try {
      let media = [];
      if (files.length) {
        media = await T.uploadReportMedia(files, myDiscordId, reportId);
      }

      setMessage(el.formMessage, "Submitting…", "info");

      const { error } = await T.sb.from("bug_reports").insert({
        id: reportId,
        roblox_user_id: myRobloxUserId,
        discord_id: myDiscordId,
        title: el.titleInput.value.trim(),
        description: el.descriptionInput.value.trim(),
        severity: el.severityInput.value,
        bug_type: el.typeInput.value,
        game_environment: el.envInput.value,
        media,
      });

      if (error) throw new Error(error.message);

      closeModal();
      await loadReports();
    } catch (err) {
      setMessage(el.formMessage, err.message || "Something went wrong. Try again.", "error");
    } finally {
      el.submitBtn.disabled = false;
    }
  });

  T.wireTabs(
    el.accountTabs,
    { stats: el.statsView, reports: el.reportsView },
    { defaultView: "stats" }
  );

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
      setMessage(el.startMessage, await extractFunctionError(error), "error");
      return;
    }
    if (data?.error) {
      setMessage(el.startMessage, data.error, "error");
      return;
    }
    if (data?.alreadyLinked) {
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
      setMessage(el.pendingMessage, await extractFunctionError(error), "error");
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
      setMessage(el.pendingMessage, "Verified, but couldn't load your account — refresh the page.", "error");
    }
  });

  el.restartBtn.addEventListener("click", () => {
    el.usernameInput.value = pendingUsernameValue;
    setMessage(el.startMessage, "", "");
    showOnly(el.verifyStart);
  });

  // -------------------------------------------------------------- shared
  async function loadLinkedProfile(discordId) {
    const { data: row, error } = await T.sb
      .from("players")
      .select("roblox_user_id, username, data, points, updated_at")
      .eq("discord_id", discordId)
      .maybeSingle();

    if (error) return null;
    return row;
  }

  async function showLinkedProfile(row) {
    myRobloxUserId = row.roblox_user_id;
    renderStats(row);
    showOnly(el.authorized);
    await renderRankNeighbors();
    await loadReports();
  }

  // -------------------------------------------------------------- auth flow
  async function handleSession(session) {
    if (!session) {
      T.renderAuthArea(el.authArea, null);
      T.renderNav(el.pageNav, { isAdmin: false, isSignedIn: false, current: "account", basePath: "../" });
      showOnly(el.gate);
      return;
    }

    T.renderAuthArea(el.authArea, session.user);
    showOnly(el.loading);

    const discordId = T.getDiscordId(session.user);
    myDiscordId = discordId;

    const isAdmin = await T.checkIsAdmin(discordId);
    T.renderNav(el.pageNav, { isAdmin, isSignedIn: true, current: "account", basePath: "../" });

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
