import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import { randomInt } from 'crypto';

function generateStrongPassword(length = 20): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '!@#$%^&*';
  const all = `${upper}${lower}${nums}${special}`;
  const chars = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    nums[randomInt(nums.length)],
    special[randomInt(special.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function seed() {
  // Pass --reset-password (or set SUPER_ADMIN_RESET=true) to update the existing
  // super-admin row's password_hash from SUPER_ADMIN_PASSWORD. Without this,
  // re-running the seed against an already-seeded DB is a no-op even if the
  // env password has been rotated — leaving login broken with no obvious cause.
  const resetPassword =
    process.argv.includes('--reset-password') ||
    String(process.env.SUPER_ADMIN_RESET || '').toLowerCase() === 'true';

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'jtl_analytics',
    username: process.env.PG_USER || 'jtl_api',
    password: process.env.PG_PASSWORD || '',
    entities: [path.join(__dirname, '../entities/*.entity{.ts,.js}')],
    synchronize: false,
  });

  await ds.initialize();
  console.log('Connected to database');

  // Create super admin. Email is normalized (lowercase + NFKC) so that the
  // case-insensitive login lookup in AuthService.login can find this row
  // regardless of how SUPER_ADMIN_EMAIL was written in .env.
  const rawEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@jtl.com';
  const email = rawEmail.trim().toLowerCase().normalize('NFKC');
  const existing = await ds.query(
    `SELECT id FROM users WHERE LOWER(email) = $1`,
    [email],
  );

  if (existing.length === 0) {
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || generateStrongPassword();
    if (!process.env.SUPER_ADMIN_PASSWORD) {
      console.warn('SUPER_ADMIN_PASSWORD not set; generated a one-time random password for this seed run.');
      console.warn(`Generated SUPER_ADMIN_PASSWORD=${adminPassword}`);
    }
    const hash = await bcrypt.hash(
      adminPassword,
      12,
    );
    await ds.query(
      `INSERT INTO users (email, password_hash, full_name, role, must_change_pwd)
       VALUES ($1, $2, $3, 'super_admin', false)`,
      [email, hash, process.env.SUPER_ADMIN_NAME || 'Super Admin'],
    );
    console.log(`Super admin created: ${email}`);
  } else if (resetPassword) {
    if (!process.env.SUPER_ADMIN_PASSWORD) {
      throw new Error('--reset-password requires SUPER_ADMIN_PASSWORD to be set in env');
    }
    const hash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 12);
    await ds.query(
      `UPDATE users
         SET password_hash = $1,
             failed_login_attempts = 0,
             locked_until = NULL,
             is_active = true,
             must_change_pwd = false
       WHERE LOWER(email) = $2`,
      [hash, email],
    );
    console.log(`Super admin password reset: ${email}`);
  } else {
    console.log(
      `Super admin already exists: ${email} (pass --reset-password to update password from SUPER_ADMIN_PASSWORD)`,
    );
  }

  await ds.destroy();
  console.log('Seed complete');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
