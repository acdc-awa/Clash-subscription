const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure db directory is resolved correctly and exists
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db = new Database(dbPath);

// Enable foreign key support
db.pragma('foreign_keys = ON');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server TEXT NOT NULL,
    secret TEXT NOT NULL,
    multiplier REAL DEFAULT 1.0
  );

  CREATE TABLE IF NOT EXISTS inbounds (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    network TEXT NOT NULL,
    security TEXT NOT NULL,
    config TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    traffic INTEGER NOT NULL,
    duration_days INTEGER NOT NULL,
    price REAL NOT NULL,
    rule_template TEXT DEFAULT 'default',
    expiration_policy TEXT DEFAULT 'immediate'
  );

  CREATE TABLE IF NOT EXISTS users (
    uuid TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    package_id TEXT,
    used_traffic INTEGER DEFAULT 0,
    expiry_time TEXT,
    activation_time TEXT,
    status TEXT DEFAULT 'active',
    need_password_change INTEGER DEFAULT 1,
    token TEXT UNIQUE NOT NULL,
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS package_inbounds (
    package_id TEXT,
    inbound_id TEXT,
    PRIMARY KEY (package_id, inbound_id),
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rules (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS node_stats (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    cpu_usage REAL NOT NULL,
    mem_usage REAL NOT NULL,
    network_rx INTEGER NOT NULL,
    network_tx INTEGER NOT NULL,
    online_users INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    time TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL,
    ip TEXT NOT NULL
  );
`);

// Migration: package_nodes -> package_inbounds
try {
  const packageNodesCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='package_nodes'").get();
  if (packageNodesCheck) {
    console.log("[Database Migration] Migrating package_nodes to package_inbounds...");
    
    // Get all package_nodes mappings
    const mappings = db.prepare("SELECT package_id, node_id FROM package_nodes").all();
    
    db.transaction(() => {
      const insertStmt = db.prepare("INSERT OR IGNORE INTO package_inbounds (package_id, inbound_id) VALUES (?, ?)");
      for (const m of mappings) {
        // Find all inbounds for this node
        const inbounds = db.prepare("SELECT id FROM inbounds WHERE node_id = ?").all(m.node_id);
        for (const inb of inbounds) {
          insertStmt.run(m.package_id, inb.id);
        }
      }
    })();
    
    // Drop old table
    db.exec("DROP TABLE package_nodes");
    console.log("✅ [Database Migration] Successfully migrated package_nodes to package_inbounds.");
  }
} catch (err) {
  console.error("❌ [Database Migration] Failed to migrate package_nodes to package_inbounds:", err);
}

// Insert default rule "default" if not exists
const hasDefaultRule = db.prepare("SELECT 1 FROM rules WHERE name = 'default'").get();
if (!hasDefaultRule) {
  db.prepare("INSERT INTO rules (name, content) VALUES ('default', '# Default Clash Config\nmode: rule\n# =PROXIES=\nproxy-groups:\n  - name: PROXY\n    type: select\n    proxies:\n      - all\nrules:\n  - MATCH,PROXY')").run();
}

// Check if admin user exists, if not initialize one
const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
if (adminCount === 0) {
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  
  // Generate random 12-char password
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPassword = "";
  for (let i = 0; i < 12; i++) {
    randomPassword += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Generate a random UUID
  const adminUuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(randomPassword, salt);
  const adminToken = crypto.createHash('sha256').update(adminUuid).digest('hex');
  
  db.prepare("INSERT INTO users (uuid, email, password_hash, role, need_password_change, token) VALUES (?, ?, ?, ?, ?, ?)")
    .run(adminUuid, 'admin@clash.sub', hash, 'admin', 1, adminToken);
    
  console.log("\n=======================================================");
  console.log("  [Database] Admin User Initialized Successfully!");
  console.log("  Email: admin@clash.sub");
  console.log(`  Password: ${randomPassword}`);
  console.log("  *Please login and change your password immediately.*");
  console.log("=======================================================\n");
}

module.exports = db;
