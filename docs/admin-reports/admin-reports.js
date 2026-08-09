(() => {
  const T = window.TT;

  const el = {
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    denied: document.getElementById("denied"),
    deniedName: document.getElementById("deniedName"),
    authorized: document.getElementById("authorized"),
    loginBtn: document.getElementById("loginBtn"),
    logoutFromDenied: document.getElementById("logoutFromDenied"),
    reviewTabs: document.getElementById("reviewTabs"),
    pendingPanel: document.getElementById("pendingPanel"),
    approvedPanel: document.getElementById("approvedPanel"),
    resolvedPanel: document.getElementById("resolvedPanel"),
    trashPanel: document.getElementById("trashPanel"),
    pendingTabCount: document.getElementById("pendingTabCount"),
    reviewEmpty: document.getElementById("reviewEmpty"),
  };

  const cardTpl = document.getElementById("adminReportCardTemplate");

  let allReports = [];
  let trashPurged = false;
  let resolvedPurged = false;

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

  function daysLeft(decidedAt) {
    const expiresAt = new Date(decidedAt).getTime() + 7 * 24 * 60 * 60 * 1000;
    const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
    return days;
  }

  function renderCard(report) {
    const node = cardTpl.content.cloneNode(true);
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

  function renderPanel(container, reports, emptyMessage) {
    container.innerHTML = "";
    if (!reports.length) {
      const p = document.createElement("p");
      p.className = "empty-state";
      p.textContent = emptyMessage;
      container.appendChild(p);
      return;
    }
    for (const r of reports) container.appendChild(renderCard(r));
  }

  function renderAll() {
    const pending = allReports.filter((r) => r.status === "pending");
    const approved = allReports.filter((r) => r.status === "approved");
    const resolved = allReports.filter((r) => r.status === "resolved");
    const trash = allReports.filter((r) => r.status === "rejected");

    el.pendingTabCount.textContent = pending.length ? `(${pending.length})` : "";
    renderPanel(el.pendingPanel, pending, "Nothing pending right now.");
    renderPanel(el.approvedPanel, approved, "No approved reports yet.");
    renderPanel(el.resolvedPanel, resolved, "Nothing resolved yet.");
    renderPanel(el.trashPanel, trash, "Trash is empty.");
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
      el.reviewEmpty.hidden = false;
      el.reviewEmpty.textContent = `Couldn't load reports: ${error.message}`;
      return;
    }

    allReports = data || [];
    renderAll();
  }

  // -------------------------------------------------------------- tabs
  function setActiveTab(view) {
    el.pendingPanel.hidden = view !== "pending";
    el.approvedPanel.hidden = view !== "approved";
    el.resolvedPanel.hidden = view !== "resolved";
    el.trashPanel.hidden = view !== "trash";
    for (const btn of el.reviewTabs.querySelectorAll("[data-view]")) {
      btn.classList.toggle("tab--active", btn.dataset.view === view);
    }
    if (view === "trash" && !trashPurged) {
      trashPurged = true;
      T.sb.rpc("purge_expired_rejected_reports").then(() => loadReports());
    }
    if (view === "resolved" && !resolvedPurged) {
      resolvedPurged = true;
      T.sb.rpc("purge_expired_resolved_reports").then(() => loadReports());
    }
  }

  el.reviewTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) setActiveTab(btn.dataset.view);
  });

  // -------------------------------------------------------------- auth flow
  function showOnly(sectionEl) {
    for (const s of [el.gate, el.denied, el.authorized]) s.hidden = s !== sectionEl;
    if (sectionEl === el.authorized) setActiveTab("pending");
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

    showOnly(el.authorized);
    await loadReports();
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
