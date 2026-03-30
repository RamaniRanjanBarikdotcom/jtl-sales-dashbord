import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as path from 'path';

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
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
    const hash = await bcrypt.hash(
      process.env.SUPER_ADMIN_PASSWORD || 'Super@Admin1!',
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
