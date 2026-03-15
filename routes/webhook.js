const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const shopifyService = require('../services/shopify');

// Middleware to capture raw body ONLY for webhook routes
router.use('/order-created', express.raw({ type: 'application/json' }));
router.use('/order-updated', express.raw({ type: 'application/json' }));
router.use('/order-fulfilled', express.raw({ type: 'application/json' }));

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

// =============================================
// Generic webhook handler
// =============================================
function handleWebhook(req, res, topic, callback) {
  req.rawBody = req.body; // raw body from express.raw
  try {
    req.body = JSON.parse(req.rawBody);
  } catch {
    req.body = {}; // fallback if empty
  }

  if (!verifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200); // respond fast

  callback(req.body); // call specific logic
}

// =============================================
// ORDER UPDATED
// =============================================
router.post('/order-updated', (req, res) => {
  handleWebhook(req, res, 'orders/updated', (order) => {
    db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
      .run('orders/updated', order.id?.toString(), JSON.stringify(order));

    if (order.id) {
      const orderNum = order.name?.replace('#', '');
      if (orderNum) {
        const formatted = shopifyService.formatOrder(order);
        db.prepare(`
          INSERT INTO order_cache (order_number, shopify_data, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(order_number) DO UPDATE SET shopify_data = excluded.shopify_data, updated_at = CURRENT_TIMESTAMP
        `).run(orderNum, JSON.stringify(formatted));
      }
    }
  });
});

// =============================================
// ORDER FULFILLED
// =============================================
router.post('/order-fulfilled', (req, res) => {
  handleWebhook(req, res, 'orders/fulfilled', (order) => {
    db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
      .run('orders/fulfilled', order.id?.toString(), JSON.stringify(order));

    const orderNum = order.name?.replace('#', '');
    if (orderNum) {
      db.prepare(`
        UPDATE order_cache SET production_stage = 7, updated_at = CURRENT_TIMESTAMP
        WHERE order_number = ?
      `).run(orderNum);

      db.prepare(
        `INSERT INTO activity_feed (event_type, message, icon, order_ref) VALUES ('shipped', ?, 'truck', ?)`
      ).run(`Order ${order.name} has been shipped — tracking now active`, order.name);

      const today = new Date().toISOString().split('T')[0];
      db.prepare(`UPDATE production_stats SET orders_shipped = orders_shipped + 1 WHERE stat_date = ?`).run(today);

      db.prepare(`
        UPDATE tickets SET status = 'auto_closed', resolution = 'Order has been shipped', closed_at = CURRENT_TIMESTAMP, auto_closed = 1
        WHERE order_number = ? AND issue_type = 'not_shipped' AND status = 'open'
      `).run(orderNum);
    }
  });
});

// =============================================
// ORDER CREATED
// =============================================
router.post('/order-created', (req, res) => {
  handleWebhook(req, res, 'orders/created', (order) => {
    db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
      .run('orders/created', order.id?.toString(), JSON.stringify(order));

    const today = new Date().toISOString().split('T')[0];
    db.prepare(`UPDATE production_stats SET orders_in_queue = orders_in_queue + 1 WHERE stat_date = ?`).run(today);
  });
});

module.exports = router;
