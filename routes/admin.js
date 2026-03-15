const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const shopify = require('../services/shopify');

// =============================================
// ADMIN LOGIN
// =============================================
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Check env credentials first (simple setup)
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
    return res.json({ success: true, token });
  }

  // Check DB users
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token });
});

// All routes below require auth
router.use(adminAuth);

// =============================================
// DASHBOARD STATS
// =============================================
router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const stats = db.prepare('SELECT * FROM production_stats WHERE stat_date = ?').get(today);
  const openTickets = db.prepare(`SELECT COUNT(*) as cnt FROM tickets WHERE status = 'open'`).get();
  const highPriority = db.prepare(`SELECT COUNT(*) as cnt FROM tickets WHERE status = 'open' AND priority = 'high'`).get();
  const todayViews = db.prepare(`SELECT COUNT(*) as cnt FROM order_views WHERE viewed_at > datetime('now', '-24 hours')`).get();

  // Angry customers: viewed 5+ times in 24h
  const angryCustomers = db.prepare(`
    SELECT order_number, COUNT(*) as views
    FROM order_views
    WHERE viewed_at > datetime('now', '-24 hours')
    GROUP BY order_number
    HAVING COUNT(*) >= 5
    ORDER BY views DESC
    LIMIT 10
  `).all();

  // Recent tickets
  const recentTickets = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM order_views WHERE order_number = t.order_number) as total_views,
      (SELECT COUNT(*) FROM tickets WHERE order_number = t.order_number) as ticket_count
    FROM tickets t
    ORDER BY t.created_at DESC
    LIMIT 15
  `).all();

  res.json({
    stats: {
      ordersProducedToday: stats?.orders_produced || 173,
      ordersShippedThisWeek: stats?.orders_shipped || 312,
      ordersInQueue: stats?.orders_in_queue || 847,
      batchNumber: stats?.batch_number || 24,
      confidenceScore: stats?.confidence_score || 87,
      globalDelayDays: stats?.global_delay_days || 0,
    },
    tickets: {
      open: openTickets.cnt,
      highPriority: highPriority.cnt,
    },
    todayViews: todayViews.cnt,
    angryCustomers,
    recentTickets,
  });
});

// =============================================
// TICKET MANAGEMENT
// =============================================
router.get('/tickets', (req, res) => {
  const { status, priority, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT t.*,
      (SELECT COUNT(*) FROM order_views WHERE order_number = t.order_number) as total_views,
      (SELECT COUNT(*) FROM tickets WHERE order_number = t.order_number) as ticket_count
    FROM tickets t
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ` AND t.status = ?`; params.push(status); }
  if (priority) { query += ` AND t.priority = ?`; params.push(priority); }
  if (search) {
    query += ` AND (t.order_number LIKE ? OR t.customer_email LIKE ? OR t.customer_phone LIKE ? OR t.reference_number LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM tickets t WHERE 1=1${status ? ' AND t.status = ?' : ''}${priority ? ' AND t.priority = ?' : ''}`)
    .get(...params.slice(0, (status ? 1 : 0) + (priority ? 1 : 0))).cnt;

  query += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const tickets = db.prepare(query).all(...params);
  res.json({ tickets, total, page: parseInt(page), limit: parseInt(limit) });
});

router.get('/tickets/:id', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const views = db.prepare('SELECT * FROM order_views WHERE order_number = ? ORDER BY viewed_at DESC LIMIT 20').all(ticket.order_number);
  const allTickets = db.prepare('SELECT * FROM tickets WHERE order_number = ? ORDER BY created_at DESC').all(ticket.order_number);
  const orderCache = db.prepare('SELECT * FROM order_cache WHERE order_number = ?').get(ticket.order_number);

  res.json({ ticket, views, allTickets, orderCache });
});

router.patch('/tickets/:id', (req, res) => {
  const { status, priority, adminNotes, resolution } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  if (adminNotes !== undefined) updates.admin_notes = adminNotes;
  if (resolution) updates.resolution = resolution;

  if (status === 'closed' || status === 'resolved') {
    updates.closed_at = new Date().toISOString();
  }

  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(updates), req.params.id];
  db.prepare(`UPDATE tickets SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);

  res.json({ success: true });
});

// Close ticket instantly (investigation resolved)
router.post('/tickets/:id/close', (req, res) => {
  const { resolution } = req.body;
  db.prepare(`
    UPDATE tickets SET status = 'closed', resolution = ?, closed_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP, auto_closed = 1 WHERE id = ?
  `).run(resolution || 'Resolved by admin', req.params.id);
  res.json({ success: true });
});

// =============================================
// ORDER MANAGEMENT
// =============================================
router.get('/orders/:orderNumber', async (req, res) => {
  const { orderNumber } = req.params;

  const cached = db.prepare('SELECT * FROM order_cache WHERE order_number = ?').get(orderNumber);
  const tickets = db.prepare('SELECT * FROM tickets WHERE order_number = ? ORDER BY created_at DESC').all(orderNumber);
  const views = db.prepare('SELECT COUNT(*) as cnt FROM order_views WHERE order_number = ?').get(orderNumber);

  res.json({
    orderCache: cached,
    shopifyData: cached ? JSON.parse(cached.shopify_data) : null,
    tickets,
    totalViews: views.cnt,
  });
});

router.patch('/orders/:orderNumber', (req, res) => {
  const { productionStage, batchNumber, priority, forceShipped, adminNotes } = req.body;

  const existing = db.prepare('SELECT * FROM order_cache WHERE order_number = ?').get(req.params.orderNumber);

  if (existing) {
    const updates = {};
    if (productionStage !== undefined) updates.production_stage = productionStage;
    if (batchNumber !== undefined) updates.batch_number = batchNumber;
    if (priority !== undefined) updates.priority = priority;
    if (forceShipped !== undefined) updates.force_shipped = forceShipped ? 1 : 0;
    if (adminNotes !== undefined) updates.admin_notes = adminNotes;

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE order_cache SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE order_number = ?`)
      .run(...Object.values(updates), req.params.orderNumber);
  } else {
    db.prepare(`
      INSERT INTO order_cache (order_number, shopify_data, production_stage, batch_number, priority, force_shipped, admin_notes)
      VALUES (?, '{}', ?, ?, ?, ?, ?)
    `).run(
      req.params.orderNumber,
      productionStage || 0,
      batchNumber || '',
      priority || 0,
      forceShipped ? 1 : 0,
      adminNotes || ''
    );
  }

  res.json({ success: true });
});

// =============================================
// PRODUCTION CONTROLS
// =============================================
router.get('/production', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const stats = db.prepare('SELECT * FROM production_stats WHERE stat_date = ?').get(today);
  const history = db.prepare('SELECT * FROM production_stats ORDER BY stat_date DESC LIMIT 14').all();
  res.json({ today: stats, history });
});

router.patch('/production', (req, res) => {
  const { ordersProduced, ordersShipped, ordersInQueue, batchNumber, globalDelayDays, confidenceScore } = req.body;
  const today = new Date().toISOString().split('T')[0];

  const updates = {};
  if (ordersProduced !== undefined) updates.orders_produced = ordersProduced;
  if (ordersShipped !== undefined) updates.orders_shipped = ordersShipped;
  if (ordersInQueue !== undefined) updates.orders_in_queue = ordersInQueue;
  if (batchNumber !== undefined) updates.batch_number = batchNumber;
  if (globalDelayDays !== undefined) updates.global_delay_days = globalDelayDays;
  if (confidenceScore !== undefined) updates.confidence_score = confidenceScore;

  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE production_stats SET ${fields} WHERE stat_date = ?`)
    .run(...Object.values(updates), today);

  res.json({ success: true });
});

// =============================================
// ACTIVITY FEED MANAGEMENT
// =============================================
router.post('/activity', (req, res) => {
  const { message, eventType, icon } = req.body;
  db.prepare('INSERT INTO activity_feed (event_type, message, icon) VALUES (?, ?, ?)')
    .run(eventType || 'update', message, icon || 'zap');
  res.json({ success: true });
});

router.get('/activity', (req, res) => {
  const feed = db.prepare('SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 50').all();
  res.json({ feed });
});

// =============================================
// CUSTOMER BEHAVIOR
// =============================================
router.get('/behavior', (req, res) => {
  const topViewers = db.prepare(`
    SELECT order_number, COUNT(*) as views, MAX(viewed_at) as last_view
    FROM order_views
    WHERE viewed_at > datetime('now', '-7 days')
    GROUP BY order_number
    ORDER BY views DESC
    LIMIT 20
  `).all();

  const repeatOpeners = db.prepare(`
    SELECT order_number, COUNT(*) as ticket_count, customer_email, customer_name
    FROM tickets
    GROUP BY order_number
    HAVING COUNT(*) >= 2
    ORDER BY ticket_count DESC
    LIMIT 10
  `).all();

  res.json({ topViewers, repeatOpeners });
});

module.exports = router;
