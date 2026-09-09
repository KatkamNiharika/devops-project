// ══════════════════════════════════════════════════════════════
//  student.js  –  EventVerify Student Portal (v3)
//  ✔ Role selection at login: Participant or Organizer
//  ✔ Participant: browse events, register (participant/organizer role), view QR, certificates
//  ✔ Organizer: QR scanner, attendance, results, certificates (print)
// ══════════════════════════════════════════════════════════════

const API = "http://localhost:5000/api";
let currentUser = null;
let authToken = null;
let otpTimer = null;
let _loginRole = "participant"; // chosen at login screen
let _allEvents = [];
let _myRegs = [];
let _currentOrgEventId = null;
let _orgEvents = [];
let _regRole = null; // role chosen in register-role modal
let _regEventId = null;

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
  b.innerHTML = on ? `<span class="spinner"></span>${label}` : label;
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

// ── INIT ─────────────────────────────────────────────────────
window.onload = () => {
  const saved = sessionStorage.getItem("ev_student_session");
  if (saved) {
    const session = JSON.parse(saved);
    currentUser = session.user;
    authToken = session.token;
    _loginRole = session.loginRole || "participant";
    goToDashboard();
    return;
  }
  const pg = new URLSearchParams(location.search).get("page");
  showScreen(pg === "register" ? "screen-register" : "screen-login");
};

// ── ROLE SELECTION ON LOGIN ───────────────────────────────────
function selectRole(role) {
  _loginRole = role;
  $("role-btn-participant").className =
    "role-btn" + (role === "participant" ? " selected" : "");
  $("role-btn-organizer").className =
    "role-btn" + (role === "organizer" ? " selected-org" : "");
  $("organizer-hint").style.display = role === "organizer" ? "block" : "none";
}

// ── OTP REGISTER ─────────────────────────────────────────────
async function doSendOTP() {
  const name = gv("sr-name"),
    roll = gv("sr-roll"),
    email = gv("sr-email");
  const pass = gv("sr-pass"),
    phone = gv("sr-phone"),
    branch = gv("sr-branch"),
    college = gv("sr-college");
  if (!name || !roll || !email || !pass || !phone || !branch || !college)
    return toast("Please fill all fields", "error");
  if (!/^\d{10}$/.test(phone)) return toast("Phone must be 10 digits", "error");
  if (pass.length < 6)
    return toast("Password must be at least 6 characters", "error");
  if (!/\S+@\S+\.\S+/.test(email)) return toast("Enter a valid email", "error");
  setLoading("btn-send-otp", true, "Sending OTP…");
  try {
    const { ok, data } = await apiFetch("/send-otp", {
      method: "POST",
      body: JSON.stringify({
        full_name: name,
        email,
        password: pass,
        roll_number: roll,
        department: college,
        branch,
        phone,
      }),
    });
    if (!ok) return toast(data.message || "Failed to send OTP", "error");
    $("otp-email-display").textContent = email;
    showScreen("screen-otp");
    startOTPTimer();
    toast("OTP sent!", "success");
  } catch {
    toast("Server error. Is the backend running?", "error");
  } finally {
    setLoading("btn-send-otp", false, "Send OTP to Email →");
  }
}

async function doVerifyOTP() {
  const email = gv("sr-email");
  const otp = [0, 1, 2, 3, 4, 5].map((i) => gv(`otp-${i}`)).join("");
  if (otp.length < 6) return toast("Enter the complete 6-digit OTP", "error");
  setLoading("btn-verify-otp", true, "Verifying…");
  try {
    const { ok, data } = await apiFetch("/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
    if (!ok) return toast(data.message || "OTP verification failed", "error");
    clearOTPTimer();
    toast("Account created! Please sign in.", "success");
    setTimeout(() => showScreen("screen-login"), 900);
  } catch {
    toast("Server error.", "error");
  } finally {
    setLoading("btn-verify-otp", false, "Verify & Create Account →");
  }
}

async function doResendOTP() {
  clearOTPTimer();
  setLoading("btn-resend", true, "Resending…");
  try {
    const { ok, data } = await apiFetch("/send-otp", {
      method: "POST",
      body: JSON.stringify({
        full_name: gv("sr-name"),
        email: gv("sr-email"),
        password: gv("sr-pass"),
        roll_number: gv("sr-roll"),
        department: gv("sr-college"),
        branch: gv("sr-branch"),
        phone: gv("sr-phone"),
      }),
    });
    if (!ok) return toast(data.message || "Failed", "error");
    startOTPTimer();
    toast("OTP resent!", "success");
  } catch {
    toast("Server error", "error");
  } finally {
    setLoading("btn-resend", false, "Resend OTP");
  }
}

function otpMove(el, next) {
  if (el.value.length === 1 && next >= 0) $(`otp-${next}`)?.focus();
}
function otpBack(e, idx) {
  if (e.key === "Backspace" && !$(`otp-${idx}`).value && idx > 0)
    $(`otp-${idx - 1}`)?.focus();
}

function startOTPTimer() {
  let secs = 600;
  const el = $("otp-countdown");
  const wrap = $("otp-timer-wrap");
  if (wrap) wrap.style.display = "block";
  clearOTPTimer();
  otpTimer = setInterval(() => {
    secs--;
    if (el)
      el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    if (secs <= 0) {
      clearOTPTimer();
      if (wrap) wrap.style.display = "none";
    }
  }, 1000);
}
function clearOTPTimer() {
  if (otpTimer) {
    clearInterval(otpTimer);
    otpTimer = null;
  }
}

// ── LOGIN ─────────────────────────────────────────────────────
async function doLogin() {
  const email = gv("sl-email"),
    password = gv("sl-pass");
  if (!email || !password) return toast("Enter email and password", "error");
  setLoading("btn-login", true, "Signing in…");
  try {
    const { ok, data } = await apiFetch("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!ok) return toast(data.message || "Invalid credentials", "error");
    if (data.user.role === "admin")
      return toast("Use Admin portal for admin login", "error");

    authToken = data.token;
    currentUser = data.user;
    sessionStorage.setItem(
      "ev_student_session",
      JSON.stringify({
        token: data.token,
        user: data.user,
        loginRole: _loginRole,
      }),
    );
    toast(`Welcome, ${currentUser.full_name}!`, "success");
    goToDashboard();
  } catch {
    toast("Server error. Is the backend running?", "error");
  } finally {
    setLoading("btn-login", false, "Sign In →");
  }
}

function doLogout() {
  sessionStorage.removeItem("ev_student_session");
  authToken = null;
  currentUser = null;
  _allEvents = [];
  _myRegs = [];
  _orgEvents = [];
  showScreen("screen-login");
  toast("Logged out successfully", "info");
}

async function goToDashboard() {
  if (_loginRole === "organizer") {
    $("org-name").textContent = currentUser.full_name;
    showScreen("screen-organizer");
    await loadOrgEvents();
  } else {
    fillProfile();
    showScreen("screen-dashboard");
    loadAvailableEvents();
    // Auto-detect: check if this user is an organizer for any events
    try {
      const { ok, data } = await apiFetch("/organizer/my-events");
      if (ok && data.events && data.events.length > 0) {
        const btn = $("btn-switch-organizer");
        if (btn) btn.style.display = "inline-flex";
      }
    } catch {
      // silently ignore — not critical
    }
  }
}

async function switchToOrganizerView() {
  _loginRole = "organizer";
  // Persist choice in sessionStorage
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("ev_student_session") || "{}",
    );
    saved.loginRole = "organizer";
    sessionStorage.setItem("ev_student_session", JSON.stringify(saved));
  } catch {
    /* ignore */
  }
  $("org-name").textContent = currentUser.full_name;
  showScreen("screen-organizer");
  await loadOrgEvents();
}

async function switchToParticipantView() {
  _loginRole = "participant";
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("ev_student_session") || "{}",
    );
    saved.loginRole = "participant";
    sessionStorage.setItem("ev_student_session", JSON.stringify(saved));
  } catch {
    /* ignore */
  }
  fillProfile();
  showScreen("screen-dashboard");
  loadAvailableEvents();
}

function fillProfile() {
  if (!currentUser) return;
  $("st-name").textContent = currentUser.full_name;
  $("prof-name").textContent = currentUser.full_name;
  $("prof-roll").textContent = currentUser.roll_number || "—";
  $("prof-branch").textContent = currentUser.branch || "—";
  $("prof-college").textContent = currentUser.department || "—";
  $("prof-phone").textContent = currentUser.phone || "—";
  $("prof-email").textContent = currentUser.email || "—";
}

// ── PARTICIPANT TABS ──────────────────────────────────────────
function switchTab(tab) {
  ["events", "myregs", "certs"].forEach((t) => {
    $(`tab-${t}`).style.display = t === tab ? "block" : "none";
    $(`tab-${t}-btn`).classList.toggle("active", t === tab);
  });
  if (tab === "events") loadAvailableEvents();
  if (tab === "myregs") loadMyRegistrations();
  if (tab === "certs") loadMyCertificates();
}

// ── AVAILABLE EVENTS ──────────────────────────────────────────
async function loadAvailableEvents() {
  const grid = $("events-grid");
  grid.innerHTML = `<div class="loading-state">Loading events…</div>`;
  try {
    const [evRes, regRes] = await Promise.all([
      apiFetch("/events"),
      apiFetch("/my-registrations"),
    ]);
    _allEvents = evRes.data.events || [];
    _myRegs = regRes.data.registrations || [];
    renderEventGrid(_allEvents);
  } catch {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load events. Is the server running?</div></div>`;
  }
}

function filterEvents() {
  const q = ($("ev-search")?.value || "").toLowerCase();
  renderEventGrid(
    _allEvents.filter(
      (ev) =>
        (ev.title || "").toLowerCase().includes(q) ||
        (ev.venue || "").toLowerCase().includes(q),
    ),
  );
}

function renderEventGrid(events) {
  const grid = $("events-grid");
  if (!events.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-text">No events found.</div></div>`;
    return;
  }
  grid.innerHTML = events
    .map((ev) => {
      const myReg = _myRegs.find((r) => r.event_id === ev.id);
      const attended = myReg?.status === "attended";
      const role = myReg?.event_role;
      let actionBtn = "";
      if (myReg) {
        if (role === "organizer")
          actionBtn = `<button class="btn btn-ghost btn-sm" style="border-color:#a78bfa40;color:#a78bfa" disabled>✓ Registered as Organizer</button>`;
        else {
          const attLabel = attended ? "✓ Attended" : "✓ Registered";
          const attStyle = attended
            ? "border-color:#22d3a540;color:var(--accent2)"
            : "border-color:#4f6ef740;color:var(--accent)";
          actionBtn = `<button class="btn btn-ghost btn-sm" style="${attStyle}" onclick="showQR('${myReg.qr_token}')">${attLabel} · View QR</button>`;
        }
      } else {
        actionBtn = `<button class="btn btn-primary btn-sm" onclick="openRegisterModal(${ev.id},'${esc(ev.title)}')">Register →</button>`;
      }
      return `
    <div class="event-card">
      <div class="ev-title">${ev.title}</div>
      <div class="ev-meta">📅 ${fmtDate(ev.event_date)}${ev.event_time ? " · ⏰ " + ev.event_time.slice(0, 5) : ""}</div>
      <div class="ev-meta">📍 ${ev.venue || "Venue not set"}</div>
      ${ev.description ? `<div class="ev-desc">${ev.description}</div>` : ""}
      ${ev.has_certificate ? `<div class="ev-tags"><span class="etag etag-warn">🎓 Certificates</span></div>` : ""}
      <div class="ev-actions">${actionBtn}</div>
    </div>`;
    })
    .join("");
}

// ── REGISTER ROLE MODAL ───────────────────────────────────────
function openRegisterModal(eventId, eventTitle) {
  _regEventId = eventId;
  _regRole = null;
  $("reg-modal-title").textContent = `Register for Event`;
  $("reg-modal-event").textContent = eventTitle;
  $("reg-role-participant").className = "role-btn";
  $("reg-role-organizer").className = "role-btn";
  $("reg-role-info").textContent = "Select a role to continue.";
  $("btn-confirm-register").disabled = true;
  openModal("modal-register-role");
}

function setRegRole(role) {
  _regRole = role;
  $("reg-role-participant").className =
    "role-btn" + (role === "participant" ? " selected" : "");
  $("reg-role-organizer").className =
    "role-btn" + (role === "organizer" ? " selected-org" : "");
  $("btn-confirm-register").disabled = false;
  if (role === "participant")
    $("reg-role-info").textContent =
      "✓ You'll receive a QR code ticket to attend the event.";
  else
    $("reg-role-info").textContent =
      "🏆 You'll be the event organizer — scan QR codes, manage attendance, issue certificates. Only one organizer per event.";
}

async function confirmRegister() {
  if (!_regEventId || !_regRole) return;
  setLoading("btn-confirm-register", true, "Registering…");
  try {
    const { ok, data } = await apiFetch("/register-event-role", {
      method: "POST",
      body: JSON.stringify({ event_id: _regEventId, role: _regRole }),
    });
    if (!ok) return toast(data.message || "Registration failed", "error");
    closeModal("modal-register-role");
    toast(data.message || "Registered!", "success");
    if (_regRole === "participant" && data.qr_token) {
      await loadAvailableEvents();
      setTimeout(() => showQR(data.qr_token), 600);
    } else {
      await loadAvailableEvents();
    }
  } catch {
    toast("Server error", "error");
  } finally {
    setLoading("btn-confirm-register", false, "Confirm Registration →");
  }
}

// ── QR DISPLAY ────────────────────────────────────────────────
function showQR(token) {
  if (!token) return;
  const wrap = $("qr-canvas-wrap");
  wrap.innerHTML = "";
  const payload = JSON.stringify({
    token,
    studentId: currentUser?.id,
    studentName: currentUser?.full_name,
  });
  new QRCode(wrap, {
    text: payload,
    width: 200,
    height: 200,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });
  $("qr-token-display").textContent = token;
  openModal("modal-qr");
}

function downloadQR() {
  const canvas = $("qr-canvas-wrap")?.querySelector("canvas");
  if (!canvas) return toast("QR not ready", "error");
  const a = document.createElement("a");
  a.download = `EventVerify-QR-${currentUser?.roll_number || "ticket"}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

// ── MY REGISTRATIONS ──────────────────────────────────────────
async function loadMyRegistrations() {
  const el = $("my-regs-list");
  el.innerHTML = `<div class="loading-state">Loading…</div>`;
  try {
    const { ok, data } = await apiFetch("/my-registrations");
    if (!ok) throw new Error();
    _myRegs = data.registrations || [];
    if (!_myRegs.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No registrations yet.<br><small style="color:var(--muted)">Browse events and register!</small></div></div>`;
      return;
    }
    el.innerHTML = _myRegs
      .map((r) => {
        const attended = r.status === "attended";
        const isOrg = r.event_role === "organizer";
        const tagStyle = isOrg
          ? "background:#a78bfa20;color:#a78bfa"
          : attended
            ? "background:#22d3a520;color:var(--accent2)"
            : "background:#4f6ef720;color:var(--accent)";
        const tagLabel = isOrg
          ? "🏆 Organizer"
          : attended
            ? "✓ Attended"
            : "Registered";
        return `
      <div class="reg-card">
        <div class="reg-info">
          <div class="reg-event">${r.title || "(event deleted)"}</div>
          <div class="reg-meta">📅 ${fmtDate(r.event_date)} · 📍 ${r.venue || "—"}</div>
          <div class="reg-meta" style="margin-top:4px"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;${tagStyle}">${tagLabel}</span></div>
        </div>
        <div class="reg-actions">
          ${!isOrg ? `<button class="btn btn-ghost btn-sm" onclick="showQR('${r.qr_token}')">📱 QR Ticket</button>` : ""}
        </div>
      </div>`;
      })
      .join("");
  } catch {
    el.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load registrations.</div></div>`;
  }
}

// ── MY CERTIFICATES ───────────────────────────────────────────
async function loadMyCertificates() {
  const el = $("my-certs-list");
  el.innerHTML = `<div class="loading-state">Loading…</div>`;
  try {
    // Fetch approved certs (visible + downloadable)
    const { ok, data } = await apiFetch("/my-certificates");
    if (!ok) throw new Error();
    const approved = data.certificates || [];

    // Fetch all registrations to check for pending certs
    const regRes = await apiFetch("/my-registrations");
    const allRegs = regRes.ok ? regRes.data.registrations || [] : [];
    const pending = allRegs.filter(
      (r) =>
        r.certificate_type &&
        r.certificate_status === "pending" &&
        r.status === "attended",
    );

    if (!approved.length && !pending.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">🎓</div><div class="empty-text">No certificates yet.<br><small style="color:var(--muted)">Attend events and get recognized by the organizer!</small></div></div>`;
      return;
    }

    let html = "";

    // Show pending certs as locked cards
    if (pending.length) {
      html += `<div style="background:#f59e0b15;border:1px solid #f59e0b30;border-radius:12px;padding:14px 18px;margin-bottom:16px;font-size:13px;color:#f59e0b">
        ⏳ <strong>${pending.length} certificate${pending.length > 1 ? "s are" : " is"} pending admin approval.</strong>
        Once approved they will appear here for download.
      </div>`;
      html += pending
        .map(
          (r) => `
        <div class="cert-card" style="opacity:0.6">
          <div class="cert-badge">${r.certificate_type === "winner" ? "🏆" : "📜"}</div>
          <div class="cert-info">
            <div class="cert-title" style="color:var(--sub)">${r.certificate_type === "winner" ? "Certificate of Achievement" : "Certificate of Participation"}</div>
            <div class="cert-meta">🎉 ${r.title || "Event"} · ${fmtDate(r.event_date)}</div>
            <div style="margin-top:6px;display:inline-block;background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700">⏳ Pending Approval</div>
          </div>
          <div style="color:var(--muted);font-size:12px;text-align:center">Awaiting<br>admin<br>review</div>
        </div>`,
        )
        .join("");
    }

    // Show approved certs (downloadable)
    html += approved
      .map((c) => {
        const isWinner = c.certificate_type === "winner";
        const safeC = JSON.stringify(c).replace(/'/g, "\'");
        return `
      <div class="cert-card">
        <div class="cert-badge">${isWinner ? "🏆" : "📜"}</div>
        <div class="cert-info">
          <div class="cert-title">${isWinner ? "Certificate of Achievement" : "Certificate of Participation"}</div>
          <div class="cert-meta">🎉 ${c.eventName} · ${fmtDate(c.event_date)}</div>
          <div class="cert-meta">📍 ${c.venue || "—"}</div>
          <div class="cert-meta" style="margin-top:4px;color:var(--sub);font-size:11px">
            ${c.studentRoll ? `Roll: <strong style="color:var(--text)">${c.studentRoll}</strong>` : ""}
            ${c.branch ? ` · Branch: <strong style="color:var(--text)">${c.branch}</strong>` : ""}
          </div>
          <div style="margin-top:6px;display:inline-block;background:#22d3a520;color:#22d3a5;border:1px solid #22d3a540;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700">✅ Approved</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <button class="btn btn-primary btn-sm" style="background:linear-gradient(135deg,#3d5cf5,#4f6ef7);white-space:nowrap" onclick='downloadStudentCertPNG(${JSON.stringify(c)})'>⬇ Download PNG</button>
          <button class="btn btn-ghost btn-sm" style="white-space:nowrap" onclick='printStudentCert(${JSON.stringify(c)})'>🖨 Print</button>
        </div>
      </div>`;
      })
      .join("");

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load certificates.</div></div>`;
  }
}

function downloadStudentCertPNG(c) {
  const eventDate = c.event_date
    ? new Date(c.event_date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  downloadCertPNG(c, c.eventName || "Event", eventDate);
}

function printStudentCert(c) {
  const eventDate = c.event_date
    ? new Date(c.event_date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  printSingleCert(c, c.eventName || "Event", eventDate);
}

// ══════════════════════════════════════════════════════════════
//  ORGANIZER PORTAL
// ══════════════════════════════════════════════════════════════

async function loadOrgEvents() {
  try {
    const { ok, data } = await apiFetch("/organizer/my-events");
    _orgEvents = (ok ? data.events : []) || [];
    const sel = $("org-event-select");
    sel.innerHTML =
      `<option value="">— Select your event —</option>` +
      _orgEvents
        .map(
          (ev) =>
            `<option value="${ev.id}">${ev.title} (${fmtDate(ev.event_date)})</option>`,
        )
        .join("");
    if (!_orgEvents.length) {
      $("org-content").style.display = "none";
      $("org-no-events").style.display = "block";
    } else {
      $("org-no-events").style.display = "none";
    }
  } catch {
    toast("Failed to load your events", "error");
  }
}

function onOrgEventChange() {
  const id = Number($("org-event-select")?.value);
  if (!id) {
    $("org-content").style.display = "none";
    return;
  }
  _currentOrgEventId = id;
  $("org-content").style.display = "block";
  switchOrgTab("scanner");
}

function switchOrgTab(tab) {
  ["scanner", "attendance", "results", "certs"].forEach((t) => {
    const el = $(`orgtab-${t}`);
    const btn = $(`orgtab-${t}-btn`);
    if (el) el.style.display = t === tab ? "block" : "none";
    if (btn) btn.classList.toggle("active", t === tab);
  });
  if (tab === "attendance") loadOrgAttendance();
  if (tab === "results") loadOrgResults();
  if (tab === "certs") loadOrgCertificates();
}

// ── ORGANIZER QR SCANNER ──────────────────────────────────────
function orgHandleQRUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  const resultDiv = $("org-scan-result");
  resultDiv.innerHTML = `<p style="color:var(--sub);text-align:center;padding:10px">Reading QR…</p>`;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
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
        if (decoded) orgProcessQR(decoded.data);
        else {
          resultDiv.innerHTML = "";
          toast("Could not read QR. Try manual token entry.", "error");
        }
      } catch {
        resultDiv.innerHTML = "";
        toast("Error reading image.", "error");
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function orgProcessManualQR() {
  const token = $("org-manual-qr")?.value?.trim();
  if (!token) return toast("Please paste a QR token first", "error");
  orgProcessQR(token);
}

async function orgProcessQR(raw) {
  const resultDiv = $("org-scan-result");
  resultDiv.innerHTML = `<p style="color:var(--sub);text-align:center;padding:10px">Verifying…</p>`;
  setLoading("btn-org-scan", true, "Verifying…");
  let qrToken = raw;
  try {
    const p = JSON.parse(raw);
    qrToken = p.token || raw;
  } catch {}
  if (!qrToken || qrToken.length < 5) {
    resultDiv.innerHTML = orgScanResultHTML(
      "error",
      "❌",
      "Invalid Token",
      "Please paste a valid QR token",
    );
    setLoading("btn-org-scan", false, "Mark Attendance →");
    return;
  }
  try {
    const { ok, data, status } = await apiFetch("/organizer/verify-qr", {
      method: "POST",
      body: JSON.stringify({ qr_token: qrToken }),
    });
    if (!ok) {
      const msg =
        status === 404 ? "QR token not found." : data.message || "Server error";
      resultDiv.innerHTML = orgScanResultHTML(
        "error",
        "❌",
        "QR Not Found",
        msg,
      );
      return;
    }
    const reg = data.registration || data;
    const dateStr = fmtDate(reg.event_date);
    if (data.alreadyAttended) {
      resultDiv.innerHTML = `<div class="scan-result-box" style="background:#f59e0b20;border:1px solid #f59e0b40">
        <div style="font-size:36px;text-align:center;margin-bottom:8px">⚠️</div>
        <div style="font-weight:700;color:var(--warn);text-align:center;font-size:16px;margin-bottom:14px">Already Marked Present</div>
        ${orgRegInfoRows(reg, dateStr)}</div>`;
      toast("Attendance already marked", "info");
    } else {
      resultDiv.innerHTML = `<div class="scan-result-box" style="background:#22d3a520;border:1px solid #22d3a540">
        <div style="font-size:40px;text-align:center;margin-bottom:8px">✅</div>
        <div style="font-weight:700;color:var(--accent2);text-align:center;font-size:18px;margin-bottom:14px">Attendance Marked!</div>
        ${orgRegInfoRows(reg, dateStr)}</div>`;
      toast("Attendance marked successfully!", "success");
    }
  } catch {
    resultDiv.innerHTML = orgScanResultHTML(
      "error",
      "❌",
      "Connection Error",
      "Cannot connect to backend.",
    );
  } finally {
    setLoading("btn-org-scan", false, "Mark Attendance →");
  }
}

function orgRegInfoRows(reg, dateStr) {
  return `
    <div class="qr-info-row"><span class="k">Name</span><span class="v">${reg.studentName || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Roll No.</span><span class="v">${reg.studentRoll || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Branch</span><span class="v">${reg.branch || "—"}</span></div>
    <div class="qr-info-row"><span class="k">College</span><span class="v">${reg.college || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Event</span><span class="v">${reg.eventName || "—"}</span></div>
    <div class="qr-info-row"><span class="k">Date</span><span class="v">${dateStr}</span></div>
    <div class="qr-info-row"><span class="k">Status</span><span class="v" style="color:var(--accent2)">✓ Present</span></div>`;
}

function orgScanResultHTML(type, icon, title, sub) {
  const map = {
    error: ["#f43f5e20", "#f43f5e40", "var(--danger)"],
    warn: ["#f59e0b20", "#f59e0b40", "var(--warn)"],
  };
  const [bg, border, color] = map[type] || map.error;
  return `<div class="scan-result-box" style="background:${bg};border:1px solid ${border};text-align:center">
    <div style="font-size:36px;margin-bottom:8px">${icon}</div>
    <div style="font-weight:700;color:${color};font-size:16px">${title}</div>
    <div style="font-size:13px;color:var(--sub);margin-top:6px">${sub}</div></div>`;
}

// ── ORGANIZER ATTENDANCE ──────────────────────────────────────
async function loadOrgAttendance() {
  const statsEl = $("org-attendance-stats");
  const wrap = $("org-attendance-wrap");
  if (!_currentOrgEventId) return;
  wrap.innerHTML = `<div class="loading-state">Loading attendance…</div>`;
  try {
    const { ok, data } = await apiFetch(
      `/organizer/event/${_currentOrgEventId}/participants`,
    );
    if (!ok) throw new Error(data.message || "Failed");
    const parts = data.participants || [];
    const attended = parts.filter((p) => p.status === "attended").length;
    statsEl.style.display = "grid";
    $("oas-total").textContent = parts.length;
    $("oas-attended").textContent = attended;
    $("oas-pending").textContent = parts.length - attended;
    if (!parts.length) {
      wrap.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No participants registered yet.</div></div>`;
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Name</th><th>Roll No.</th><th>Branch</th><th>College</th><th>Status</th></tr></thead>
      <tbody>${parts
        .map((p, i) => {
          const att = p.status === "attended";
          return `<tr><td>${i + 1}</td><td><strong>${p.studentName || "—"}</strong></td><td>${p.studentRoll || "—"}</td><td>${p.branch || "—"}</td><td>${p.college || "—"}</td>
          <td><span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;${att ? "background:#22d3a520;color:#22d3a5" : "background:#f59e0b20;color:#f59e0b"}">${att ? "✓ Attended" : "Pending"}</span></td></tr>`;
        })
        .join("")}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${err.message}</div></div>`;
    statsEl.style.display = "none";
  }
}

// ── ORGANIZER RESULTS ─────────────────────────────────────────
async function loadOrgResults() {
  const div = $("org-results-list");
  if (!div || !_currentOrgEventId) return;
  div.innerHTML = `<div class="loading-state">Loading participants…</div>`;
  try {
    const { ok, data } = await apiFetch(
      `/organizer/event/${_currentOrgEventId}/participants`,
    );
    if (!ok) {
      div.innerHTML = `<p style="color:var(--danger)">${data.message || "Failed"}</p>`;
      return;
    }
    const attended = (data.participants || []).filter(
      (p) => p.status === "attended",
    );
    const submitBtn = $("btn-submit-results");
    if (!attended.length) {
      div.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No participants attended yet.<br><small style="color:var(--muted)">Scan QR tickets first.</small></div></div>`;
      if (submitBtn) submitBtn.style.display = "none";
      return;
    }
    if (submitBtn) submitBtn.style.display = "";
    const ev = _orgEvents.find((e) => e.id === _currentOrgEventId);
    const hasCert = ev?.has_certificate;
    window._resultParticipants = attended;
    div.innerHTML = `
      ${!hasCert ? `<div style="background:#f59e0b15;border:1px solid #f59e0b40;border-radius:10px;padding:12px 16px;font-size:13px;color:#f59e0b;margin-bottom:16px">⚠️ Certificates not enabled for this event. You can still save attendance.</div>` : `<div style="background:#a78bfa15;border:1px solid #a78bfa40;border-radius:10px;padding:12px 16px;font-size:13px;color:#a78bfa;margin-bottom:16px">🎓 Assign certificate types for each participant below.</div>`}
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Name</th><th>Roll No.</th><th>Branch</th>${hasCert ? "<th>Certificate</th>" : ""}</tr></thead>
        <tbody>${attended.map((p, i) => `<tr><td>${i + 1}</td><td><strong>${p.studentName}</strong></td><td>${p.studentRoll || "—"}</td><td>${p.branch || "—"}</td>${hasCert ? `<td><select id="cert-${p.id}" style="background:var(--surface);border:1px solid var(--border2);color:var(--text);padding:6px 10px;border-radius:8px;font-size:13px"><option value="">— None —</option><option value="participation" ${p.certificate_type === "participation" ? "selected" : ""}>📜 Participation</option><option value="winner" ${p.certificate_type === "winner" ? "selected" : ""}>🏆 Winner</option></select></td>` : ""}</tr>`).join("")}
        </tbody></table></div>`;
  } catch {
    div.innerHTML = `<p style="color:var(--danger)">Server error</p>`;
  }
}

async function submitOrgResults() {
  if (!_currentOrgEventId || !window._resultParticipants) return;
  const ev = _orgEvents.find((e) => e.id === _currentOrgEventId);
  const hasCert = ev?.has_certificate;
  const results = window._resultParticipants.map((p) => ({
    registration_id: p.id,
    certificate_type: hasCert ? $(`cert-${p.id}`)?.value || null : null,
  }));
  setLoading("btn-submit-results", true, "Saving…");
  try {
    const { ok, data } = await apiFetch("/organizer/submit-results", {
      method: "POST",
      body: JSON.stringify({ event_id: _currentOrgEventId, results }),
    });
    if (!ok) return toast(data.message || "Failed to save results", "error");
    toast("Results saved!", "success");
    if (hasCert) setTimeout(() => switchOrgTab("certs"), 800);
  } catch {
    toast("Server error", "error");
  } finally {
    setLoading("btn-submit-results", false, "Save Results →");
  }
}

// ── ORGANIZER CERTIFICATES ────────────────────────────────────
async function loadOrgCertificates() {
  const div = $("org-certs-list");
  const printWrap = $("btn-print-certs");
  if (!div || !_currentOrgEventId) return;
  div.innerHTML = `<div class="loading-state">Loading certificates…</div>`;
  try {
    const { ok, data } = await apiFetch(
      `/organizer/event/${_currentOrgEventId}/certificates`,
    );
    if (!ok) {
      div.innerHTML = `<p style="color:var(--danger)">${data.message || "Failed"}</p>`;
      return;
    }
    const certs = data.certificates || [];
    if (!certs.length) {
      div.innerHTML = `<div class="empty"><div class="empty-icon">🎓</div><div class="empty-text">No certificates issued yet.<br><small style="color:var(--muted)">Go to <strong>Results</strong> tab → assign certificate types → click <strong>Save Results</strong>.</small></div></div>`;
      if (printWrap) printWrap.style.display = "none";
      return;
    }
    if (printWrap) printWrap.style.display = "block";
    window._certData = certs;
    const ev = _orgEvents.find((e) => e.id === _currentOrgEventId);
    const eventName = ev?.title || "Event";
    const eventDate = ev?.event_date
      ? new Date(ev.event_date).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";
    const winners = certs.filter((c) => c.certificate_type === "winner");
    const participation = certs.filter(
      (c) => c.certificate_type === "participation",
    );
    // Store for use in inline onclick
    window._certEventName = eventName;
    window._certEventDate = eventDate;
    const pendingCerts = certs.filter(
      (c) => c.certificate_status !== "approved",
    );
    const approvedCerts = certs.filter(
      (c) => c.certificate_status === "approved",
    );
    div.innerHTML = `
      <div style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        ${winners.length ? `<span style="padding:6px 14px;background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40;border-radius:20px;font-size:13px;font-weight:600">🏆 ${winners.length} Winner${winners.length > 1 ? "s" : ""}</span>` : ""}
        ${participation.length ? `<span style="padding:6px 14px;background:#4f6ef720;color:#4f6ef7;border:1px solid #4f6ef740;border-radius:20px;font-size:13px;font-weight:600">📜 ${participation.length} Participation</span>` : ""}
        ${approvedCerts.length ? `<span style="padding:6px 14px;background:#10b98120;color:#10b981;border:1px solid #10b98140;border-radius:20px;font-size:13px;font-weight:600">✅ ${approvedCerts.length} Approved</span>` : ""}
        ${pendingCerts.length ? `<span style="padding:6px 14px;background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40;border-radius:20px;font-size:13px;font-weight:600">⏳ ${pendingCerts.length} Pending Admin Approval</span>` : ""}
      </div>
      ${pendingCerts.length ? `<div style="background:#f59e0b15;border:1px solid #f59e0b40;border-radius:10px;padding:12px 16px;font-size:13px;color:#f59e0b;margin-bottom:16px">⚠️ <strong>${pendingCerts.length} certificate${pendingCerts.length > 1 ? "s are" : " is"} awaiting admin approval.</strong> Students will be able to download them once an admin approves. Ask your admin to approve via the Admin Panel → Certificates.</div>` : ""}
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Name</th><th>Roll No.</th><th>Branch</th><th>College</th><th>Certificate</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${certs
          .map((c, i) => {
            const isApproved = c.certificate_status === "approved";
            return `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${c.studentName}</strong></td>
            <td>${c.studentRoll || "—"}</td>
            <td>${c.branch || "—"}</td>
            <td>${c.college || "—"}</td>
            <td><span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;${c.certificate_type === "winner" ? "background:#f59e0b20;color:#f59e0b" : "background:#4f6ef720;color:#4f6ef7"}">${c.certificate_type === "winner" ? "🏆 Winner" : "📜 Participation"}</span></td>
            <td><span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;${isApproved ? "background:#10b98120;color:#10b981" : "background:#f59e0b20;color:#f59e0b"}">${isApproved ? "✅ Approved" : "⏳ Pending"}</span></td>
            <td style="white-space:nowrap;display:flex;gap:6px">
              ${
                isApproved
                  ? `
              <button class="btn btn-ghost btn-sm" style="border-color:#4f6ef740;color:var(--accent)" onclick='downloadCertPNG(${JSON.stringify(c)}, window._certEventName, window._certEventDate)'>⬇ PNG</button>
              <button class="btn btn-ghost btn-sm" onclick='printSingleCert(${JSON.stringify(c)}, window._certEventName, window._certEventDate)'>🖨 Print</button>
              `
                  : `<span style="font-size:12px;color:var(--muted)">Awaiting approval</span>`
              }
            </td>
          </tr>`;
          })
          .join("")}
        </tbody></table></div>`;
  } catch {
    div.innerHTML = `<p style="color:var(--danger)">Server error</p>`;
  }
}

// ── CERTIFICATE HTML BUILDER ──────────────────────────────────
function buildCertHTML(c, eventName, eventDate) {
  const isWinner = c.certificate_type === "winner";
  const accentColor = isWinner ? "#d97706" : "#4f6ef7";
  const accentLight = isWinner ? "#fef3c7" : "#eff2fe";
  const badgeEmoji = isWinner ? "🏆" : "📜";
  const certTitle = isWinner
    ? "Certificate of Achievement"
    : "Certificate of Participation";
  const certVerb = isWinner
    ? "has won a prize in"
    : "has successfully participated in";
  const rollInfo = [
    c.studentRoll ? `Roll No: ${c.studentRoll}` : "",
    c.branch || "",
    c.college || "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  return `
  <div id="cert-render" style="
    width:297mm; height:210mm; background:#fff;
    font-family:'Georgia',serif;
    display:flex; align-items:center; justify-content:center;
    position:relative; overflow:hidden; box-sizing:border-box;
  ">
    <!-- Corner decorations -->
    <div style="position:absolute;top:0;left:0;width:60px;height:60px;border-top:6px solid ${accentColor};border-left:6px solid ${accentColor};border-radius:2px"></div>
    <div style="position:absolute;top:0;right:0;width:60px;height:60px;border-top:6px solid ${accentColor};border-right:6px solid ${accentColor};border-radius:2px"></div>
    <div style="position:absolute;bottom:0;left:0;width:60px;height:60px;border-bottom:6px solid ${accentColor};border-left:6px solid ${accentColor};border-radius:2px"></div>
    <div style="position:absolute;bottom:0;right:0;width:60px;height:60px;border-bottom:6px solid ${accentColor};border-right:6px solid ${accentColor};border-radius:2px"></div>
    <!-- Top stripe -->
    <div style="position:absolute;top:0;left:0;right:0;height:8px;background:linear-gradient(90deg,${accentColor},#818cf8,${accentColor})"></div>
    <!-- Bottom stripe -->
    <div style="position:absolute;bottom:0;left:0;right:0;height:8px;background:linear-gradient(90deg,${accentColor},#818cf8,${accentColor})"></div>
    <!-- Watermark -->
    <div style="position:absolute;font-size:120px;color:#f3f4f6;font-weight:900;letter-spacing:-4px;z-index:0;user-select:none;pointer-events:none">${badgeEmoji}</div>
    <!-- Content -->
    <div style="position:relative;z-index:1;text-align:center;padding:30px 60px;width:100%">
      <!-- Brand -->
      <div style="font-family:Arial,sans-serif;font-size:11pt;font-weight:800;letter-spacing:6px;color:${accentColor};text-transform:uppercase;margin-bottom:4px">EventVerify</div>
      <div style="font-size:8pt;color:#9ca3af;letter-spacing:2px;font-family:Arial,sans-serif;margin-bottom:16px">COLLEGE EVENT MANAGEMENT PLATFORM</div>
      <!-- Certificate type -->
      <div style="font-size:22pt;font-weight:bold;color:#111827;margin-bottom:12px;font-family:'Georgia',serif">${certTitle}</div>
      <!-- Divider -->
      <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:12px">
        <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,${accentColor})"></div>
        <div style="font-size:14px">${badgeEmoji}</div>
        <div style="flex:1;height:1px;background:linear-gradient(90deg,${accentColor},transparent)"></div>
      </div>
      <div style="font-size:11pt;color:#6b7280;font-style:italic;margin-bottom:10px">This is to certify that</div>
      <!-- Student Name -->
      <div style="font-size:26pt;font-weight:bold;color:${accentColor};margin-bottom:6px;font-family:'Georgia',serif;letter-spacing:1px">${c.studentName}</div>
      <!-- Student Details -->
      <div style="background:${accentLight};border-radius:8px;padding:8px 24px;display:inline-block;margin-bottom:12px">
        <span style="font-size:9pt;color:#374151;font-family:Arial,sans-serif;font-weight:600">${rollInfo}</span>
      </div>
      <div style="font-size:11pt;color:#4b5563;font-style:italic;margin-bottom:8px">${certVerb}</div>
      <!-- Event Name -->
      <div style="font-size:17pt;font-weight:bold;color:#111827;margin-bottom:4px;font-family:'Georgia',serif">${eventName}</div>
      ${eventDate ? `<div style="font-size:9pt;color:#9ca3af;font-family:Arial,sans-serif;margin-bottom:16px">Held on ${eventDate}</div>` : "<div style='margin-bottom:16px'></div>"}
      <!-- Divider -->
      <div style="height:1px;background:#e5e7eb;margin-bottom:16px"></div>
      <!-- Signatures -->
      <div style="display:flex;justify-content:space-around;width:100%">
        <div style="text-align:center;font-family:Arial,sans-serif">
          <div style="width:120px;border-top:1.5px solid #374151;padding-top:6px;font-size:8.5pt;color:#374151;font-weight:600">Event Organizer</div>
        </div>
        <div style="text-align:center;font-family:Arial,sans-serif">
          <div style="width:120px;border-top:1.5px solid #374151;padding-top:6px;font-size:8.5pt;color:#374151;font-weight:600">Principal / Dean</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── DOWNLOAD SINGLE CERTIFICATE AS PNG ───────────────────────
function downloadCertPNG(c, eventName, eventDate) {
  const fileName = `Certificate_${(c.studentName || "student").replace(/\s+/g, "_")}_${(c.studentRoll || "").replace(/\//g, "-") || "cert"}.png`;
  const isWinner = c.certificate_type === "winner";
  const accent = isWinner ? "#d97706" : "#4f6ef7";
  const accentLight = isWinner ? "#fef3c7" : "#eff2fe";
  const certTitle = isWinner
    ? "Certificate of Achievement"
    : "Certificate of Participation";
  const certVerb = isWinner
    ? "has won a prize in"
    : "has successfully participated in";
  const rollInfo = [
    c.studentRoll ? `Roll No: ${c.studentRoll}` : "",
    c.branch || "",
    c.college || "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const badgeEmoji = isWinner ? "🏆" : "📜";

  // Draw entirely on Canvas — no html2canvas, no external libs, works everywhere
  const W = 1587,
    H = 1122; // A4 landscape at 135dpi
  const w = window.open("", "_blank", "width=900,height=680");
  if (!w) {
    alert("Please allow popups for this site to download certificates.");
    return;
  }
  w.document
    .write(`<!DOCTYPE html><html><head><title>Download Certificate</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#1a1a2e;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;font-family:Arial,sans-serif}
      canvas{border-radius:4px;max-width:95vw;box-shadow:0 8px 40px #0008}
      .dl-btn{background:linear-gradient(135deg,#4f6ef7,#22d3a5);color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}
      .info{color:#9ca3af;font-size:13px}
    </style>
  </head><body>
    <div class="info" id="info">⏳ Generating certificate…</div>
    <canvas id="cert" width="${W}" height="${H}" style="width:${W * 0.55}px;height:${H * 0.55}px"></canvas>
    <script>
    (function(){
      const W=${W}, H=${H};
      const accent=${JSON.stringify(accent)};
      const accentLight=${JSON.stringify(accentLight)};
      const certTitle=${JSON.stringify(certTitle)};
      const certVerb=${JSON.stringify(certVerb)};
      const rollInfo=${JSON.stringify(rollInfo)};
      const studentName=${JSON.stringify(c.studentName || "")};
      const evName=${JSON.stringify(eventName || "")};
      const evDate=${JSON.stringify(eventDate ? "Held on " + eventDate : "")};
      const badgeEmoji=${JSON.stringify(badgeEmoji)};
      const fileName=${JSON.stringify(fileName)};

      const cv = document.getElementById('cert');
      const ctx = cv.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      // Top & bottom gradient stripes
      const stripeH = 18;
      const grad = ctx.createLinearGradient(0,0,W,0);
      grad.addColorStop(0, accent); grad.addColorStop(0.5, '#818cf8'); grad.addColorStop(1, accent);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, stripeH);
      ctx.fillRect(0, H - stripeH, W, stripeH);

      // Corner brackets
      const bS = 100, bT = 10;
      ctx.strokeStyle = accent; ctx.lineWidth = bT; ctx.lineCap = 'square';
      [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]].forEach(([x,y,dx,dy])=>{
        ctx.beginPath(); ctx.moveTo(x+dx*bS, y); ctx.lineTo(x, y); ctx.lineTo(x, y+dy*bS); ctx.stroke();
      });

      // Watermark emoji
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.font = '480px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(badgeEmoji, W/2, H/2);
      ctx.restore();

      // Brand name
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = accent;
      ctx.font = 'bold 34px Arial';
      ctx.letterSpacing = '8px';
      ctx.fillText('EVENTVERIFY', W/2, 140);
      ctx.letterSpacing = '0px';

      // Sub-brand
      ctx.fillStyle = '#9ca3af';
      ctx.font = '20px Arial';
      ctx.fillText('COLLEGE EVENT MANAGEMENT PLATFORM', W/2, 174);

      // Certificate title
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 72px Georgia, serif';
      ctx.fillText(certTitle, W/2, 268);

      // Divider line with emoji
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(180, 298); ctx.lineTo(W/2 - 30, 298); ctx.stroke();
      ctx.font = '30px serif'; ctx.fillText(badgeEmoji, W/2, 304);
      ctx.beginPath(); ctx.moveTo(W/2 + 30, 298); ctx.lineTo(W - 180, 298); ctx.stroke();

      // "This is to certify that"
      ctx.fillStyle = '#6b7280';
      ctx.font = 'italic 30px Georgia, serif';
      ctx.fillText('This is to certify that', W/2, 358);

      // Student name
      ctx.fillStyle = accent;
      ctx.font = 'bold 86px Georgia, serif';
      ctx.fillText(studentName, W/2, 464);

      // Roll info pill
      if (rollInfo) {
        const pillW = Math.min(ctx.measureText(rollInfo).width + 80, W - 200);
        const pillX = W/2 - pillW/2, pillY = 486, pillH = 52, pillR = 14;
        ctx.fillStyle = accentLight;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, pillR);
        ctx.fill();
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 24px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(rollInfo, W/2, pillY + pillH/2);
        ctx.textBaseline = 'alphabetic';
      }

      // Verb
      ctx.fillStyle = '#4b5563';
      ctx.font = 'italic 30px Georgia, serif';
      ctx.fillText(certVerb, W/2, 588);

      // Event name
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 54px Georgia, serif';
      ctx.fillText(evName, W/2, 654);

      // Event date
      if (evDate) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '24px Arial';
        ctx.fillText(evDate, W/2, 694);
      }

      // Horizontal divider
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(180, 730); ctx.lineTo(W - 180, 730); ctx.stroke();

      // Signature lines
      const sig1X = W/2 - 280, sig2X = W/2 + 160, sigY = 870, sigW = 240;
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sig1X, sigY); ctx.lineTo(sig1X + sigW, sigY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sig2X, sigY); ctx.lineTo(sig2X + sigW, sigY); ctx.stroke();
      ctx.fillStyle = '#374151'; ctx.font = 'bold 22px Arial'; ctx.textBaseline = 'top';
      ctx.fillText('Event Organizer', sig1X + sigW/2, sigY + 12);
      ctx.fillText('Principal / Dean', sig2X + sigW/2, sigY + 12);
      ctx.textBaseline = 'alphabetic';

      // Auto-trigger download
      document.getElementById('info').textContent = '✅ Certificate ready!';
      setTimeout(() => {
        const a = document.createElement('a');
        a.download = fileName;
        a.href = cv.toDataURL('image/png');
        a.click();
      }, 400);

      // Also show manual button
      const btn = document.createElement('button');
      btn.className = 'dl-btn';
      btn.textContent = '⬇ Download PNG';
      btn.onclick = () => {
        const a = document.createElement('a');
        a.download = fileName;
        a.href = cv.toDataURL('image/png');
        a.click();
      };
      document.body.appendChild(btn);
    })();
    <\/script>
  </body></html>`);
  w.document.close();
}

// ── PRINT SINGLE CERTIFICATE ─────────────────────────────────
function printSingleCert(c, eventName, eventDate) {
  const certHtml = buildCertHTML(c, eventName, eventDate);
  const w = window.open("", "_blank", "width=1200,height=800");
  w.document.write(`<!DOCTYPE html><html><head><title>Certificate</title>
    <style>@media print{body{margin:0}@page{size:A4 landscape;margin:0}}
    body{background:#f0f0f0;padding:20px;display:flex;justify-content:center}</style>
  </head><body>${certHtml}<script>window.onload=()=>setTimeout(()=>{window.print();},400);<\/script></body></html>`);
  w.document.close();
}

// ── PRINT ALL CERTIFICATES (Organizer) ───────────────────────
function printCertificates() {
  if (!window._certData?.length) return;
  const ev = _orgEvents.find((e) => e.id === _currentOrgEventId);
  const eventName = ev?.title || "Event";
  const eventDate = ev?.event_date
    ? new Date(ev.event_date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  const allHtml = window._certData
    .map(
      (c) =>
        `<div style="page-break-after:always">${buildCertHTML(c, eventName, eventDate)}</div>`,
    )
    .join("");
  const w = window.open("", "_blank", "width=1200,height=800");
  w.document
    .write(`<!DOCTYPE html><html><head><title>Certificates - ${eventName}</title>
    <style>@media print{body{margin:0}@page{size:A4 landscape;margin:0}}
    body{background:#f0f0f0;padding:20px;display:flex;flex-direction:column;align-items:center;gap:20px}</style>
  </head><body>${allHtml}<script>window.onload=()=>setTimeout(()=>{window.print();},400);<\/script></body></html>`);
  w.document.close();
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const active = document.querySelector(".screen.active")?.id;
  if (active === "screen-register") doSendOTP();
  else if (active === "screen-login") doLogin();
  else if (active === "screen-otp") doVerifyOTP();
});
np;
