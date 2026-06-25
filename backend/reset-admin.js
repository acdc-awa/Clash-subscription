const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const email = 'admin@clash.sub';
const newPassword = 'admin';
const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(newPassword, salt);

const adminUuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
const adminToken = crypto.createHash('sha256').update(adminUuid).digest('hex');

const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
if (adminCount > 0) {
  // Update existing admin
  db.prepare("UPDATE users SET password_hash = ?, need_password_change = 1 WHERE email = ?").run(hash, email);
  console.log(`[Admin Reset] Admin password successfully reset!`);
  console.log(`Email: ${email}`);
  console.log(`New Password: ${newPassword}`);
} else {
  // Insert new admin
  db.prepare("INSERT INTO users (uuid, email, password_hash, role, need_password_change, token) VALUES (?, ?, ?, ?, ?, ?)")
    .run(adminUuid, email, hash, 'admin', 1, adminToken);
  console.log(`[Admin Reset] Admin user successfully created!`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${newPassword}`);
}
db.close();
