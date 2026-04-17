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

  // Create super admin
  const email =
    process.env.SUPER_ADMIN_EMAIL || 'superadmin@jtl.com';
  const existing = await ds.query(
    `SELECT id FROM users WHERE email = $1`,
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
  } else {
    console.log(`Super admin already exists: ${email}`);
  }

  await ds.destroy();
  console.log('Seed complete');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
