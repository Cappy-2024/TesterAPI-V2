(() => {
  const T = window.TT;

  const el = {
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    notLinked: document.getElementById("notLinked"),
    reportsView: document.getElementById("reportsView"),
    loginBtn: document.getElementById("loginBtn"),
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

  const reportCardTpl = document.getElementById("reportCardTemplate");

  let myDiscordId = null;
  let myRobloxUserId = null;

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.notLinked, el.reportsView]) s.hidden = s !== sectionEl;
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
      const open = body.hidden;
      body.hidden = !open;
    });

    return node;
  }

  function renderLists(reports) {
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
    renderLists(data || []);
  }

  // -------------------------------------------------------------- new report modal
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

  // -------------------------------------------------------------- auth flow
  async function handleSession(session) {
    if (!session) {
      T.renderAuthArea(el.authArea, null);
      showOnly(el.gate);
      return;
    }

    T.renderAuthArea(el.authArea, session.user);
    myDiscordId = T.getDiscordId(session.user);

    const { data: row } = await T.sb
      .from("players")
      .select("roblox_user_id")
      .eq("discord_id", myDiscordId)
      .maybeSingle();

    if (!row) {
      showOnly(el.notLinked);
      return;
    }

    myRobloxUserId = row.roblox_user_id;
    showOnly(el.reportsView);
    await loadReports();
  }

  el.loginBtn.addEventListener("click", () => T.signInWithDiscord());

  T.initAuth(handleSession);
})();
