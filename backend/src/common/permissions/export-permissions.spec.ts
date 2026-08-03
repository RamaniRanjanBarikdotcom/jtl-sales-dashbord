import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Two production defects motivated these tests:
//
// 1. products.controller.ts declared @Get(':productId/intelligence') BEFORE
//    @Get('export'). NestJS matches in declaration order, so /products/export
//    was captured by the parameterised route and rejected by ParseIntPipe.
//
// 2. sales/products/inventory/customers .export existed in permission-keys.ts
//    and were enforced by controllers, but were never INSERTed into the
//    permissions table. PermissionsGuard resolves against the database, so
//    every export returned 403 for every user.

const MODULES_DIR = join(__dirname, '..', '..', 'modules');
const INIT_DB_DIR = join(__dirname, '..', '..', '..', 'init-db');

function controllerSource(module: string, file: string): string {
  return readFileSync(join(MODULES_DIR, module, file), 'utf8');
}

describe('export route registration', () => {
  const controllers: [string, string][] = [
    ['products', 'products.controller.ts'],
    ['sales', 'sales.controller.ts'],
    ['inventory', 'inventory.controller.ts'],
    ['customers', 'customers.controller.ts'],
  ];

  it.each(controllers)(
    '%s declares static export routes before parameterised routes',
    (module, file) => {
      const source = controllerSource(module, file);
      const staticExport = source.indexOf("@Get('export')");
      expect(staticExport).toBeGreaterThan(-1);

      // Any ':param' route declared earlier would shadow /export.
      const shadowing = [...source.matchAll(/@Get\('(:[^']*)'\)/g)]
        .filter((match) => (match.index ?? 0) < staticExport)
        .map((match) => match[1]);

      expect(shadowing).toEqual([]);
    },
  );
});

describe('export permission seeding', () => {
  const REQUIRED = [
    'sales.export',
    'products.export',
    'inventory.export',
    'customers.export',
    'comparison.export',
  ];

  const seedSql = readdirSync(INIT_DB_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(INIT_DB_DIR, file), 'utf8'))
    .join('\n');

  it.each(REQUIRED)('%s is inserted into the permissions table', (key) => {
    expect(seedSql).toContain(`'${key}'`);
  });
});
