const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');

// Verify Shopify webhook signature
function verifyWebhook(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const body = req.rawBody;
  if (!hmac || !body) return false;

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hash));
}

// Middleware to capture raw body for webhook verification
router.use(express.raw({ type: 'application/json' }));

router.use((req, res, next) => {
  // Convert raw body to string
  req.rawBody = req.body ? req.body.toString() : '';
  if (!req.rawBody) {
    req.body = {};
  } else {
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (err) {
      console.warn('Invalid JSON body received in webhook:', err.message);
      req.body = {};
    }
  }
  next();
});

// =============================================
// ORDER UPDATED WEBHOOK
// =============================================
router.post('/order-updated', (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send('Unauthorized');

  const order = req.body;
  res.sendStatus(200); // Respond quickly

  // Log webhook
  db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
    .run('orders/updated', order.id?.toString(), JSON.stringify(order));

  // Update cache
  if (order.id) {
    const orderNum = order.name?.replace('#', '');
    if (orderNum) {
      const formatted = require('../services/shopify').formatOrder(order);
      db.prepare(`
        INSERT INTO order_cache (order_number, shopify_data, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(order_number) DO UPDATE SET shopify_data = excluded.shopify_data, updated_at = CURRENT_TIMESTAMP
      `).run(orderNum, JSON.stringify(formatted));
    }
  }
});

// =============================================
// ORDER FULFILLED WEBHOOK
// =============================================
router.post('/order-fulfilled', (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send('Unauthorized');

  const order = req.body;
  res.sendStatus(200);

  db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
    .run('orders/fulfilled', order.id?.toString(), JSON.stringify(order));

  const orderNum = order.name?.replace('#', '');
  if (orderNum) {
    // Update to shipped stage
    db.prepare(`
      UPDATE order_cache SET production_stage = 7, updated_at = CURRENT_TIMESTAMP
      WHERE order_number = ?
    `).run(orderNum);

    // Add activity
    db.prepare(
      `INSERT INTO activity_feed (event_type, message, icon, order_ref) VALUES ('shipped', ?, 'truck', ?)`
    ).run(`Order ${order.name} has been shipped — tracking now active`, order.name);

    // Update stats
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`UPDATE production_stats SET orders_shipped = orders_shipped + 1 WHERE stat_date = ?`).run(today);

    // Auto-close any "not_shipped" tickets for this order
    db.prepare(`
      UPDATE tickets SET status = 'auto_closed', resolution = 'Order has been shipped', closed_at = CURRENT_TIMESTAMP, auto_closed = 1
      WHERE order_number = ? AND issue_type = 'not_shipped' AND status = 'open'
    `).run(orderNum);
  }
});

// =============================================
// ORDER CREATED WEBHOOK
// =============================================
router.post('/order-created', (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send('Unauthorized');

  const order = req.body;
  res.sendStatus(200);

  db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
    .run('orders/created', order.id?.toString(), JSON.stringify(order));

  // Update queue count
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE production_stats SET orders_in_queue = orders_in_queue + 1 WHERE stat_date = ?`).run(today);
});

module.exports = router;
