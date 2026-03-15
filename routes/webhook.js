const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const shopifyService = require('../services/shopify');

// Use raw body ONLY for these routes
router.use(['/order-created', '/order-updated', '/order-fulfilled'], express.raw({ type: 'application/json' }));

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

// Helper function to handle the webhook and call a specific callback for processing the order
function handleWebhook(req, res, callback) {
  req.rawBody = req.body; // raw Buffer from express.raw
  let parsedBody = {};
  if (req.rawBody && req.rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(req.rawBody.toString());
    } catch (err) {
      console.warn('Invalid JSON in webhook:', err.message);
      parsedBody = {};
    }
  }
  req.body = parsedBody;

  // Verify webhook HMAC
  if (!verifyWebhook(req)) return res.status(401).send('Unauthorized');

  res.sendStatus(200); // Respond quickly

  // Process the order data
  callback(req.body);
}

// Webhook route for order creation
router.post('/order-created', (req, res) => handleWebhook(req, res, (order) => {
  // Log the webhook event
  db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
    .run('orders/created', order.id?.toString(), JSON.stringify(order));

  const today = new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE production_stats SET orders_in_queue = orders_in_queue + 1 WHERE stat_date = ?`).run(today);
}));

// Webhook route for order update
router.post('/order-updated', (req, res) => handleWebhook(req, res, (order) => {
  // Log the webhook event
  db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
    .run('orders/updated', order.id?.toString(), JSON.stringify(order));

  const orderNum = order.name?.replace('#', '');
  if (order.id && orderNum) {
    const formatted = shopifyService.formatOrder(order);
    db.prepare(`
      INSERT INTO order_cache (order_number, shopify_data, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(order_number) DO UPDATE SET shopify_data = excluded.shopify_data, updated_at = CURRENT_TIMESTAMP
    `).run(orderNum, JSON.stringify(formatted));
  }
}));

// Webhook route for order fulfillment
router.post('/order-fulfilled', (req, res) => handleWebhook(req, res, (order) => {
  // Log the webhook event
  db.prepare('INSERT INTO webhooks_log (topic, order_id, payload) VALUES (?, ?, ?)')
    .run('orders/fulfilled', order.id?.toString(), JSON.stringify(order));

  const orderNum = order.name?.replace('#', '');
  if (orderNum) {
    db.prepare(`UPDATE order_cache SET production_stage = 7, updated_at = CURRENT_TIMESTAMP WHERE order_number = ?`)
      .run(orderNum);

    db.prepare(`INSERT INTO activity_feed (event_type, message, icon, order_ref) VALUES ('shipped', ?, 'truck', ?)`)
      .run(`Order ${order.name} has been shipped — tracking now active`, order.name);

    const today = new Date().toISOString().split('T')[0];
    db.prepare(`UPDATE production_stats SET orders_shipped = orders_shipped + 1 WHERE stat_date = ?`).run(today);
  }
}));

module.exports = router;
