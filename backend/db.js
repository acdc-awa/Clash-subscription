const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure db directory is resolved correctly and exists
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

// Enable foreign key support
db.pragma('foreign_keys = ON');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT,
    server TEXT,
    port INTEGER,
    config TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    uuid TEXT PRIMARY KEY,
    remark TEXT,
    rule_template TEXT
  );

  CREATE TABLE IF NOT EXISTS user_nodes (
    user_uuid TEXT,
    node_id TEXT,
    PRIMARY KEY (user_uuid, node_id),
    FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rules (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL
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

module.exports = db;
