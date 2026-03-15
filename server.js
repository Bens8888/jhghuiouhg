require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// SECURITY & MIDDLEWARE
// =============================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'maps.googleapis.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', '*.googleapis.com', '*.gstatic.com'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", '*.google.com'],
      },
    },
  })
);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  })
);

// =============================================
// STATIC FILES
// =============================================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =============================================
// WEBHOOKS (must come BEFORE express.json())
// =============================================
app.use('/webhooks', require('./routes/webhook')); // webhook.js uses express.raw internally

// =============================================
// BODY PARSING (API routes only)
// =============================================
app.use('/api', express.json({ limit: '10mb' }));
app.use('/api', express.urlencoded({ extended: true }));

// =============================================
// RATE LIMITERS
// =============================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests. Please try again later.' },
});

const trackLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: { error: 'Too many tracking requests. Please wait a moment.' },
});

// =============================================
// ROUTES
// =============================================
app.use('/api', apiLimiter);
app.use('/api/track', trackLimiter);
app.use('/api', require('./routes/api'));
app.use('/admin/api', require('./routes/admin'));

// SPA fallback routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public/tracking.html')));
app.get('/help', (req, res) => res.sendFile(path.join(__dirname, 'public/help.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));

// =============================================
// SCHEDULED JOBS
// =============================================

// Daily production stats reset at midnight
cron.schedule('0 0 * * *', () => {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = db.prepare('SELECT * FROM production_stats ORDER BY stat_date DESC LIMIT 1').get();

  const baseProduced = yesterday?.orders_produced || 173;
  const variation = Math.floor((Math.random() - 0.5) * 40); // ±20
  const newProduced = Math.max(120, baseProduced + variation);

  db.prepare(`
    INSERT OR IGNORE INTO production_stats (stat_date, orders_produced, orders_shipped, orders_in_queue, batch_number, confidence_score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    today,
    newProduced,
    Math.floor(Math.random() * 80) + 280,
    Math.floor(Math.random() * 200) + 750,
    (yesterday?.batch_number || 24) + (Math.random() > 0.7 ? 1 : 0),
    Math.floor(Math.random() * 15) + 80
  );

  console.log(`[CRON] Daily stats reset for ${today}`);
});

// Hourly activity feed updates (realistic simulation)
cron.schedule('0 * * * *', () => {
  const hour = new Date().getHours();
  if (hour < 7 || hour > 22) return;

  const activities = [
    ['production', `Batch production continues — ${Math.floor(Math.random() * 20) + 10} items completed this hour`, 'factory'],
    ['shipped', `${Math.floor(Math.random() * 8) + 3} orders dispatched and on their way`, 'truck'],
    ['update', 'Quality control checks completed — all items approved', 'check'],
    ['production', `New production batch prepared — ${Math.floor(Math.random() * 30) + 20} orders included`, 'layers'],
    ['shipped', 'Express orders picked up by courier', 'rocket'],
    ['update', 'All packaging materials restocked — no delays expected', 'package'],
  ];

  const pick = activities[Math.floor(Math.random() * activities.length)];
  db.prepare('INSERT INTO activity_feed (event_type, message, icon) VALUES (?, ?, ?)').run(...pick);

  // Keep feed clean — max 100 entries
  db.prepare('DELETE FROM activity_feed WHERE id NOT IN (SELECT id FROM activity_feed ORDER BY created_at DESC LIMIT 100)').run();

  const today = new Date().toISOString().split('T')[0];
  const increment = Math.floor(Math.random() * 15) + 5;
  db.prepare('UPDATE production_stats SET orders_produced = orders_produced + ? WHERE stat_date = ?').run(increment, today);
});

// =============================================
// ERROR HANDLER
// =============================================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║   Plug & Play Tracker — Running        ║
  ║   http://localhost:${PORT}               ║
  ║   Admin: http://localhost:${PORT}/admin  ║
  ╚════════════════════════════════════════╝
  `);
});

module.exports = app;
