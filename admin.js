// ══════════════════════════════════════════════════════════════
//  admin.js  –  EventVerify Admin Portal (v3)
//  ✔ Events: create / edit / delete (reflects on student portal)
//  ✔ Registrations: view per event, filter by event/status/role, delete
//  ✔ Students: view all, delete
//  ✔ QR Scanner: mark attendance directly from admin
//  ✔ Organizer info shown per event card
// ══════════════════════════════════════════════════════════════

const API = "http://localhost:5000/api";
let authToken = null;
let _allRegs = [];
let _allWebStudents = [];
let _allEvents = [];

const $ = (id) => document.getElementById(id);
const gv = (id) => $(id)?.value?.trim() || "";
const sv = (id, v) => {
  const el = $(id);
  if (el) el.value = v;
};
const esc = (s) => (s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function toast(msg, type = "info") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3600);
}

function setLoading(id, on, label) {
  const b = $(id);
  if (!b) return;
  b.disabled = on;
  b.innerHTML = on
    ? `<span class="spinner spinner-dark"></span>${label}`
    : label;
}

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo(0, 0);
}

function openModal(id) {
  $(id).classList.add("open");
}
function closeModal(id) {
  $(id).classList.remove("open");
}
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("open");
});

async function apiFetch(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── INIT ─────────────────────────────────────────────────────
window.onload = () => {
  const saved = sessionStorage.getItem("ev_admin_session");
  if (saved) {
    authToken = JSON.parse(saved).token;
    goDashboard();
  } else showScreen("screen-login");
};

// ── LOGIN / LOGOUT ────────────────────────────────────────────
async function doLogin() {
  const email = gv("al-email"),
    pass = gv("al-pass");
  if (!email || !pass) return toast("Enter email and password", "error");
  setLoading("btn-admin-login", true, "Signing in…");
  try {
    const { ok, data } = await apiFetch("/login", {
      method: "POST",
      body: JSON.stringify({ email, password: pass }),
    });
    if (!ok) return toast(data.message || "Invalid credentials", "error");
    if (data.user.role !== "admin")
      return toast("Not an admin account", "error");
    authToken = data.token;
    sessionStorage.setItem(
      "ev_admin_session",
      JSON.stringify({ token: data.token, user: data.user }),
    );
    toast("Welcome, Administrator!", "success");
    goDashboard();
  } catch {
    toast("Server error. Is the backend running?", "error");
  } finally {
    setLoading("btn-admin-login", false, "Sign In as Admin →");
  }
}

function doLogout() {
  sessionStorage.removeItem("ev_admin_session");
  authToken = null;
  showScreen("screen-login");
  toast("Logged out", "info");
}

function goDashboard() {
  loadStats();
  renderAdminEvents();
  showScreen("screen-dashboard");
}

// ── TAB SWITCH ────────────────────────────────────────────────
function switchTab(tab, btn) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  btn?.classList.add("active");
  ["events", "event-regs", "all-students", "certificates"].forEach((t) => {
    const el = $(`tab-${t}`);
    if (el) el.style.display = t === tab ? "block" : "none";
  });
  if (tab === "events") renderAdminEvents();
  if (tab === "event-regs") loadEventRegs();
  if (tab === "all-students") loadWebsiteStudents();
  if (tab === "certificates") loadCertificatesTab();
}

// ── STATS ─────────────────────────────────────────────────────
async function loadStats() {
  try {
    const { ok, data } = await apiFetch("/admin/stats");
    if (!ok) return;
    const { events, students, registrations, attended, pendingCerts } =
      data.stats;
    $("admin-stats").innerHTML = `
      <div class="stat-card clickable" onclick="switchTab('events',document.querySelector('[data-tab=events]'))">
        <div class="stat-num" style="color:var(--warn)">${events}</div>
        <div class="stat-label">Total Events</div><div class="stat-hint">Click to manage →</div>
      </div>
      <div class="stat-card clickable" onclick="switchTab('all-students',document.querySelector('[data-tab=all-students]'))">
        <div class="stat-num" style="color:var(--accent)">${students}</div>
        <div class="stat-label">Students</div><div class="stat-hint">Click to view →</div>
      </div>
      <div class="stat-card clickable" onclick="switchTab('event-regs',document.querySelector('[data-tab=event-regs]'))">
        <div class="stat-num" style="color:var(--accent2)">${registrations}</div>
        <div class="stat-label">Registrations</div><div class="stat-hint">Click to view →</div>
      </div>
      <div class="stat-card clickable" onclick="switchTab('event-regs',document.querySelector('[data-tab=event-regs]'))">
        <div class="stat-num" style="color:#a78bfa">${attended}</div>
        <div class="stat-label">Attended</div><div class="stat-hint">Click to view →</div>
      </div>
      <div class="stat-card clickable" onclick="switchTab('certificates',document.querySelector('[data-tab=certificates]'))">
        <div class="stat-num" style="color:var(--warn)">${pendingCerts || 0}</div>
        <div class="stat-label">Pending Certs</div>
        <div class="stat-hint">${(pendingCerts || 0) > 0 ? "⚠️ Needs approval →" : "All approved ✓"}</div>
      </div>`;
  } catch {}
}

// ── EVENTS TAB ────────────────────────────────────────────────
async function renderAdminEvents() {
  const grid = $("admin-events-grid");
  grid.innerHTML = `<div class="loading-state" style="grid-column:1/-1">Loading events…</div>`;
  try {
    const [evRes, regRes] = await Promise.all([
      apiFetch("/events"),
      apiFetch("/registrations"),
    ]);
    _allEvents = evRes.data.events || [];
    _allRegs = regRes.data.registrations || [];

    if (!_allEvents.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-text">No events yet. Click "Add New Event" to get started.</div></div>`;
      return;
    }

    // Fetch organizer info for all events in parallel
    const orgResults = await Promise.all(
      _allEvents.map((ev) =>
        apiFetch(`/admin/events/${ev.id}/organizer`).catch(() => ({
          data: { organizer: null },
        })),
      ),
    );
    const orgMap = {};
    _allEvents.forEach((ev, i) => {
      orgMap[ev.id] = orgResults[i]?.data?.organizer || null;
    });

    grid.innerHTML = _allEvents
      .map((ev) => {
        const evRegs = _allRegs.filter(
          (r) => r.event_id === ev.id && r.event_role !== "organizer",
        );
        const attended = evRegs.filter((r) => r.status === "attended").length;
        const et = esc(ev.title);
        const ed = esc(ev.description || "");
        const org = orgMap[ev.id];
        return `
      <div class="admin-event-card">
        <div class="ev-title">${ev.title}</div>
        ${ev.has_certificate ? `<span style="display:inline-block;margin-bottom:6px;padding:3px 10px;background:#a78bfa20;color:#a78bfa;border:1px solid #a78bfa40;border-radius:20px;font-size:11px;font-weight:700">🎓 Certificate Event</span>` : ""}
        <div class="ev-meta">📅 ${fmtDate(ev.event_date)}${ev.event_time ? " · ⏰ " + ev.event_time.slice(0, 5) : ""}</div>
        <div class="ev-meta">📍 ${ev.venue || "—"}</div>
        ${ev.description ? `<div class="ev-desc">${ev.description}</div>` : ""}
        ${org ? `<div class="org-tag">🏆 Organizer: ${org.full_name}</div>` : `<div style="font-size:11px;color:var(--muted);margin:4px 0">No organizer assigned yet</div>`}
        <div class="ev-stats">
          <div class="ev-stat"><div class="ev-stat-num" style="color:var(--accent)">${evRegs.length}</div><div class="ev-stat-lbl">Registered</div></div>
          <div class="ev-stat"><div class="ev-stat-num" style="color:var(--accent2)">${attended}</div><div class="ev-stat-lbl">Attended</div></div>
          <div class="ev-stat"><div class="ev-stat-num" style="color:var(--warn)">${evRegs.length - attended}</div><div class="ev-stat-lbl">Pending</div></div>
        </div>
        <div class="ev-actions">
          <button class="ev-btn-a ev-btn-view-regs" onclick="showEventDetailModal(${ev.id},'${et}')">👁 View Regs</button>
          <button class="ev-btn-a ev-btn-edit" onclick="openEditEvent(${ev.id})">✏️ Edit</button>
          <button class="ev-btn-a ev-btn-del" onclick="confirmDeleteEvent(${ev.id},'${et}')">🗑️ Delete</button>
        </div>
      </div>`;
      })
      .join("");
    populateEventFilter();
  } catch {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><div class="empty-text">Server error. Check the backend.</div></div>`;
  }
}

function populateEventFilter() {
  const sel = $("ev-reg-filter");
  if (!sel) return;
  sel.innerHTML =
    `<option value="">All Events</option>` +
    _allEvents
      .map((ev) => `<option value="${ev.id}">${ev.title}</option>`)
      .join("");
}

// ── ADD / EDIT EVENT ──────────────────────────────────────────
function openAddEvent() {
  sv("ev-edit-id", "");
  sv("ev-name", "");
  sv("ev-time", "");
  sv("ev-venue", "");
  sv("ev-capacity", "");
  sv("ev-desc", "");
  const c = $("ev-has-cert");
  if (c) c.checked = false;
  $("ev-modal-title").textContent = "Add New Event";
  $("ev-modal-sub").textContent =
    "Fill in the event details. Students can register immediately after.";
  $("ev-save-btn").textContent = "Add Event →";
  openModal("modal-event");
}

function openEditEvent(id) {
  const ev = _allEvents.find((e) => e.id === id);
  if (!ev) return;
  sv("ev-edit-id", id);
  sv("ev-name", ev.title);
  sv("ev-venue", ev.venue || "");
  sv("ev-capacity", ev.capacity || "");
  sv("ev-desc", ev.description || "");
  const c = $("ev-has-cert");
  if (c) c.checked = !!ev.has_certificate;
  if (ev.event_date) {
    const dt = ev.event_date.split("T")[0];
    const tm = ev.event_time ? ev.event_time.slice(0, 5) : "00:00";
    sv("ev-time", `${dt}T${tm}`);
  }
  $("ev-modal-title").textContent = "Edit Event";
  $("ev-modal-sub").textContent = "Update the event details below.";
  $("ev-save-btn").textContent = "Save Changes →";
  openModal("modal-event");
}

async function saveEvent() {
  const id = gv("ev-edit-id"),
    title = gv("ev-name"),
    time = gv("ev-time"),
    venue = gv("ev-venue");
  const capacity = gv("ev-capacity"),
    desc = gv("ev-desc"),
    hasCert = $("ev-has-cert")?.checked ? 1 : 0;
  if (!title || !time || !venue)
    return toast("Event name, date/time and venue are required", "error");
  const body = {
    title,
    time,
    venue,
    description: desc,
    capacity: capacity || 200,
    has_certificate: hasCert,
  };
  const isEdit = !!id;
  $("ev-save-btn").disabled = true;
  $("ev-save-btn").textContent = "Saving…";
  try {
    const { ok, data } = await apiFetch(isEdit ? `/events/${id}` : "/events", {
      method: isEdit ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    if (!ok) return toast(data.message || "Failed to save event", "error");
    closeModal("modal-event");
    toast(isEdit ? "Event updated!" : "Event created!", "success");
    renderAdminEvents();
    loadStats();
  } catch {
    toast("Server error", "error");
  } finally {
    $("ev-save-btn").disabled = false;
    $("ev-save-btn").textContent = isEdit ? "Save Changes →" : "Add Event →";
  }
}

// ── DELETE EVENT ──────────────────────────────────────────────
function confirmDeleteEvent(id, title) {
  $("delete-modal-icon").textContent = "🗑️";
  $("delete-modal-title").textContent = "Delete Event?";
  $("delete-modal-sub").textContent =
    `"${title}" and all its registrations will be permanently deleted.`;
  const btn = $("confirm-delete-btn");
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      const { ok, data } = await apiFetch(`/events/${id}`, {
        method: "DELETE",
      });
      if (!ok) return toast(data.message || "Delete failed", "error");
      closeModal("modal-delete");
      toast("Event deleted", "success");
      renderAdminEvents();
      loadStats();
    } catch {
      toast("Server error", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Yes, Delete";
    }
  };
  openModal("modal-delete");
}

// ── EVENT DETAIL MODAL ────────────────────────────────────────
async function showEventDetailModal(eventId, eventTitle) {
  $("ev-detail-title").textContent = `Registrations – ${eventTitle}`;
  $("ev-detail-sub").textContent = "Loading…";
  $("ev-detail-tbody").innerHTML =
    `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">Loading…</td></tr>`;
  $("ev-detail-org-info").style.display = "none";
  openModal("modal-ev-detail");
  try {
    const [regRes, orgRes] = await Promise.all([
      apiFetch(`/events/${eventId}/registrations`),
      apiFetch(`/admin/events/${eventId}/organizer`),
    ]);
    const regs = regRes.data.registrations || [];
    const org = orgRes.data?.organizer;
    if (org) {
      $("ev-detail-org-info").style.display = "block";
      $("ev-detail-org-info").textContent =
        `🏆 Organizer: ${org.full_name} · ${org.email}`;
    }
    const participants = regs.filter(
      (r) => (r.event_role || "participant") !== "organizer",
    );
    $("ev-detail-sub").textContent =
      `${participants.length} participant(s) · ${participants.filter((r) => r.status === "attended").length} attended`;
    if (!regs.length) {
      $("ev-detail-tbody").innerHTML =
        `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">No registrations yet.</td></tr>`;
      return;
    }
    $("ev-detail-tbody").innerHTML = regs
      .map((r, i) => {
        const attended = r.status === "attended";
        const isOrg = (r.event_role || "participant") === "organizer";
        return `<tr>
        <td>${i + 1}</td>
        <td><strong>${r.studentName}</strong></td>
        <td>${r.studentRoll || "—"}</td>
        <td>${r.branch || "—"}</td>
        <td><span class="badge ${isOrg ? "badge-org" : "badge-pending"}" style="${isOrg ? "background:#a78bfa20;color:#a78bfa" : ""}">${isOrg ? "🏆 Organizer" : "🎓 Participant"}</span></td>
        <td><span class="badge ${attended ? "badge-ok" : "badge-pending"}">${attended ? "✓ Attended" : "Pending"}</span></td>
        <td>${
          isOrg
            ? "—"
            : attended
              ? `<button class="btn btn-ghost btn-sm" onclick="unmarkAttendance(${r.id},this)">Unmark</button>`
              : `<button class="btn btn-success btn-sm" onclick="markAttendance(${r.id},this)">Mark Present</button>`
        }</td>
      </tr>`;
      })
      .join("");
  } catch {
    $("ev-detail-sub").textContent = "Error loading registrations.";
  }
}

// ── REGISTRATIONS TAB ─────────────────────────────────────────
async function loadEventRegs() {
  const tbody = $("ev-regs-tbody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--muted)">Loading…</td></tr>`;
  try {
    const [evRes, regRes] = await Promise.all([
      apiFetch("/events"),
      apiFetch("/registrations"),
    ]);
    if (evRes.ok) _allEvents = evRes.data.events || [];
    if (regRes.ok) _allRegs = regRes.data.registrations || [];
    else {
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--danger)">Failed: ${regRes.data?.message || "Server error"}</td></tr>`;
      populateEventFilter();
      return;
    }
    populateEventFilter();
  } catch {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--danger)">Network error.</td></tr>`;
    return;
  }
  renderEventRegsTable();
}

function renderEventRegsTable() {
  const tbody = $("ev-regs-tbody");
  if (!tbody) return;
  const evId = gv("ev-reg-filter"),
    status = gv("ev-reg-status"),
    role = gv("ev-reg-role");
  const search = ($("ev-reg-search")?.value || "").toLowerCase();

  let rows = _allRegs;
  if (evId) rows = rows.filter((r) => String(r.event_id) === evId);
  if (status) rows = rows.filter((r) => r.status === status);
  if (role) rows = rows.filter((r) => (r.event_role || "participant") === role);
  if (search)
    rows = rows.filter(
      (r) =>
        (r.studentName || "").toLowerCase().includes(search) ||
        (r.studentRoll || "").toLowerCase().includes(search) ||
        (r.studentEmail || "").toLowerCase().includes(search),
    );

  const countEl = $("ev-reg-count");
  if (countEl) countEl.textContent = `Showing ${rows.length} registration(s)`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--muted)">No registrations found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r, i) => {
      const attended = r.status === "attended";
      const isOrg = (r.event_role || "participant") === "organizer";
      return `<tr>
      <td>${i + 1}</td>
      <td><strong>${r.studentName}</strong></td>
      <td>${r.studentRoll || "—"}</td>
      <td style="font-size:12px">${r.studentEmail || "—"}</td>
      <td>${r.branch || "—"}</td>
      <td>${r.college || "—"}</td>
      <td>${r.eventName}</td>
      <td><span class="badge ${isOrg ? "" : "badge-pending"}" style="${isOrg ? "background:#a78bfa20;color:#a78bfa;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700" : ""}">${isOrg ? "🏆 Organizer" : "🎓 Participant"}</span></td>
      <td style="font-size:12px;color:var(--sub)">${fmtDateTime(r.created_at)}</td>
      <td><span class="badge ${attended ? "badge-ok" : "badge-pending"}">${attended ? "✓ Attended" : "Pending"}</span></td>
      <td style="white-space:nowrap">
        ${
          isOrg
            ? "—"
            : attended
              ? `<button class="btn btn-ghost btn-sm" style="margin-right:4px" onclick="unmarkAttendanceTable(${r.id},this)">Unmark</button>`
              : `<button class="btn btn-success btn-sm" style="margin-right:4px" onclick="markAttendanceTable(${r.id},this)">✓ Present</button>`
        }
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteReg(${r.id},this)">Del</button>
      </td>
    </tr>`;
    })
    .join("");
}

async function markAttendanceTable(regId, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok, data } = await apiFetch(`/registrations/${regId}/attendance`, {
      method: "PATCH",
    });
    if (!ok) return toast(data.message || "Failed", "error");
    const reg = _allRegs.find((r) => r.id === regId);
    if (reg) reg.status = "attended";
    renderEventRegsTable();
    loadStats();
    toast("Attendance marked!", "success");
  } catch {
    toast("Server error", "error");
  } finally {
    btn.disabled = false;
  }
}

async function unmarkAttendanceTable(regId, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok, data } = await apiFetch(
      `/registrations/${regId}/unattendance`,
      { method: "PATCH" },
    );
    if (!ok) return toast(data.message || "Failed", "error");
    const reg = _allRegs.find((r) => r.id === regId);
    if (reg) reg.status = "registered";
    renderEventRegsTable();
    loadStats();
    toast("Attendance unmarked", "info");
  } catch {
    toast("Server error", "error");
  } finally {
    btn.disabled = false;
  }
}

function confirmDeleteReg(regId) {
  $("delete-modal-icon").textContent = "🗑️";
  $("delete-modal-title").textContent = "Delete Registration?";
  $("delete-modal-sub").textContent =
    "This student's event registration will be permanently removed.";
  const btn = $("confirm-delete-btn");
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      const { ok, data } = await apiFetch(`/registrations/${regId}`, {
        method: "DELETE",
      });
      if (!ok) return toast(data.message || "Failed", "error");
      _allRegs = _allRegs.filter((r) => r.id !== regId);
      renderEventRegsTable();
      loadStats();
      closeModal("modal-delete");
      toast("Registration deleted", "success");
    } catch {
      toast("Server error", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Yes, Delete";
    }
  };
  openModal("modal-delete");
}

// Attendance from event detail modal
async function markAttendance(regId, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok } = await apiFetch(`/registrations/${regId}/attendance`, {
      method: "PATCH",
    });
    if (!ok) {
      toast("Failed", "error");
      return;
    }
    const reg = _allRegs.find((r) => r.id === regId);
    if (reg) reg.status = "attended";
    const tr = btn.closest("tr");
    tr.querySelectorAll(".badge")[1].className = "badge badge-ok";
    tr.querySelectorAll(".badge")[1].textContent = "✓ Attended";
    btn.outerHTML = `<button class="btn btn-ghost btn-sm" onclick="unmarkAttendance(${regId},this)">Unmark</button>`;
    loadStats();
    toast("Attendance marked!", "success");
  } catch {
    toast("Server error", "error");
  }
}

async function unmarkAttendance(regId, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok } = await apiFetch(`/registrations/${regId}/unattendance`, {
      method: "PATCH",
    });
    if (!ok) {
      toast("Failed", "error");
      return;
    }
    const reg = _allRegs.find((r) => r.id === regId);
    if (reg) reg.status = "registered";
    const tr = btn.closest("tr");
    tr.querySelectorAll(".badge")[1].className = "badge badge-pending";
    tr.querySelectorAll(".badge")[1].textContent = "Pending";
    btn.outerHTML = `<button class="btn btn-success btn-sm" onclick="markAttendance(${regId},this)">Mark Present</button>`;
    loadStats();
    toast("Attendance unmarked", "info");
  } catch {
    toast("Server error", "error");
  }
}

// ── STUDENTS TAB ──────────────────────────────────────────────
async function loadWebsiteStudents() {
  $("ws-tbody").innerHTML =
    `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted)">Loading…</td></tr>`;
  try {
    const { ok, data } = await apiFetch("/admin/students");
    if (!ok) return;
    _allWebStudents = data.students || [];
    renderWebsiteStudents();
  } catch {
    toast("Server error", "error");
  }
}

function renderWebsiteStudents() {
  const search = ($("ws-search")?.value || "").toLowerCase();
  const rows = _allWebStudents.filter(
    (s) =>
      !search ||
      (s.full_name || "").toLowerCase().includes(search) ||
      (s.roll_number || "").toLowerCase().includes(search) ||
      (s.email || "").toLowerCase().includes(search),
  );
  $("ws-count").textContent = `Showing ${rows.length} student(s)`;
  if (!rows.length) {
    $("ws-tbody").innerHTML =
      `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted)">No students found.</td></tr>`;
    return;
  }
  $("ws-tbody").innerHTML = rows
    .map(
      (s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${s.full_name}</strong></td>
      <td>${s.roll_number || "—"}</td>
      <td style="font-size:12px">${s.email}</td>
      <td>${s.phone || "—"}</td>
      <td>${s.branch || "—"}</td>
      <td>${s.department || "—"}</td>
      <td style="font-size:12px;color:var(--sub)">${fmtDate(s.created_at)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent(${s.id},'${esc(s.full_name)}')">🗑 Delete</button></td>
    </tr>`,
    )
    .join("");
}

function confirmDeleteStudent(id, name) {
  $("delete-modal-icon").textContent = "👤";
  $("delete-modal-title").textContent = "Delete Student?";
  $("delete-modal-sub").textContent =
    `"${name}" will be permanently removed along with all event registrations.`;
  const btn = $("confirm-delete-btn");
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      const { ok, data } = await apiFetch(`/admin/students/${id}`, {
        method: "DELETE",
      });
      if (!ok) return toast(data.message || "Delete failed", "error");
      _allWebStudents = _allWebStudents.filter((s) => s.id !== id);
      renderWebsiteStudents();
      loadStats();
      closeModal("modal-delete");
      toast("Student deleted", "success");
    } catch {
      toast("Server error", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Yes, Delete";
    }
  };
  openModal("modal-delete");
}

// ── QR SCANNER ────────────────────────────────────────────────
function ensureJsQR(callback) {
  if (typeof jsQR !== "undefined") {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js";
  script.onload = callback;
  script.onerror = () =>
    toast("QR library failed. Use manual token entry.", "error");
  document.head.appendChild(script);
}

async function handleQRUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  const resultDiv = $("scan-result");
  if (resultDiv)
    resultDiv.innerHTML = `<div style="text-align:center;padding:20px;color:var(--sub)"><span class="spinner" style="width:18px;height:18px;border-width:3px;display:inline-block;vertical-align:middle;margin-right:8px;border-top-color:var(--warn)"></span>Reading QR image…</div>`;
  await new Promise((resolve) => ensureJsQR(resolve));
  const reader = new FileReader();
  reader.onerror = () => {
    if (resultDiv) resultDiv.innerHTML = "";
    toast("Could not read file.", "error");
  };
  reader.onload = (ev) => {
    const img = new Image();
    img.onerror = () => {
      if (resultDiv) resultDiv.innerHTML = "";
      toast("Could not load image.", "error");
    };
    img.onload = () => {
      try {
        const MAX = 600,
          scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale),
          h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const decoded =
          jsQR(imgData.data, w, h, { inversionAttempts: "dontInvert" }) ||
          jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
        if (decoded) processQRData(decoded.data);
        else {
          if (resultDiv) resultDiv.innerHTML = "";
          toast("Could not read QR. Try manual token entry.", "error");
        }
      } catch {
        if (resultDiv) resultDiv.innerHTML = "";
        toast("Error reading image.", "error");
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function processManual() {
  const raw = gv("manual-qr");
  if (!raw) return toast("Paste QR token or JSON data first", "error");
  processQRData(raw);
}

function extractToken(raw) {
  try {
    const p = JSON.parse(raw.trim());
    return p.token || raw.trim();
  } catch {
    return raw.trim();
  }
}

async function processQRData(raw) {
  const resultDiv = $("scan-result");
  resultDiv.innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted)"><span class="spinner" style="width:20px;height:20px;border-width:3px;border-top-color:var(--warn)"></span> Verifying QR code…</div>`;
  setLoading("btn-process-manual", true, "Verifying…");
  const qrToken = extractToken(raw);
  if (!qrToken || qrToken.length < 5) {
    resultDiv.innerHTML = scanResultHTML(
      "error",
      "❌",
      "Invalid Input",
      "Please paste a valid QR token",
    );
    toast("Invalid QR token", "error");
    setLoading("btn-process-manual", false, "Mark Attendance →");
    return;
  }
  try {
    const { ok, data, status } = await apiFetch("/verify-qr", {
      method: "POST",
      body: JSON.stringify({ qr_token: qrToken }),
    });
    if (!ok) {
      resultDiv.innerHTML =
        status === 404
          ? scanResultHTML(
              "error",
              "❌",
              "QR Not Found",
              `Token "${qrToken}" is not registered for any event.`,
            )
          : scanResultHTML(
              "error",
              "❌",
              "Server Error",
              data.message || "Internal Server Error",
            );
      toast(data.message || "QR not found", "error");
      return;
    }
    const reg = data.registration || data;
    const dateStr = fmtDate(reg.event_date);
    if (data.alreadyAttended) {
      resultDiv.innerHTML = `<div class="scan-result-box" style="background:#f59e0b20;border:1px solid #f59e0b40">
        <div style="font-size:36px;text-align:center;margin-bottom:8px">⚠️</div>
        <div style="font-weight:700;color:var(--warn);text-align:center;font-size:16px;margin-bottom:14px">Already Marked Present</div>
        ${regInfoRows(reg, dateStr)}</div>`;
      toast("Attendance already marked", "info");
    } else {
      resultDiv.innerHTML = `<div class="scan-result-box" style="background:#22d3a520;border:1px solid #22d3a540">
        <div style="font-size:40px;text-align:center;margin-bottom:8px">✅</div>
        <div style="font-weight:700;color:var(--accent2);text-align:center;font-size:18px;margin-bottom:14px">Attendance Marked Successfully!</div>
        ${regInfoRows(reg, dateStr)}</div>`;
      toast("Attendance marked!", "success");
      loadStats();
      const res = await apiFetch("/registrations");
      if (res.ok) _allRegs = res.data.registrations || [];
    }
  } catch {
    resultDiv.innerHTML = scanResultHTML(
      "error",
      "❌",
      "Connection Error",
      "Cannot connect to backend. Is the server running?",
    );
    toast("Connection failed", "error");
  } finally {
    setLoading("btn-process-manual", false, "Mark Attendance →");
  }
}

function regInfoRows(reg, dateStr) {
  return `
    <div class="qr-info-row"><span class="k">Name</span><span class="v">${reg.studentName}</span></div>
    <div class="qr-info-row"><span class="k">Roll No.</span><span class="v">${reg.studentRoll || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Branch</span><span class="v">${reg.branch || "—"}</span></div>
    <div class="qr-info-row"><span class="k">College</span><span class="v">${reg.college || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Email</span><span class="v">${reg.studentEmail || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Event</span><span class="v">${reg.eventName}</span></div>
    <div class="qr-info-row"><span class="k">Date</span><span class="v">${dateStr}</span></div>
    <div class="qr-info-row"><span class="k">Venue</span><span class="v">${reg.venue || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Status</span><span class="v" style="color:var(--accent2)">✓ Present</span></div>`;
}

function scanResultHTML(type, icon, title, sub) {
  const color = type === "error" ? "var(--danger)" : "var(--warn)";
  const bg = type === "error" ? "#f43f5e20" : "#f59e0b20";
  const border = type === "error" ? "#f43f5e40" : "#f59e0b40";
  return `<div class="scan-result-box" style="background:${bg};border:1px solid ${border};text-align:center">
    <div style="font-size:36px;margin-bottom:8px">${icon}</div>
    <div style="font-weight:700;color:${color};font-size:16px">${title}</div>
    <div style="font-size:13px;color:var(--sub);margin-top:6px">${sub}</div></div>`;
}

// ── KEYBOARD ──────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    document.querySelector(".screen.active")?.id === "screen-login"
  )
    doLogin();
});

// ══════════════════════════════════════════════════════════════
//  CERTIFICATES TAB
// ══════════════════════════════════════════════════════════════

let _certSubTab = "pending";

function switchCertTab(tab) {
  _certSubTab = tab;
  const pendingBtn = $("cert-sub-pending-btn");
  const approvedBtn = $("cert-sub-approved-btn");
  const pendingDiv = $("cert-tab-pending");
  const approvedDiv = $("cert-tab-approved");

  if (tab === "pending") {
    pendingDiv.style.display = "block";
    approvedDiv.style.display = "none";
    pendingBtn.style.background = "var(--card)";
    pendingBtn.style.color = "var(--text)";
    pendingBtn.style.fontWeight = "600";
    approvedBtn.style.background = "transparent";
    approvedBtn.style.color = "var(--sub)";
    approvedBtn.style.fontWeight = "500";
    loadPendingCertificates();
  } else {
    pendingDiv.style.display = "none";
    approvedDiv.style.display = "block";
    approvedBtn.style.background = "var(--card)";
    approvedBtn.style.color = "var(--text)";
    approvedBtn.style.fontWeight = "600";
    pendingBtn.style.background = "transparent";
    pendingBtn.style.color = "var(--sub)";
    pendingBtn.style.fontWeight = "500";
    loadApprovedCertificates();
  }
}

async function loadCertificatesTab() {
  switchCertTab("pending");
}

// ── PENDING CERTIFICATES ──────────────────────────────────────
async function loadPendingCertificates() {
  const div = $("cert-pending-content");
  div.innerHTML = `<div class="loading-state">Loading pending certificates…</div>`;
  try {
    const { ok, data } = await apiFetch("/admin/certificates/pending");
    if (!ok) throw new Error(data.message || "Failed");

    const certs = data.certificates || [];
    $("cert-pending-count").textContent = certs.length;

    if (!certs.length) {
      div.innerHTML = `
        <div class="empty">
          <div class="empty-icon">🎓</div>
          <div class="empty-text">No certificates pending approval.<br>
            <small style="color:var(--muted)">Organizers must submit results first from their portal.</small>
          </div>
        </div>`;
      return;
    }

    // Group by event
    const byEvent = {};
    certs.forEach((c) => {
      const key = c.eventId || "unknown";
      if (!byEvent[key])
        byEvent[key] = {
          eventName: c.eventName || "Unknown Event",
          eventDate: c.event_date,
          eventId: c.eventId,
          certs: [],
        };
      byEvent[key].certs.push(c);
    });

    div.innerHTML = Object.entries(byEvent)
      .map(
        ([evId, ev]) => `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-family:Syne,sans-serif;font-size:17px;font-weight:700">${ev.eventName}</div>
            <div style="font-size:12px;color:var(--sub);margin-top:3px">📅 ${fmtDate(ev.eventDate)} · ${ev.certs.length} certificate(s) pending</div>
          </div>
          <button class="btn btn-success btn-sm" onclick="approveAllForEvent(${ev.eventId}, this)">
            ✅ Approve All for this Event
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Student</th><th>Roll No.</th><th>Branch</th><th>College</th><th>Certificate Type</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${ev.certs
                .map(
                  (c, i) => `
                <tr id="cert-row-${c.id}">
                  <td>${i + 1}</td>
                  <td><strong>${c.studentName}</strong><br><span style="font-size:11px;color:var(--sub)">${c.studentEmail}</span></td>
                  <td>${c.studentRoll || "—"}</td>
                  <td>${c.branch || "—"}</td>
                  <td>${c.college || "—"}</td>
                  <td>
                    <span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;${c.certificate_type === "winner" ? "background:#f59e0b20;color:#f59e0b" : "background:#4f6ef720;color:#4f6ef7"}">
                      ${c.certificate_type === "winner" ? "🏆 Winner" : "📜 Participation"}
                    </span>
                  </td>
                  <td style="display:flex;gap:6px;align-items:center">
                    <button class="btn btn-success btn-sm" onclick="approveCert(${c.id}, this)">✅ Approve</button>
                    <button class="btn btn-danger btn-sm"  onclick="rejectCert(${c.id}, this)">✕ Reject</button>
                  </td>
                </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`,
      )
      .join("");
  } catch (e) {
    div.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load: ${e.message}</div></div>`;
  }
}

// ── APPROVED CERTIFICATES ─────────────────────────────────────
async function loadApprovedCertificates() {
  const div = $("cert-approved-content");
  div.innerHTML = `<div class="loading-state">Loading approved certificates…</div>`;
  try {
    const { ok, data } = await apiFetch("/admin/certificates/approved");
    if (!ok) throw new Error(data.message || "Failed");

    const certs = data.certificates || [];
    $("cert-approved-count").textContent = certs.length;

    if (!certs.length) {
      div.innerHTML = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No certificates approved yet.</div></div>`;
      return;
    }

    div.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Student</th><th>Roll No.</th><th>Branch</th><th>Event</th><th>Date</th><th>Certificate</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${certs
              .map(
                (c, i) => `
              <tr id="cert-approved-row-${c.id}">
                <td>${i + 1}</td>
                <td><strong>${c.studentName}</strong><br><span style="font-size:11px;color:var(--sub)">${c.studentEmail}</span></td>
                <td>${c.studentRoll || "—"}</td>
                <td>${c.branch || "—"}</td>
                <td>${c.eventName}</td>
                <td style="font-size:12px">${fmtDate(c.event_date)}</td>
                <td><span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;${c.certificate_type === "winner" ? "background:#f59e0b20;color:#f59e0b" : "background:#22d3a520;color:#22d3a5"}">
                  ${c.certificate_type === "winner" ? "🏆 Winner" : "📜 Participation"}
                </span></td>
                <td>
                  <button class="btn btn-danger btn-sm" onclick="revokeCert(${c.id}, this)">↩ Revoke</button>
                </td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    div.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load: ${e.message}</div></div>`;
  }
}

// ── APPROVE SINGLE ────────────────────────────────────────────
async function approveCert(certId, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok, data } = await apiFetch(
      `/admin/certificates/${certId}/approve`,
      { method: "PATCH" },
    );
    if (!ok) {
      toast(data.message || "Failed", "error");
      btn.disabled = false;
      btn.textContent = "✅ Approve";
      return;
    }
    toast("Certificate approved! Student can now download it.", "success");
    const row = $(`cert-row-${certId}`);
    if (row) {
      row.style.opacity = "0.4";
      row.style.transition = "opacity 0.4s";
      setTimeout(() => {
        row.remove();
        loadPendingCertificates();
      }, 500);
    }
  } catch {
    toast("Server error", "error");
    btn.disabled = false;
    btn.textContent = "✅ Approve";
  }
}

// ── REJECT SINGLE ─────────────────────────────────────────────
async function rejectCert(certId, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok, data } = await apiFetch(
      `/admin/certificates/${certId}/reject`,
      { method: "PATCH" },
    );
    if (!ok) {
      toast(data.message || "Failed", "error");
      btn.disabled = false;
      btn.textContent = "✕ Reject";
      return;
    }
    toast("Certificate rejected.", "info");
    const row = $(`cert-row-${certId}`);
    if (row) {
      row.style.opacity = "0.3";
      setTimeout(() => {
        row.remove();
        loadPendingCertificates();
      }, 400);
    }
  } catch {
    toast("Server error", "error");
    btn.disabled = false;
    btn.textContent = "✕ Reject";
  }
}

// ── REVOKE APPROVED CERT (moves back to pending) ──────────────
async function revokeCert(certId, btn) {
  if (
    !confirm(
      "Revoke this certificate? The student will lose download access until re-approved.",
    )
  )
    return;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const { ok, data } = await apiFetch(
      `/admin/certificates/${certId}/reject`,
      { method: "PATCH" },
    );
    if (!ok) {
      toast(data.message || "Failed", "error");
      btn.disabled = false;
      btn.textContent = "↩ Revoke";
      return;
    }
    toast("Certificate revoked. Student can no longer download it.", "info");
    const row = $(`cert-approved-row-${certId}`);
    if (row) {
      row.style.opacity = "0.3";
      setTimeout(() => {
        row.remove();
        loadApprovedCertificates();
      }, 400);
    }
  } catch {
    toast("Server error", "error");
    btn.disabled = false;
    btn.textContent = "↩ Revoke";
  }
}

// ── APPROVE ALL FOR EVENT ─────────────────────────────────────
async function approveAllForEvent(eventId, btn) {
  btn.disabled = true;
  btn.textContent = "Approving…";
  try {
    const { ok, data } = await apiFetch(
      `/admin/events/${eventId}/certificates/approve-all`,
      { method: "PATCH" },
    );
    if (!ok) {
      toast(data.message || "Failed", "error");
      btn.disabled = false;
      btn.textContent = "✅ Approve All";
      return;
    }
    toast(data.message, "success");
    loadPendingCertificates();
    // Also refresh approved count if that tab has been loaded
    if ($("cert-approved-count")) loadApprovedCertificates();
  } catch {
    toast("Server error", "error");
    btn.disabled = false;
    btn.textContent = "✅ Approve All for this Event";
  }
}
