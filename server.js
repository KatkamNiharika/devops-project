const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const pool = require("./config/db");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "college_event_secret_2026";
const DEFAULT_ADMIN_EMAIL = "admin@gmail.com";
const DEFAULT_ADMIN_PASS = "admin123";

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ── In-memory OTP store ──────────────────────────────────────
const otpStore = {}; // { email: { otp, expiresAt, userData } }

// ── Nodemailer ───────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ── JWT helpers ──────────────────────────────────────────────
const buildToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });

// ── Middleware ───────────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res
      .status(401)
      .json({ success: false, message: "Access token required" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res
        .status(403)
        .json({ success: false, message: "Invalid or expired token" });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res
      .status(403)
      .json({ success: false, message: "Admin access only" });
  next();
};

// ── Helpers ──────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, otp, name) {
  await transporter.sendMail({
    from: `"EventVerify" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "EventVerify – Your OTP Verification Code",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#07080f;color:#e4e6f0;padding:32px;border-radius:12px">
        <h2 style="color:#4f6ef7;margin-bottom:8px">EventVerify 🎓</h2>
        <p style="color:#9395b0;margin-bottom:24px">College Event Management Platform</p>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your OTP verification code is:</p>
        <div style="text-align:center;margin:28px 0">
          <span style="background:#4f6ef720;border:2px solid #4f6ef740;padding:16px 36px;font-size:36px;font-weight:800;letter-spacing:12px;border-radius:12px;color:#4f6ef7">${otp}</span>
        </div>
        <p style="color:#9395b0;font-size:13px">Valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <hr style="border-color:#252638;margin:24px 0"/>
        <p style="color:#525470;font-size:12px">EventVerify – Secure QR-based Event Verification</p>
      </div>`,
  });
}

const getEventDateTime = (body) => {
  if (body.event_date)
    return { event_date: body.event_date, event_time: body.event_time || null };
  if (body.time) {
    const [event_date, event_time = "00:00"] = body.time.split("T");
    return { event_date, event_time };
  }
  return { event_date: null, event_time: null };
};

const getOrCreateDefaultAdmin = async () => {
  const [rows] = await pool.query(
    "SELECT id, full_name, email, role FROM users WHERE email = ? LIMIT 1",
    [DEFAULT_ADMIN_EMAIL],
  );
  if (rows.length) return rows[0];
  const hash = await bcrypt.hash(DEFAULT_ADMIN_PASS, 12);
  const [r] = await pool.query(
    "INSERT INTO users (full_name,email,password,role,department,roll_number,phone) VALUES (?,?,?,'admin',NULL,NULL,NULL)",
    ["Administrator", DEFAULT_ADMIN_EMAIL, hash],
  );
  return {
    id: r.insertId,
    full_name: "Administrator",
    email: DEFAULT_ADMIN_EMAIL,
    role: "admin",
  };
};

// ════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════
app.get("/", (_, res) => res.send("EventVerify Backend Running!"));

// ====================== DEBUG ROUTE - PUBLIC (NO AUTH REQUIRED) ======================
app.get("/api/debug-regs", async (req, res) => {
  try {
    const [registrations] = await pool.query(`
            SELECT 
                r.id,
                r.student_id,
                r.event_id,
                r.qr_token,
                COALESCE(r.status, 'registered') AS status,
                r.created_at,
                s.full_name AS studentName,
                s.roll_number AS studentRoll,
                s.email AS studentEmail,
                s.branch,
                s.department AS college,
                s.phone,
                e.title AS eventName,
                e.event_date,
                e.event_time,
                e.venue
            FROM registrations r
            LEFT JOIN users s ON r.student_id = s.id
            LEFT JOIN events e ON r.event_id = e.id
            ORDER BY r.created_at DESC
        `);

    res.json({
      success: true,
      count: registrations.length,
      registrations: registrations || [],
    });

    console.log(
      `✅ /api/debug-regs → Returned ${registrations.length} registrations`,
    );
  } catch (error) {
    console.error("❌ Debug-regs error:", error);
    res.status(500).json({
      success: false,
      message: "Database error while fetching registrations",
    });
  }
});

app.get("/test-db", async (_, res, next) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS test");
    res.json({ success: true, message: "Database connected!", data: rows });
  } catch (e) {
    next(e);
  }
});

// ── SEND OTP ─────────────────────────────────────────────────
app.post("/api/send-otp", async (req, res, next) => {
  const { email, full_name, password, roll_number, department, branch, phone } =
    req.body;
  if (!email || !full_name)
    return res
      .status(400)
      .json({ success: false, message: "Email and full name are required" });

  const normEmail = email.trim().toLowerCase();
  try {
    // Uniqueness checks
    const [existEmail] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [normEmail],
    );
    if (existEmail.length)
      return res
        .status(409)
        .json({ success: false, message: "Email already registered" });

    if (roll_number) {
      const [existRoll] = await pool.query(
        "SELECT id FROM users WHERE roll_number = ?",
        [roll_number.trim()],
      );
      if (existRoll.length)
        return res
          .status(409)
          .json({ success: false, message: "Roll number already registered" });
    }
    if (phone) {
      const [existPhone] = await pool.query(
        "SELECT id FROM users WHERE phone = ?",
        [phone.trim()],
      );
      if (existPhone.length)
        return res.status(409).json({
          success: false,
          message: "Phone number already registered with another account",
        });
    }

    const otp = generateOTP();
    otpStore[normEmail] = {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
      userData: {
        full_name: full_name.trim(),
        email: normEmail,
        password,
        roll_number,
        department,
        branch,
        phone,
      },
    };
    await sendOTPEmail(normEmail, otp, full_name.trim());
    res.json({ success: true, message: "OTP sent to your email" });
  } catch (e) {
    next(e);
  }
});

// ── VERIFY OTP & REGISTER ────────────────────────────────────
app.post("/api/verify-otp", async (req, res, next) => {
  const { email, otp } = req.body;
  const normEmail = email?.trim().toLowerCase();
  if (!normEmail || !otp)
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required" });

  const record = otpStore[normEmail];
  if (!record)
    return res.status(400).json({
      success: false,
      message: "OTP not found. Please request a new one.",
    });
  if (Date.now() > record.expiresAt) {
    delete otpStore[normEmail];
    return res.status(400).json({
      success: false,
      message: "OTP has expired. Please request a new one.",
    });
  }
  if (record.otp !== otp.toString().trim())
    return res.status(400).json({ success: false, message: "Invalid OTP" });

  const { full_name, password, roll_number, department, branch, phone } =
    record.userData;
  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      "INSERT INTO users (full_name,email,password,role,department,roll_number,phone,branch) VALUES (?,?,?,'student',?,?,?,?)",
      [
        full_name,
        normEmail,
        hash,
        department?.trim() || null,
        roll_number?.trim() || null,
        phone?.trim() || null,
        branch?.trim() || null,
      ],
    );
    delete otpStore[normEmail];
    res.status(201).json({
      success: true,
      message: "Account created successfully!",
      userId: result.insertId,
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({
        success: false,
        message: "Email or Roll Number already exists",
      });
    next(e);
  }
});

// ── LOGIN ────────────────────────────────────────────────────
// ── LOGIN (Updated for Volunteer) ─────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const normEmail = email?.trim().toLowerCase();

  try {
    const [users] = await pool.query("SELECT * FROM users WHERE email = ?", [
      normEmail,
    ]);
    if (users.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    res.json({
      success: true,
      token: jwt.sign(
        { id: user.id, role: user.role, email: user.email },
        JWT_SECRET,
        { expiresIn: "7d" },
      ),
      user: {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        email: user.email,
        roll_number: user.roll_number,
        department: user.department,
        branch: user.branch,
        phone: user.phone,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── EVENTS ───────────────────────────────────────────────────
app.get("/api/events", async (_, res, next) => {
  try {
    const [events] = await pool.query(
      "SELECT * FROM events ORDER BY event_date ASC, event_time ASC",
    );
    res.json({ success: true, events });
  } catch (e) {
    next(e);
  }
});

app.post(
  "/api/events",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    const title = req.body.title || req.body.name;
    const desc = req.body.description || req.body.desc || null;
    const venue = req.body.venue;
    const cap = Number(req.body.capacity) || 500;
    const hasCert = req.body.has_certificate ? 1 : 0;
    const { event_date, event_time } = getEventDateTime(req.body);
    if (!title || !event_date || !venue)
      return res.status(400).json({
        success: false,
        message: "Title, date/time and venue are required",
      });
    try {
      const [r] = await pool.query(
        "INSERT INTO events (title,description,event_date,event_time,venue,capacity,created_by,has_certificate) VALUES (?,?,?,?,?,?,?,?)",
        [title, desc, event_date, event_time, venue, cap, req.user.id, hasCert],
      );
      res.status(201).json({
        success: true,
        message: "Event created!",
        eventId: r.insertId,
      });
    } catch (e) {
      next(e);
    }
  },
);

app.put(
  "/api/events/:id",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    const title = req.body.title || req.body.name;
    const desc = req.body.description || req.body.desc || null;
    const venue = req.body.venue;
    const cap = Number(req.body.capacity) || 500;
    const hasCert = req.body.has_certificate ? 1 : 0;
    const { event_date, event_time } = getEventDateTime(req.body);
    if (!title || !event_date || !venue)
      return res.status(400).json({
        success: false,
        message: "Title, date/time and venue are required",
      });
    try {
      const [r] = await pool.query(
        "UPDATE events SET title=?,description=?,event_date=?,event_time=?,venue=?,capacity=?,has_certificate=? WHERE id=?",
        [
          title,
          desc,
          event_date,
          event_time,
          venue,
          cap,
          hasCert,
          req.params.id,
        ],
      );
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Event not found" });
      res.json({ success: true, message: "Event updated!" });
    } catch (e) {
      next(e);
    }
  },
);

app.delete(
  "/api/events/:id",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      await pool.query("DELETE FROM registrations WHERE event_id = ?", [
        req.params.id,
      ]);
      const [r] = await pool.query("DELETE FROM events WHERE id = ?", [
        req.params.id,
      ]);
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Event not found" });
      res.json({ success: true, message: "Event deleted!" });
    } catch (e) {
      next(e);
    }
  },
);

// ── EVENT REGISTRATION ───────────────────────────────────────
app.post("/api/register-event", authenticateToken, async (req, res, next) => {
  const event_id = req.body.event_id || req.body.eventId;
  const student_id = req.user.id;
  if (!event_id)
    return res
      .status(400)
      .json({ success: false, message: "Event ID is required" });
  try {
    const [existing] = await pool.query(
      "SELECT id FROM registrations WHERE student_id=? AND event_id=?",
      [student_id, event_id],
    );
    if (existing.length)
      return res.status(409).json({
        success: false,
        message: "You are already registered for this event",
      });

    const qr_token = `QR-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const [r] = await pool.query(
      "INSERT INTO registrations (student_id,event_id,qr_token,status) VALUES (?,?,?,'registered')",
      [student_id, event_id, qr_token],
    );
    res.json({
      success: true,
      message: "Registered successfully!",
      registrationId: r.insertId,
      qr_token,
    });
  } catch (e) {
    next(e);
  }
});

// ── MY REGISTRATIONS ─────────────────────────────────────────
app.get("/api/my-registrations", authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.event_id, r.qr_token, COALESCE(r.status,'registered') AS status, r.created_at,
              r.certificate_type, r.certificate_status, r.event_role,
              e.title, e.event_date, e.event_time, e.venue, e.description,
              u.full_name, u.roll_number, u.branch, u.department, u.phone, u.email
       FROM registrations r
       LEFT JOIN events e ON r.event_id = e.id
       LEFT JOIN users u ON r.student_id = u.id
       WHERE r.student_id = ?
       ORDER BY e.event_date DESC, e.event_time DESC`,
      [req.user.id],
    );
    res.json({ success: true, registrations: rows });
  } catch (e) {
    next(e);
  }
});

// ── MY CERTIFICATES ─────────────────────────────────────────
app.get("/api/my-certificates", authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.certificate_type, r.status, r.event_role,
              e.title AS eventName, e.event_date, e.venue,
              u.full_name AS studentName, u.roll_number AS studentRoll, u.branch, u.department AS college
       FROM registrations r
       LEFT JOIN events e ON r.event_id = e.id
       LEFT JOIN users u ON r.student_id = u.id
       WHERE r.student_id = ? AND r.status = 'attended' AND r.certificate_type IS NOT NULL AND r.certificate_status = 'approved'
       ORDER BY e.event_date DESC`,
      [req.user.id],
    );
    res.json({ success: true, certificates: rows });
  } catch (e) {
    next(e);
  }
});

// ── ALL REGISTRATIONS (admin) ────────────────────────────────
app.get(
  "/api/registrations",
  authenticateToken,
  requireAdmin,
  async (_, res, next) => {
    try {
      const [rows] = await pool.query(`
        SELECT r.id, r.student_id, r.event_id, r.qr_token,
               COALESCE(r.status,'registered') AS status, r.created_at,
               COALESCE(u.full_name,'(deleted user)')  AS studentName,
               COALESCE(u.roll_number,'')              AS studentRoll,
               COALESCE(u.email,'')                    AS studentEmail,
               COALESCE(u.phone,'')                    AS phone,
               COALESCE(u.department,'')               AS college,
               COALESCE(u.branch,'')                   AS branch,
               COALESCE(e.title,'(deleted event)')     AS eventName,
               e.event_date, e.event_time,
               COALESCE(e.venue,'')                    AS venue
        FROM registrations r
        LEFT JOIN users  u ON r.student_id = u.id
        LEFT JOIN events e ON r.event_id   = e.id
        ORDER BY r.created_at DESC`);
      res.json({ success: true, registrations: rows });
    } catch (e) {
      next(e);
    }
  },
);

// ── PER-EVENT REGISTRATIONS (admin) ─────────────────────────
app.get(
  "/api/events/:id/registrations",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.id, r.qr_token, r.status, r.created_at,
              u.full_name AS studentName, u.roll_number AS studentRoll,
              u.email AS studentEmail, u.phone, u.department AS college, u.branch
       FROM registrations r
       LEFT JOIN users u ON r.student_id = u.id
       WHERE r.event_id = ?
       ORDER BY r.created_at DESC`,
        [req.params.id],
      );
      res.json({ success: true, registrations: rows });
    } catch (e) {
      next(e);
    }
  },
);
// ── VERIFY QR ────────────────────────────────────────────────
// ── VERIFY QR ────────────────────────────────────────────────
app.post(
  "/api/verify-qr",
  authenticateToken,
  // requireAdmin,   // commented for testing
  async (req, res) => {
    console.log("🔥 VERIFY-QR ROUTE HIT!");

    let qr_token = "";
    if (typeof req.body === "string") {
      qr_token = req.body.trim();
    } else if (req.body && typeof req.body === "object") {
      qr_token = (req.body.qr_token || req.body.qrToken || req.body.token || "")
        .toString()
        .trim();
    }

    console.log(`📥 Token received: "${qr_token}"`);

    if (!qr_token || qr_token.length < 5) {
      console.log("❌ Invalid token");
      return res
        .status(400)
        .json({ success: false, message: "Valid QR token is required" });
    }

    try {
      console.log("🔍 Running SELECT query for token:", qr_token);
      const [rows] = await pool.query(
        `SELECT 
           r.id, r.student_id, COALESCE(r.status, 'registered') AS status, 
           r.qr_token, r.event_id,
           COALESCE(u.full_name, 'Unknown') AS studentName, 
           COALESCE(u.roll_number, '-') AS studentRoll,
           COALESCE(u.email, '-') AS studentEmail, 
           COALESCE(u.department, '-') AS college, 
           COALESCE(u.branch, '-') AS branch, 
           COALESCE(u.phone, '-') AS phone,
           COALESCE(e.title, 'Unknown Event') AS eventName, 
           e.event_date, 
           COALESCE(e.venue, '-') AS venue
         FROM registrations r
         LEFT JOIN users u ON r.student_id = u.id
         LEFT JOIN events e ON r.event_id = e.id
         WHERE r.qr_token = ?`,
        [qr_token],
      );

      console.log(`✅ SELECT found ${rows.length} row(s)`);

      if (rows.length === 0) {
        console.log("❌ QR code not found in database");
        return res.status(404).json({
          success: false,
          message: `QR code not found: ${qr_token}`,
        });
      }

      const reg = rows[0];
      console.log(`Found student: ${reg.studentName}, Status: ${reg.status}`);

      if (reg.status === "attended") {
        console.log("⚠️ Already attended");
        return res.json({
          success: true,
          alreadyAttended: true,
          message: "Attendance already marked",
          registration: reg,
        });
      }

      console.log(`🔄 Updating registration id=${reg.id} to 'attended'`);

      const [updateResult] = await pool.query(
        "UPDATE registrations SET status = 'attended' WHERE id = ?",
        [reg.id],
      );

      console.log(`📊 Update result:`, updateResult);

      reg.status = "attended";

      console.log(`🎉 SUCCESS - Attendance marked for ${reg.studentName}`);

      res.json({
        success: true,
        alreadyAttended: false,
        message: "Attendance marked successfully!",
        registration: reg,
      });
    } catch (error) {
      console.error("❌ ERROR in /verify-qr:", error.message);
      // Self-heal: if status column is wrong type (ENUM truncation), fix it now and retry
      if (
        error.message &&
        (error.message.includes("truncated") ||
          error.message.includes("Data truncated"))
      ) {
        try {
          console.log("🔧 Self-healing: fixing status column type...");
          await pool.query(
            "ALTER TABLE registrations MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'registered'",
          );
          // Retry the UPDATE directly
          await pool.query(
            "UPDATE registrations SET status = 'attended' WHERE qr_token = ?",
            [qr_token],
          );
          console.log("✅ Self-heal successful");
          return res.json({
            success: true,
            alreadyAttended: false,
            message: "Attendance marked! (DB auto-fixed)",
          });
        } catch (healErr) {
          console.error("❌ Self-heal failed:", healErr.message);
        }
      }
      res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },
);
// ── MARK ATTENDANCE ─────────────────────────────────────────
app.patch(
  "/api/registrations/:id/attendance",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const [r] = await pool.query(
        "UPDATE registrations SET status='attended' WHERE id=?",
        [req.params.id],
      );
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Registration not found" });
      res.json({ success: true, message: "Attendance marked!" });
    } catch (e) {
      next(e);
    }
  },
);

// ── UNMARK ATTENDANCE ────────────────────────────────────────
app.patch(
  "/api/registrations/:id/unattendance",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const [r] = await pool.query(
        "UPDATE registrations SET status='registered' WHERE id=?",
        [req.params.id],
      );
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Registration not found" });
      res.json({ success: true, message: "Attendance unmarked" });
    } catch (e) {
      next(e);
    }
  },
);

// ── DELETE REGISTRATION ──────────────────────────────────────
app.delete(
  "/api/registrations/:id",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const [r] = await pool.query("DELETE FROM registrations WHERE id=?", [
        req.params.id,
      ]);
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Registration not found" });
      res.json({ success: true, message: "Registration deleted!" });
    } catch (e) {
      next(e);
    }
  },
);

// ── ADMIN STATS ──────────────────────────────────────────────
app.get(
  "/api/admin/stats",
  authenticateToken,
  requireAdmin,
  async (_, res, next) => {
    try {
      const [[ev], [st], [reg], [att], [pendCert]] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total FROM events"),
        pool.query("SELECT COUNT(*) AS total FROM users WHERE role='student'"),
        pool.query("SELECT COUNT(*) AS total FROM registrations"),
        pool.query(
          `SELECT COUNT(*) AS total FROM registrations
           WHERE COALESCE(status,'registered')='attended'`,
        ),
        pool.query(
          `SELECT COUNT(*) AS total FROM registrations
           WHERE certificate_status='pending'`,
        ),
      ]);
      res.json({
        success: true,
        stats: {
          events: ev[0].total,
          students: st[0].total,
          registrations: reg[0].total,
          attended: att[0].total,
          pendingCerts: pendCert[0].total,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── ALL WEBSITE STUDENTS ─────────────────────────────────────
app.get(
  "/api/admin/students",
  authenticateToken,
  requireAdmin,
  async (_, res, next) => {
    try {
      const [rows] = await pool.query(
        "SELECT id,full_name,email,roll_number,phone,department,branch,created_at FROM users WHERE role='student' ORDER BY created_at DESC",
      );
      res.json({ success: true, students: rows });
    } catch (e) {
      next(e);
    }
  },
);

// ── DELETE STUDENT ───────────────────────────────────────────
app.delete(
  "/api/admin/students/:id",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      await pool.query("DELETE FROM registrations WHERE student_id=?", [
        req.params.id,
      ]);
      const [r] = await pool.query(
        "DELETE FROM users WHERE id=? AND role='student'",
        [req.params.id],
      );
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Student not found" });
      res.json({ success: true, message: "Student deleted permanently" });
    } catch (e) {
      next(e);
    }
  },
);

// ── ADMIN REGISTER STUDENT ──────────────────────────────────
app.post(
  "/api/admin/register-student",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    const { event_id, student_id } = req.body;
    if (!event_id || !student_id)
      return res.status(400).json({
        success: false,
        message: "event_id and student_id are required",
      });
    try {
      const [evRows] = await pool.query("SELECT id FROM events WHERE id=?", [
        event_id,
      ]);
      if (!evRows.length)
        return res
          .status(404)
          .json({ success: false, message: "Event not found" });
      const [stRows] = await pool.query(
        "SELECT id FROM users WHERE id=? AND role='student'",
        [student_id],
      );
      if (!stRows.length)
        return res
          .status(404)
          .json({ success: false, message: "Student not found" });
      const [exist] = await pool.query(
        "SELECT id FROM registrations WHERE event_id=? AND student_id=?",
        [event_id, student_id],
      );
      if (exist.length)
        return res.status(409).json({
          success: false,
          message: "Student is already registered for this event",
        });
      const qr_token = `QR-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const [r] = await pool.query(
        "INSERT INTO registrations (event_id, student_id, qr_token, status) VALUES (?,?,?,'registered')",
        [event_id, student_id, qr_token],
      );
      res.status(201).json({
        success: true,
        message: "Student registered successfully!",
        registrationId: r.insertId,
        qr_token,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── VOLUNTEER: Browse all events with interest status ────────
app.get("/api/volunteer/all-events", authenticateToken, async (req, res) => {
  if (req.user.role !== "volunteer")
    return res
      .status(403)
      .json({ success: false, message: "Volunteer access only" });
  try {
    const [events] = await pool.query(
      `SELECT e.*,
              vi.status AS interest_status,
              ve.volunteer_id IS NOT NULL AS is_assigned
       FROM events e
       LEFT JOIN volunteer_interests vi
         ON e.id = vi.event_id AND vi.volunteer_id = ?
       LEFT JOIN volunteer_events ve
         ON e.id = ve.event_id AND ve.volunteer_id = ?
       ORDER BY e.event_date ASC, e.event_time ASC`,
      [req.user.id, req.user.id],
    );
    res.json({ success: true, events });
  } catch (e) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── VOLUNTEER: Express / withdraw interest in an event ───────
app.post("/api/volunteer/interest", authenticateToken, async (req, res) => {
  if (req.user.role !== "volunteer")
    return res
      .status(403)
      .json({ success: false, message: "Volunteer access only" });

  const { event_id, action } = req.body; // action: "interested" | "withdraw"
  if (!event_id || !["interested", "withdraw"].includes(action))
    return res
      .status(400)
      .json({ success: false, message: "event_id and valid action required" });

  try {
    if (action === "withdraw") {
      await pool.query(
        "DELETE FROM volunteer_interests WHERE volunteer_id = ? AND event_id = ?",
        [req.user.id, event_id],
      );
      return res.json({ success: true, message: "Interest withdrawn" });
    }

    await pool.query(
      `INSERT INTO volunteer_interests (volunteer_id, event_id, status)
       VALUES (?, ?, 'interested')
       ON DUPLICATE KEY UPDATE status = 'interested', created_at = CURRENT_TIMESTAMP`,
      [req.user.id, event_id],
    );
    res.json({ success: true, message: "Interest expressed successfully!" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── ADMIN: View volunteers interested in an event ────────────
app.get(
  "/api/admin/events/:id/interested-volunteers",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.department, vi.created_at AS expressed_at
         FROM volunteer_interests vi
         JOIN users u ON vi.volunteer_id = u.id
         WHERE vi.event_id = ? AND vi.status = 'interested'
         ORDER BY vi.created_at ASC`,
        [req.params.id],
      );
      res.json({ success: true, volunteers: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ROLE-BASED EVENT REGISTRATION ───────────────────────────
app.post(
  "/api/register-event-role",
  authenticateToken,
  async (req, res, next) => {
    const event_id = req.body.event_id;
    const role = req.body.role || "participant";
    const student_id = req.user.id;

    if (!event_id)
      return res
        .status(400)
        .json({ success: false, message: "event_id required" });
    if (!["participant", "volunteer", "organizer"].includes(role))
      return res.status(400).json({ success: false, message: "Invalid role" });

    try {
      const [evRows] = await pool.query("SELECT * FROM events WHERE id=?", [
        event_id,
      ]);
      if (!evRows.length)
        return res
          .status(404)
          .json({ success: false, message: "Event not found" });

      if (role === "organizer") {
        const [orgRows] = await pool.query(
          "SELECT id FROM event_organizers WHERE event_id=?",
          [event_id],
        );
        if (orgRows.length)
          return res.status(409).json({
            success: false,
            message:
              "This event already has an organizer. Only one organizer is allowed per event.",
          });
        const [existReg] = await pool.query(
          "SELECT id FROM registrations WHERE student_id=? AND event_id=?",
          [student_id, event_id],
        );
        if (existReg.length)
          return res.status(409).json({
            success: false,
            message: "You already have a registration for this event",
          });
        const qr_token = `ORG-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const [r] = await pool.query(
          "INSERT INTO registrations (student_id,event_id,qr_token,status,event_role) VALUES (?,?,?,'registered','organizer')",
          [student_id, event_id, qr_token],
        );
        await pool.query(
          "INSERT INTO event_organizers (event_id,user_id) VALUES (?,?)",
          [event_id, student_id],
        );
        return res.json({
          success: true,
          role: "organizer",
          message:
            "You are now the event organizer! Access your Organizer Portal from the dashboard.",
          registrationId: r.insertId,
        });
      }

      if (role === "participant") {
        const [existing] = await pool.query(
          "SELECT id FROM registrations WHERE student_id=? AND event_id=?",
          [student_id, event_id],
        );
        if (existing.length)
          return res.status(409).json({
            success: false,
            message: "You are already registered for this event",
          });
        const qr_token = `QR-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const [r] = await pool.query(
          "INSERT INTO registrations (student_id,event_id,qr_token,status,event_role) VALUES (?,?,?,'registered','participant')",
          [student_id, event_id, qr_token],
        );
        return res.json({
          success: true,
          role: "participant",
          message: "Registered! Here is your QR ticket.",
          registrationId: r.insertId,
          qr_token,
        });
      }

      if (role === "volunteer") {
        const [existing] = await pool.query(
          "SELECT id FROM registrations WHERE student_id=? AND event_id=?",
          [student_id, event_id],
        );
        if (existing.length)
          return res.status(409).json({
            success: false,
            message: "You already have a registration for this event",
          });
        const qr_token = `VOL-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const [r] = await pool.query(
          "INSERT INTO registrations (student_id,event_id,qr_token,status,event_role) VALUES (?,?,?,'registered','volunteer')",
          [student_id, event_id, qr_token],
        );
        return res.json({
          success: true,
          role: "volunteer",
          message: "Volunteer interest registered!",
          registrationId: r.insertId,
        });
      }
    } catch (e) {
      next(e);
    }
  },
);

// ── ORGANIZER: My organized events ──────────────────────────
app.get("/api/organizer/my-events", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.* FROM event_organizers eo
       JOIN events e ON eo.event_id = e.id
       WHERE eo.user_id = ? ORDER BY e.event_date ASC`,
      [req.user.id],
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── ORGANIZER: Get participants for their event ──────────────
app.get(
  "/api/organizer/event/:eventId/participants",
  authenticateToken,
  async (req, res) => {
    try {
      const [orgCheck] = await pool.query(
        "SELECT id FROM event_organizers WHERE event_id=? AND user_id=?",
        [req.params.eventId, req.user.id],
      );
      if (!orgCheck.length)
        return res.status(403).json({
          success: false,
          message: "Not the organizer for this event",
        });
      const [rows] = await pool.query(
        `SELECT r.id, r.qr_token, r.status, r.event_role, r.certificate_type,
              u.full_name AS studentName, u.roll_number AS studentRoll,
              u.email AS studentEmail, u.branch, u.department AS college, u.phone
       FROM registrations r LEFT JOIN users u ON r.student_id = u.id
       WHERE r.event_id = ? AND r.event_role = 'participant'
       ORDER BY u.full_name ASC`,
        [req.params.eventId],
      );
      res.json({ success: true, participants: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ORGANIZER: QR scan for attendance ───────────────────────
app.post("/api/organizer/verify-qr", authenticateToken, async (req, res) => {
  const qr_token = (req.body.qr_token || "").trim();
  if (!qr_token)
    return res
      .status(400)
      .json({ success: false, message: "QR token required" });
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.status, r.event_id, r.event_role,
              u.full_name AS studentName, u.roll_number AS studentRoll, u.email AS studentEmail,
              u.branch, u.department AS college,
              e.title AS eventName, e.event_date, e.venue
       FROM registrations r
       LEFT JOIN users u ON r.student_id = u.id
       LEFT JOIN events e ON r.event_id = e.id
       WHERE r.qr_token = ?`,
      [qr_token],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "QR code not found" });
    const reg = rows[0];
    const [orgCheck] = await pool.query(
      "SELECT id FROM event_organizers WHERE event_id=? AND user_id=?",
      [reg.event_id, req.user.id],
    );
    if (!orgCheck.length)
      return res.status(403).json({
        success: false,
        message: "You are not the organizer for this event",
      });
    if (reg.event_role !== "participant")
      return res
        .status(400)
        .json({ success: false, message: "Not a participant QR code" });
    if (reg.status === "attended")
      return res.json({
        success: true,
        alreadyAttended: true,
        registration: reg,
      });
    await pool.query("UPDATE registrations SET status='attended' WHERE id=?", [
      reg.id,
    ]);
    reg.status = "attended";
    res.json({ success: true, alreadyAttended: false, registration: reg });
  } catch (e) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── ORGANIZER: Submit results ────────────────────────────────
app.post(
  "/api/organizer/submit-results",
  authenticateToken,
  async (req, res) => {
    const { event_id, results } = req.body;
    if (!event_id || !Array.isArray(results))
      return res.status(400).json({
        success: false,
        message: "event_id and results array required",
      });
    try {
      const [orgCheck] = await pool.query(
        "SELECT id FROM event_organizers WHERE event_id=? AND user_id=?",
        [event_id, req.user.id],
      );
      if (!orgCheck.length)
        return res
          .status(403)
          .json({ success: false, message: "Not the organizer" });
      const [evRows] = await pool.query(
        "SELECT has_certificate FROM events WHERE id=?",
        [event_id],
      );
      const hasCert = evRows[0]?.has_certificate;
      for (const item of results) {
        const certType = hasCert ? item.certificate_type || null : null;
        // Set certificate_status to 'pending' when a cert type is assigned, null otherwise
        const certStatus = certType ? "pending" : null;
        await pool.query(
          "UPDATE registrations SET certificate_type=?, certificate_status=? WHERE id=? AND event_id=?",
          [certType, certStatus, item.registration_id, event_id],
        );
      }
      res.json({
        success: true,
        message: "Results saved! Certificates are pending admin approval.",
      });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ORGANIZER: Certificate list ──────────────────────────────
app.get(
  "/api/organizer/event/:eventId/certificates",
  authenticateToken,
  async (req, res) => {
    try {
      const [orgCheck] = await pool.query(
        "SELECT id FROM event_organizers WHERE event_id=? AND user_id=?",
        [req.params.eventId, req.user.id],
      );
      if (!orgCheck.length)
        return res
          .status(403)
          .json({ success: false, message: "Not the organizer" });
      const [rows] = await pool.query(
        `SELECT r.id, r.certificate_type, r.certificate_status, r.status,
              u.full_name AS studentName, u.roll_number AS studentRoll, u.email AS studentEmail,
              u.branch, u.department AS college,
              e.title AS eventName, e.event_date, e.venue
       FROM registrations r LEFT JOIN users u ON r.student_id = u.id LEFT JOIN events e ON r.event_id = e.id
       WHERE r.event_id = ? AND r.status = 'attended' AND r.certificate_type IS NOT NULL
       ORDER BY r.certificate_type DESC, u.full_name ASC`,
        [req.params.eventId],
      );
      res.json({ success: true, certificates: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ADMIN: Get organizer info per event ──────────────────────
app.get(
  "/api/admin/events/:id/organizer",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT u.full_name, u.email, u.phone, eo.created_at
       FROM event_organizers eo JOIN users u ON eo.user_id = u.id
       WHERE eo.event_id = ?`,
        [req.params.id],
      );
      res.json({ success: true, organizer: rows[0] || null });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ADMIN: All pending certificates ─────────────────────────
app.get(
  "/api/admin/certificates/pending",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.id, r.certificate_type, r.certificate_status, r.status AS attendance_status,
                u.full_name AS studentName, u.roll_number AS studentRoll,
                u.email AS studentEmail, u.branch, u.department AS college,
                e.title AS eventName, e.event_date, e.venue, e.id AS eventId
         FROM registrations r
         LEFT JOIN users u ON r.student_id = u.id
         LEFT JOIN events e ON r.event_id = e.id
         WHERE r.certificate_type IS NOT NULL
           AND r.certificate_status = 'pending'
           AND r.status = 'attended'
         ORDER BY e.event_date DESC, r.certificate_type ASC`,
      );
      res.json({ success: true, certificates: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ADMIN: All approved certificates ─────────────────────────
app.get(
  "/api/admin/certificates/approved",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.id, r.certificate_type, r.certificate_status, r.status AS attendance_status,
                u.full_name AS studentName, u.roll_number AS studentRoll,
                u.email AS studentEmail, u.branch, u.department AS college,
                e.title AS eventName, e.event_date, e.venue, e.id AS eventId
         FROM registrations r
         LEFT JOIN users u ON r.student_id = u.id
         LEFT JOIN events e ON r.event_id = e.id
         WHERE r.certificate_type IS NOT NULL
           AND r.certificate_status = 'approved'
         ORDER BY e.event_date DESC`,
      );
      res.json({ success: true, certificates: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ADMIN: Approve a certificate ─────────────────────────────
app.patch(
  "/api/admin/certificates/:id/approve",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [r] = await pool.query(
        "UPDATE registrations SET certificate_status='approved' WHERE id=? AND certificate_type IS NOT NULL",
        [req.params.id],
      );
      if (!r.affectedRows)
        return res
          .status(404)
          .json({ success: false, message: "Certificate not found" });
      res.json({ success: true, message: "Certificate approved!" });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ADMIN: Reject a certificate ──────────────────────────────
app.patch(
  "/api/admin/certificates/:id/reject",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [r] = await pool.query(
        "UPDATE registrations SET certificate_status=NULL, certificate_type=NULL WHERE id=?",
        [req.params.id],
      );
      if (!r.affectedRows)
        return res.status(404).json({ success: false, message: "Not found" });
      res.json({ success: true, message: "Certificate rejected." });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ── ADMIN: Approve ALL pending for an event ──────────────────
app.patch(
  "/api/admin/events/:eventId/certificates/approve-all",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [r] = await pool.query(
        "UPDATE registrations SET certificate_status='approved' WHERE event_id=? AND certificate_type IS NOT NULL AND certificate_status='pending'",
        [req.params.eventId],
      );
      res.json({
        success: true,
        message: `${r.affectedRows} certificate(s) approved!`,
        count: r.affectedRows,
      });
    } catch (e) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

app.use((_, res) =>
  res.status(404).json({ success: false, message: "Route not found" }),
);
app.use((err, _, res, __) => {
  console.error("Server Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { error: err.message }),
  });
});

// ── AUTO MIGRATION ──────────────────────────────────────────
async function runMigrations() {
  console.log("🔄 Running database migrations...");

  // STEP 1: Always MODIFY status column to VARCHAR(20).
  // This fixes ENUM type issues AND adds the column if missing.
  // Safe to run every startup — no-op if already correct type.
  try {
    await pool.query(
      `ALTER TABLE registrations
       MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'registered'`,
    );
    console.log("✅ Migration: status column is VARCHAR(20) ✓");
  } catch (e) {
    if (e.code === "ER_BAD_FIELD_ERROR") {
      // Column doesn't exist — ADD it instead of MODIFY
      try {
        await pool.query(
          `ALTER TABLE registrations
           ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'registered'`,
        );
        console.log("✅ Migration: status column ADDED");
      } catch (e2) {
        console.error("❌ Migration ADD failed:", e2.message);
      }
    } else if (e.code === "ER_NO_SUCH_TABLE") {
      // Create the full table
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS registrations (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            student_id   INT NOT NULL,
            event_id     INT NOT NULL,
            qr_token     VARCHAR(100) UNIQUE NOT NULL,
            status       VARCHAR(20) NOT NULL DEFAULT 'registered',
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log("✅ Migration: registrations table CREATED");
      } catch (e2) {
        console.error("❌ Migration CREATE failed:", e2.message);
      }
    } else {
      console.error("❌ Migration MODIFY failed:", e.message);
    }
  }

  // STEP 2a: Add has_certificate column to events
  try {
    await pool.query(
      `ALTER TABLE events ADD COLUMN has_certificate TINYINT(1) NOT NULL DEFAULT 0`,
    );
    console.log("✅ Migration: has_certificate column added");
  } catch (e) {
    if (!e.message.includes("Duplicate column"))
      console.log("ℹ️  has_certificate already exists");
  }

  // STEP 2b: Add certificate_type column to registrations
  try {
    await pool.query(
      `ALTER TABLE registrations ADD COLUMN certificate_type VARCHAR(20) DEFAULT NULL`,
    );
    console.log("✅ Migration: certificate_type column added");
  } catch (e) {
    if (!e.message.includes("Duplicate column"))
      console.log("ℹ️  certificate_type already exists");
  }

  // STEP 2b2: Add certificate_status column (pending / approved)
  try {
    await pool.query(
      `ALTER TABLE registrations ADD COLUMN certificate_status VARCHAR(20) DEFAULT NULL`,
    );
    console.log("✅ Migration: certificate_status column added");
  } catch (e) {
    if (!e.message.includes("Duplicate column"))
      console.log("ℹ️  certificate_status already exists");
  }

  // STEP 2c: Add event_role column to registrations (participant/volunteer/organizer)
  try {
    await pool.query(
      `ALTER TABLE registrations ADD COLUMN event_role VARCHAR(20) NOT NULL DEFAULT 'participant'`,
    );
    console.log("✅ Migration: event_role column added");
  } catch (e) {
    if (!e.message.includes("Duplicate column"))
      console.log("ℹ️  event_role already exists");
  }

  // STEP 2d: Create event_organizers table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS event_organizers (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        event_id     INT NOT NULL,
        user_id      INT NOT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_event_organizer (event_id)
      )
    `);
    console.log("✅ Migration: event_organizers table ready");
  } catch (e) {
    console.error("❌ event_organizers migration failed:", e.message);
  }

  // STEP 2: Clean up any bad status values left over from old ENUM
  try {
    await pool.query(
      `UPDATE registrations
       SET status = 'registered'
       WHERE status IS NULL
          OR status = ''
          OR status NOT IN ('registered', 'attended')`,
    );
    console.log("✅ Migration: status values cleaned up");
  } catch (e) {
    console.log("ℹ️  Migration cleanup skipped:", e.message);
  }

  // STEP 3: Create volunteer_interests table if it doesn't exist
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS volunteer_interests (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        volunteer_id INT NOT NULL,
        event_id     INT NOT NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'interested',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_vol_event (volunteer_id, event_id)
      )
    `);
    console.log("✅ Migration: volunteer_interests table ready ✓");
  } catch (e) {
    console.error("❌ Migration volunteer_interests failed:", e.message);
  }

  console.log("✅ Migrations complete — server ready!");
}

app.listen(PORT, async () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  await runMigrations();
});
// ====================== VOLUNTEER ROUTES ======================

// Get volunteer's assigned events
// ====================== VOLUNTEER ROUTES ======================

// Get volunteer's assigned events
app.get("/api/volunteer/events", authenticateToken, async (req, res) => {
  if (req.user.role !== "volunteer") {
    return res
      .status(403)
      .json({ success: false, message: "Volunteer access only" });
  }
  try {
    const [events] = await pool.query(
      `
      SELECT e.* FROM events e
      JOIN volunteer_events ve ON e.id = ve.event_id
      WHERE ve.volunteer_id = ?
      ORDER BY e.event_date ASC
    `,
      [req.user.id],
    );

    res.json({ success: true, events });
  } catch (e) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Verify QR Code - Works for Admin and Volunteer
app.post("/api/verify-qr", authenticateToken, async (req, res) => {
  const qr_token = (req.body.qr_token || req.body.token || "").trim();
  if (!qr_token) {
    return res
      .status(400)
      .json({ success: false, message: "QR token is required" });
  }

  if (
    req.user.role !== "admin" &&
    req.user.role !== "volunteer" &&
    req.user.role !== "student"
  ) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  try {
    const [rows] = await pool.query(
      `
      SELECT r.id, r.status, r.qr_token,
             u.full_name AS studentName,
             u.roll_number AS studentRoll,
             u.email AS studentEmail,
             u.branch,
             u.department AS college,
             e.title AS eventName,
             e.event_date,
             e.venue
      FROM registrations r
      LEFT JOIN users u ON r.student_id = u.id
      LEFT JOIN events e ON r.event_id = e.id
      WHERE r.qr_token = ?
    `,
      [qr_token],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "QR code not found" });
    }

    const reg = rows[0];

    if (reg.status === "attended") {
      return res.json({
        success: true,
        alreadyAttended: true,
        registration: reg,
      });
    }

    await pool.query(
      "UPDATE registrations SET status = 'attended' WHERE id = ?",
      [reg.id],
    );
    reg.status = "attended";

    res.json({ success: true, alreadyAttended: false, registration: reg });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
