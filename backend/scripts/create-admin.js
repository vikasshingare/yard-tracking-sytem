require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const [displayName, rawEmail, password] = process.argv.slice(2);
  if (!displayName || !rawEmail || !password || password.length < 10) {
    console.error('Usage: npm run create-admin -- "Yard Admin" admin@example.com "10-character-password"');
    process.exitCode = 1;
    return;
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'container_yard',
  });
  try {
    const email = rawEmail.trim().toLowerCase();
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO Users (display_name, email, password_hash, role) VALUES (?, ?, ?, \'admin\')',
      [displayName.trim(), email, hash]);
    console.log(`Administrator account created (user id ${result.insertId}, ${email}).`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') console.error('That email already has an account.');
    else console.error(err.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
}

main();
