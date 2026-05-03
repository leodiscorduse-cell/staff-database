const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, '..', 'staff.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { staff: {}, sync_log: [] };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── GET all staff ─────────────────────────────────────────────────────────────
app.get('/api/staff', (req, res) => {
  const db = loadDB();
  let staff = Object.values(db.staff);
  const { search, loa, ztp } = req.query;

  if (search) {
    const s = search.toLowerCase();
    staff = staff.filter(m =>
      m.username.toLowerCase().includes(s) ||
      (m.nickname || '').toLowerCase().includes(s)
    );
  }
  if (loa === 'true') staff = staff.filter(m => m.on_loa);
  if (ztp === 'true') staff = staff.filter(m => m.on_ztp);

  staff.sort((a, b) => a.username.localeCompare(b.username));
  res.json({ staff, total: staff.length });
});

// ── GET single staff member ───────────────────────────────────────────────────
app.get('/api/staff/:userId', (req, res) => {
  const db = loadDB();
  const member = db.staff[req.params.userId];
  if (!member) return res.status(404).json({ error: 'Not found' });
  res.json(member);
});

// ── PATCH notes ───────────────────────────────────────────────────────────────
app.patch('/api/staff/:userId/notes', (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== 'string') return res.status(400).json({ error: 'notes must be a string' });
  const db = loadDB();
  if (!db.staff[req.params.userId]) return res.status(404).json({ error: 'Not found' });
  db.staff[req.params.userId].notes = notes;
  db.staff[req.params.userId].updated_at = new Date().toISOString();
  saveDB(db);
  res.json({ success: true });
});

// ── GET stats ─────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const staff = Object.values(db.staff);
  const total = staff.length;
  const onLoa = staff.filter(m => m.on_loa).length;
  const onZtp = staff.filter(m => m.on_ztp).length;
  const lastSync = db.sync_log[0]?.synced_at || null;
  const roleCount = {};
  staff.forEach(m => { roleCount[m.highest_role] = (roleCount[m.highest_role] || 0) + 1; });
  const byRole = Object.entries(roleCount).map(([r, c]) => ({ highest_role: r, count: c }));
  res.json({ total, onLoa, onZtp, lastSync, byRole });
});

// ── GET logs ──────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const db = loadDB();
  res.json({ logs: db.sync_log });
});

app.listen(PORT, () => {
  console.log(`[API] Dashboard running at http://localhost:${PORT}`);
});
