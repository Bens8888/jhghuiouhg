const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const shopify = require('../services/shopify');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// File upload config
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  },
});

// =============================================
// TRACK ORDER
// =============================================
router.post('/track', async (req, res) => {
  const { orderNumber, emailOrPhone } = req.body;

  if (!orderNumber || !emailOrPhone) {
    return res.status(400).json({ error: 'Order number and email/phone required' });
  }

  // Log view
  const ip = req.ip || req.connection.remoteAddress;
  db.prepare(
    'INSERT INTO order_views (order_number, customer_email, ip_address, user_agent) VALUES (?, ?, ?, ?)'
  ).run(orderNumber.trim(), emailOrPhone.trim().toLowerCase(), ip, req.headers['user-agent'] || '');

  // Check cache first (15 min cache)
  const cached = db.prepare(
    `SELECT * FROM order_cache WHERE order_number = ? AND datetime(updated_at, '+15 minutes') > datetime('now')`
  ).get(orderNumber.trim().replace('#', ''));

  // Safe JSON parse helper
  function safeParse(jsonString) {
    if (!jsonString || jsonString.trim() === '') return null;
    try {
      return JSON.parse(jsonString);
    } catch {
      return null;
    }
  }

  let order;
  let fromCache = false;

  if (cached) {
    order = safeParse(cached.shopify_data);
    if (order) fromCache = true;
  }

  if (!order) {
    // Fetch from Shopify or demo fallback
    try {
      order = await shopify.getOrderByNumber(orderNumber, emailOrPhone);
    } catch (err) {
      console.error('Error fetching order from Shopify:', err.message);
      if (process.env.DEMO_MODE === 'true') {
        order = generateDemoOrder(orderNumber, emailOrPhone);
      } else {
        return res.status(404).json({
          error: 'Order not found. Please check your order number and email/phone.',
          hint: 'Your order number can be found in your confirmation email (e.g. #1001)',
        });
      }
    }
  }

  // Get admin overrides from cache
  const orderCacheRow = db.prepare('SELECT * FROM order_cache WHERE order_number = ?')
    .get(orderNumber.trim().replace('#', ''));

  // Update or insert cache if fresh fetch
  if (!fromCache && order.id) {
    try {
      db.prepare(`
        INSERT INTO order_cache (order_number, shopify_data, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(order_number) DO UPDATE SET shopify_data = excluded.shopify_data, updated_at = CURRENT_TIMESTAMP
      `).run(orderNumber.trim().replace('#', ''), JSON.stringify(order));
    } catch (err) {
      console.error('Error updating order cache:', err.message);
    }
  }

  // Get production stats
  const today = new Date().toISOString().split('T')[0];
  const stats = db.prepare('SELECT * FROM production_stats WHERE stat_date = ?').get(today);

  // Calculate stage
  const adminStageOverride = orderCacheRow?.production_stage || null;
  const stage = shopify.calculateProductionStage(order, adminStageOverride > 0 ? adminStageOverride : null);
  const stageDetails = shopify.getStageDetails();

  // Global delay & estimates
  const globalDelay = stats?.global_delay_days || 0;
  const estimates = shopify.calculateEstimates(order, globalDelay);

  // Confidence score with daily variation
  const baseConfidence = stats?.confidence_score || 87;
  const hourOfDay = new Date().getHours();
  const confidenceVariation = Math.sin(hourOfDay / 24 * Math.PI) * 5;
  const confidenceScore = Math.min(99, Math.max(60, Math.round(baseConfidence + confidenceVariation)));

  // Batch number
  const batchNumber = orderCacheRow?.batch_number || `#${stats?.batch_number || 24}`;

  // Activity feed
  const activity = db.prepare(
    'SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 8'
  ).all();

  // Tickets for this order
  const tickets = db.prepare(
    'SELECT id, issue_type, status, reference_number, created_at FROM tickets WHERE order_number = ? ORDER BY created_at DESC'
  ).all(orderNumber.trim().replace('#', ''));

  // Angry customer detection
  const viewCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM order_views WHERE order_number = ? AND viewed_at > datetime("now", "-24 hours")'
  ).get(orderNumber.trim().replace('#', ''))?.cnt || 0;

  res.json({
    success: true,
    order,
    stage,
    stageDetails,
    estimates,
    stats: {
      ordersProducedToday: getDailyCount(stats),
      ordersShippedThisWeek: stats?.orders_shipped || 312,
      ordersInQueue: stats?.orders_in_queue || 847,
      batchNumber,
      confidenceScore,
      globalDelayDays: globalDelay,
    },
    activity: activity.map(a => ({
      message: a.message,
      icon: a.icon,
      type: a.event_type,
      time: a.created_at,
    })),
    tickets,
    meta: {
      viewCount,
      priority: orderCacheRow?.priority || 0,
      forceShipped: orderCacheRow?.force_shipped || 0,
    },
  });
});

// Additional functionality (Create Ticket, Get Ticket Status, etc.) remains unchanged

module.exports = router;
