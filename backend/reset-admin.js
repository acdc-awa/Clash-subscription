const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
let newPassword = "";
for (let i = 0; i < 12; i++) {
  newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
}

const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(newPassword, salt);

const adminUser = db.prepare("SELECT email FROM users WHERE role = 'admin' LIMIT 1").get();

if (adminUser) {
  // Update existing admin
  const email = adminUser.email;
  db.prepare("UPDATE users SET password_hash = ?, need_password_change = 1 WHERE email = ?").run(hash, email);
  console.log(`[Admin Reset] Admin password successfully reset!`);
  console.log(`Email: ${email}`);
  console.log(`New Password: ${newPassword}`);
} else {
  // Insert new admin
  const email = 'admin@clash.sub';
  const adminUuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const adminToken = crypto.createHash('sha256').update(adminUuid).digest('hex');

  db.prepare("INSERT INTO users (uuid, email, password_hash, role, need_password_change, token) VALUES (?, ?, ?, ?, ?, ?)")
    .run(adminUuid, email, hash, 'admin', 1, adminToken);
  console.log(`[Admin Reset] Admin user successfully created!`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${newPassword}`);
}
db.close();
