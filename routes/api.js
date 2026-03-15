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
    order = await shopify.getOrderByNumber(orderNumber, emailOrPhone);
    if (!order) {
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
    db.prepare(`
      INSERT INTO order_cache (order_number, shopify_data, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(order_number) DO UPDATE SET shopify_data = excluded.shopify_data, updated_at = CURRENT_TIMESTAMP
    `).run(orderNumber.trim().replace('#', ''), JSON.stringify(order));
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
// =============================================
// CREATE TICKET
// =============================================
router.post('/ticket', upload.single('proof'), async (req, res) => {
  const {
    orderNumber, customerName, customerEmail, customerPhone,
    tiktokUsername, issueType, description,
  } = req.body;

  if (!orderNumber || !issueType) {
    return res.status(400).json({ error: 'Order number and issue type required' });
  }

  const ticketId = uuidv4();
  const refNumber = `PNP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

  // Check for duplicate open tickets
  const existing = db.prepare(
    `SELECT id FROM tickets WHERE order_number = ? AND issue_type = ? AND status = 'open' AND created_at > datetime('now', '-24 hours')`
  ).get(orderNumber.trim().replace('#', ''), issueType);

  if (existing) {
    return res.status(429).json({
      error: 'A ticket for this issue already exists.',
      ticketId: existing.id,
      message: 'Please allow 24 hours for our team to respond.',
    });
  }

  const proofPath = req.file ? req.file.filename : null;

  // Determine priority
  let priority = 'medium';
  if (issueType === 'damaged') priority = 'high';
  if (issueType === 'refund') priority = 'high';
  if (issueType === 'not_arrived') priority = 'medium';

  db.prepare(`
    INSERT INTO tickets (id, order_number, customer_name, customer_email, customer_phone, tiktok_username, issue_type, description, priority, proof_file_path, reference_number, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `).run(
    ticketId,
    orderNumber.trim().replace('#', ''),
    customerName || '',
    customerEmail || '',
    customerPhone || '',
    tiktokUsername || '',
    issueType,
    description || '',
    priority,
    proofPath,
    refNumber
  );

  // Add activity
  db.prepare(
    `INSERT INTO activity_feed (event_type, message, icon, order_ref) VALUES ('support', 'Support ticket opened for order ${orderNumber}', 'headphones', ?)`
  ).run(orderNumber.trim());

  res.json({
    success: true,
    ticketId,
    referenceNumber: refNumber,
    priority,
    message: 'Your ticket has been created. Our team will review it within 24 hours.',
    showWhatsApp: issueType === 'damaged',
    whatsappNumber: issueType === 'damaged' ? process.env.WHATSAPP_NUMBER : null,
    whatsappMessage: issueType === 'damaged'
      ? `Hi, I have a damaged item. My ticket reference is ${refNumber}. Order: #${orderNumber}`
      : null,
  });
});

// =============================================
// GET TICKET STATUS
// =============================================
router.get('/ticket/:id', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? OR reference_number = ?')
    .get(req.params.id, req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  res.json({
    success: true,
    ticket: {
      id: ticket.id,
      referenceNumber: ticket.reference_number,
      issueType: ticket.issue_type,
      status: ticket.status,
      priority: ticket.priority,
      resolution: ticket.resolution,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      closedAt: ticket.closed_at,
    },
  });
});

// =============================================
// PRODUCTION STATS (public)
// =============================================
router.get('/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const stats = db.prepare('SELECT * FROM production_stats WHERE stat_date = ?').get(today);

  res.json({
    ordersProducedToday: getDailyCount(stats),
    ordersShippedThisWeek: stats?.orders_shipped || 312,
    ordersInQueue: stats?.orders_in_queue || 847,
    batchNumber: `#${stats?.batch_number || 24}`,
    confidenceScore: stats?.confidence_score || 87,
    timestamp: new Date().toISOString(),
  });
});

// =============================================
// FAQ
// =============================================
router.get('/faq', (req, res) => {
  res.json({
    faqs: [
      {
        q: 'Why is my order still being manufactured after I ordered days ago?',
        a: 'Plug & Play items are made-to-order. Each product goes through our 7-step production process — from batch preparation to quality control. This typically takes 7–14 days. Your order is progressing normally and hasn\'t been forgotten!',
        tags: ['delay', 'manufacturing', 'slow'],
      },
      {
        q: 'When will my order ship?',
        a: 'Once your order completes manufacturing and packing (Steps 4–5), it enters our shipping queue. You\'ll receive an email with a tracking number within 48 hours of dispatch. Check your tracking page for a live estimated ship date.',
        tags: ['shipping', 'dispatch', 'when'],
      },
      {
        q: 'My tracking number isn\'t updating',
        a: 'It can take 24–48 hours for tracking to activate after the carrier scans your parcel. If it\'s been over 72 hours with no update, open a support ticket and we\'ll investigate immediately.',
        tags: ['tracking', 'not updating', 'stuck'],
      },
      {
        q: 'How do I return or get a refund?',
        a: 'Refunds are available within 48 hours of order placement. Returns are accepted within 14 days of delivery. The customer is responsible for return shipping costs. To start a return, use the Help section on your tracking page.',
        tags: ['return', 'refund', 'cancel'],
      },
      {
        q: 'My item arrived damaged — what do I do?',
        a: 'We\'re so sorry! Please open a support ticket selecting "Item Arrived Damaged". You\'ll receive a private WhatsApp number to send photo or video proof along with your ticket reference number. We\'ll arrange a replacement or refund within 48 hours of verification.',
        tags: ['damaged', 'broken', 'wrong'],
      },
    ],
  });
});

// =============================================
// HELPERS
// =============================================
function getDailyCount(stats) {
  if (!stats) return 173;
  const hour = new Date().getHours();
  // Realistic spike pattern: slow morning, peaks mid-day and afternoon
  const spikes = [12, 14, 15, 16, 18, 21, 22, 24, 26, 28, 29, 28, 30, 32, 34, 33, 31, 29, 27, 25, 23, 20, 18, 15];
  const baseCount = stats.orders_produced || 173;
  const hourlyAdd = spikes[hour] || 20;
  return baseCount + hourlyAdd;
}

function generateDemoOrder(orderNumber, emailOrPhone) {
  const created = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  return {
    id: 'demo-001',
    orderNumber: orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`,
    email: emailOrPhone.includes('@') ? emailOrPhone : 'demo@example.com',
    phone: emailOrPhone.includes('@') ? null : emailOrPhone,
    createdAt: created.toISOString(),
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    shippingAddress: {
      name: 'Demo Customer',
      address1: '123 Demo Street',
      city: 'Sydney',
      province: 'NSW',
      country: 'Australia',
      zip: '2000',
    },
    shippingMethod: 'Standard Shipping (AusPost)',
    trackingNumber: null,
    shippedAt: null,
    lineItems: [
      { id: 1, title: 'Custom Product', variant: 'Default', quantity: 1, price: '49.99' },
    ],
    orderAge: 5 * 24, // 5 days in hours
    note: '',
  };
}

module.exports = router;
