const Database = require('better-sqlite3');
const path = require('path');

// Resolve database path
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db');
console.log(`[Migration] Target DB: ${dbPath}`);

const db = new Database(dbPath);

try {
  // Disable foreign keys temporarily during schema modification
  db.pragma('foreign_keys = OFF');

  db.transaction(() => {
    // Check if table exists
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_nodes'").get();
    if (!tableCheck) {
      console.log("[Migration] user_nodes table does not exist. No migration needed.");
      return;
    }

    console.log("[Migration] Renaming old user_nodes table...");
    db.prepare("ALTER TABLE user_nodes RENAME TO _user_nodes_old").run();

    console.log("[Migration] Creating new user_nodes table with CASCADE support...");
    db.prepare(`
      CREATE TABLE user_nodes (
        user_uuid TEXT,
        node_id TEXT,
        PRIMARY KEY (user_uuid, node_id),
        FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `).run();

    console.log("[Migration] Restoring data from old table...");
    db.prepare("INSERT INTO user_nodes SELECT * FROM _user_nodes_old").run();

    console.log("[Migration] Dropping temporary old table...");
    db.prepare("DROP TABLE _user_nodes_old").run();
  })();

  db.pragma('foreign_keys = ON');
  console.log("✅ [Migration] Database migration completed successfully! All data preserved.");
} catch (e) {
  console.error("❌ [Migration] Migration failed:", e.message);
  process.exit(1);
}
