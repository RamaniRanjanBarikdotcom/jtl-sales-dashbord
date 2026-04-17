import { randomBytes, randomInt } from 'node:crypto';

function hex(bytes = 64) {
  return randomBytes(bytes).toString('hex');
}

function password(length = 24) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '!@#$%^&*';
  const all = `${upper}${lower}${nums}${special}`;
  const seed = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    nums[randomInt(nums.length)],
    special[randomInt(special.length)],
  ];
  while (seed.length < length) {
    seed.push(all[randomInt(all.length)]);
  }
  for (let i = seed.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [seed[i], seed[j]] = [seed[j], seed[i]];
  }
  return seed.join('');
}

const output = {
  POSTGRES_PASSWORD: password(28),
  REDIS_PASSWORD: password(28),
  JWT_ACCESS_SECRET: hex(64),
  JWT_REFRESH_SECRET: hex(64),
  SUPER_ADMIN_PASSWORD: password(20),
};

console.log('# Paste these into your deployment env vars');
Object.entries(output).forEach(([k, v]) => console.log(`${k}=${v}`));
