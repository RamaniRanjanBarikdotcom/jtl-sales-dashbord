import fs from 'fs';
import path from 'path';

describe('authoritative tenant schema', () => {
  const schemaDir = path.resolve(__dirname, '../../init-db');
  const tables = fs.readFileSync(path.join(schemaDir, '02-tables.sql'), 'utf8');
  const integrity = fs.readFileSync(
    path.join(schemaDir, '12-tenant-integrity.sql'),
    'utf8',
  );

  it.each([
    'UNIQUE (tenant_id, jtl_product_id)',
    'UNIQUE (tenant_id, jtl_customer_id)',
    'UNIQUE (tenant_id, jtl_product_id, jtl_warehouse_id)',
  ])('contains required tenant identity %s', (constraint) => {
    expect(tables).toContain(constraint);
  });

  it('enforces order identity across date partitions', () => {
    expect(integrity).toContain('prevent_duplicate_tenant_jtl_order');
    expect(integrity).toContain(
      'existing.tenant_id = NEW.tenant_id',
    );
    expect(integrity).toContain(
      'existing.jtl_order_id = NEW.jtl_order_id',
    );
    expect(integrity).toContain("ERRCODE = '23505'");
  });
});
