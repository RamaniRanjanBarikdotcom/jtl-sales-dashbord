#!/bin/sh
set -eu

compose_file="docker-compose.smoke.yml"
project_name="jtl-dashboard-smoke"

cleanup() {
  docker compose -p "$project_name" -f "$compose_file" down --volumes --remove-orphans
}

trap cleanup EXIT INT TERM

docker compose -p "$project_name" -f "$compose_file" up -d --build

attempt=0
until response="$(curl -fsS http://127.0.0.1:3101/api/healthz 2>/dev/null)"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose -p "$project_name" -f "$compose_file" logs api-smoke
    exit 1
  fi
  sleep 2
done

printf '%s' "$response" | grep -q '"buildSha":"local-smoke"'

tenant_id="10000000-0000-4000-8000-000000000001"
user_id="20000000-0000-4000-8000-000000000001"

docker compose -p "$project_name" -f "$compose_file" exec -T postgres-smoke \
  psql -v ON_ERROR_STOP=1 -U jtl_api -d jtl_analytics_smoke <<SQL
INSERT INTO tenants (id, name, slug)
VALUES ('$tenant_id', 'Smoke Tenant', 'smoke-tenant');

INSERT INTO users (
  id, email, password_hash, full_name, role, is_active, must_change_pwd
)
VALUES (
  '$user_id',
  'smoke-admin@example.invalid',
  crypt('SmokePass1!', gen_salt('bf')),
  'Smoke Admin',
  'super_admin',
  true,
  false
);

INSERT INTO products (
  tenant_id, jtl_product_id, article_number, name, stock_quantity
)
VALUES (
  '$tenant_id', 9001, 'SMOKE-001', 'Smoke Inventory Fixture', 5
);

INSERT INTO inventory (
  tenant_id,
  jtl_product_id,
  jtl_warehouse_id,
  product_id,
  warehouse_name,
  available,
  reserved,
  total
)
SELECT
  '$tenant_id',
  9001,
  1,
  id,
  'Smoke Warehouse',
  3,
  2,
  5
FROM products
WHERE tenant_id = '$tenant_id' AND jtl_product_id = 9001;

INSERT INTO orders (
  tenant_id, jtl_order_id, order_number, order_date, gross_revenue, net_revenue,
  status, channel, item_count, payment_method, shipping_method, jtl_modified_at
)
VALUES (
  '$tenant_id', 7001, 'SMOKE-ORDER-1', CURRENT_DATE, 49.90, 41.93,
  'completed', 'Direct', 1, 'Invoice', 'DHL', now()
);

INSERT INTO order_items (
  tenant_id, jtl_item_id, order_id, product_id, quantity,
  unit_price_gross, unit_price_net, unit_cost, line_total_gross
)
VALUES ('$tenant_id', 8001, 7001, 9001, 1, 49.90, 41.93, 20.00, 49.90);
SQL

login_response="$(
  curl -fsS \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoke-admin@example.invalid","password":"SmokePass1!"}' \
    http://127.0.0.1:3101/api/auth/login
)"
access_token="$(
  printf '%s' "$login_response" |
    node -e "let body='';process.stdin.on('data',chunk=>body+=chunk);process.stdin.on('end',()=>process.stdout.write(JSON.parse(body).data.accessToken));"
)"
inventory_response="$(
  curl -fsS \
    -H "Authorization: Bearer $access_token" \
    -H "x-tenant-id: $tenant_id" \
    'http://127.0.0.1:3101/api/inventory?page=1&limit=10&status=available'
)"

printf '%s' "$inventory_response" |
  node -e "
    let body = '';
    process.stdin.on('data', chunk => body += chunk);
    process.stdin.on('end', () => {
      const payload = JSON.parse(body).data;
      const row = payload.rows.find(item => item.article_number === 'SMOKE-001');
      if (!row) throw new Error('Smoke inventory fixture missing from API response');
      if (Number(row.total_available) !== 5) throw new Error('Visible stock is not canonical total');
      if (Number(row.available_stock) !== 3) throw new Error('Available stock changed');
      if (Number(row.total_reserved) !== 2) throw new Error('Reserved stock changed');
    });
  "

for endpoint in \
  'sales/kpis?range=ALL' \
  'products?page=1&limit=10&search=SMOKE-001' \
  'comparison/summary?range=ALL'; do
  response="$(
    curl -fsS \
      -H "Authorization: Bearer $access_token" \
      -H "x-tenant-id: $tenant_id" \
      "http://127.0.0.1:3101/api/$endpoint"
  )"
  printf '%s' "$response" | node -e "
    let body = '';
    process.stdin.on('data', chunk => body += chunk);
    process.stdin.on('end', () => {
      const parsed = JSON.parse(body);
      if (parsed.success === false || parsed.data == null) {
        throw new Error('Live analytics smoke endpoint failed');
      }
    });
  "
done

diagnostics_response="$(
  curl -fsS \
    -H "Authorization: Bearer $access_token" \
    http://127.0.0.1:3101/api/admin/health
)"
printf '%s' "$diagnostics_response" |
  node -e "
    let body = '';
    process.stdin.on('data', chunk => body += chunk);
    process.stdin.on('end', () => {
      const diagnostics = JSON.parse(body).data;
      if (Number(diagnostics.checks.integrity.mismatched_products) !== 0) {
        throw new Error('Product and inventory stock are inconsistent');
      }
    });
  "

printf '%s\n' "Local Docker smoke test passed."
