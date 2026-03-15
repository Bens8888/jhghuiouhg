const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/plugnplay.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// =============================================
// SCHEMA INITIALIZATION
// =============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    tiktok_username TEXT,
    issue_type TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'medium',
    admin_notes TEXT,
    proof_file_path TEXT,
    proof_submitted_via TEXT,
    reference_number TEXT,
    resolution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    auto_closed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS order_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL,
    customer_email TEXT,
    ip_address TEXT,
    user_agent TEXT,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS production_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_date TEXT NOT NULL UNIQUE,
    orders_produced INTEGER DEFAULT 0,
    orders_shipped INTEGER DEFAULT 0,
    orders_in_queue INTEGER DEFAULT 0,
    batch_number INTEGER DEFAULT 1,
    global_delay_days INTEGER DEFAULT 0,
    confidence_score INTEGER DEFAULT 87,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    icon TEXT DEFAULT 'package',
    order_ref TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );

  CREATE TABLE IF NOT EXISTS order_cache (
    order_number TEXT PRIMARY KEY,
    shopify_data TEXT NOT NULL,
    production_stage INTEGER DEFAULT 0,
    batch_number TEXT,
    priority INTEGER DEFAULT 0,
    force_shipped INTEGER DEFAULT 0,
    admin_notes TEXT,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhooks_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT,
    order_id TEXT,
    payload TEXT,
    processed INTEGER DEFAULT 0,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_number);
  CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets(customer_email);
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_views_order ON order_views(order_number);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_feed(created_at DESC);
`);

// =============================================
// SEED INITIAL DATA
// =============================================
const today = new Date().toISOString().split('T')[0];
const statsExist = db.prepare('SELECT id FROM production_stats WHERE stat_date = ?').get(today);

if (!statsExist) {
  db.prepare(`
    INSERT INTO production_stats (stat_date, orders_produced, orders_shipped, orders_in_queue, batch_number, confidence_score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(today, 173, 312, 847, 24, 87);
}

// Seed activity feed if empty
const activityCount = db.prepare('SELECT COUNT(*) as cnt FROM activity_feed').get();
if (activityCount.cnt === 0) {
  const seedActivities = [
    ['production', 'Batch #24 entered manufacturing — 38 orders in progress', 'factory'],
    ['shipped', '12 orders shipped via AusPost today', 'truck'],
    ['production', 'Quality check completed for 24 items in Batch #23', 'check'],
    ['update', 'Production line running at full capacity', 'zap'],
    ['shipped', '8 express orders dispatched this morning', 'rocket'],
    ['production', 'New materials arrived — production continues uninterrupted', 'package'],
    ['update', 'Batch #22 fully shipped — 100% completion', 'check-circle'],
  ];
  const insertActivity = db.prepare(
    'INSERT INTO activity_feed (event_type, message, icon, created_at) VALUES (?, ?, ?, datetime(\'now\', ? || \' minutes\'))'
  );
  seedActivities.forEach(([type, msg, icon], i) => {
    insertActivity.run(type, msg, icon, `-${i * 47}`);
  });
}

module.exports = db;
