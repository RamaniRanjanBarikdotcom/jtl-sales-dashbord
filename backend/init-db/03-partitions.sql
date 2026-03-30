-- ============================================================
-- Order table partitions
-- ============================================================

CREATE TABLE IF NOT EXISTS orders_2022
  PARTITION OF orders FOR VALUES FROM ('2022-01-01') TO ('2023-01-01');

CREATE TABLE IF NOT EXISTS orders_2023
  PARTITION OF orders FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');

CREATE TABLE IF NOT EXISTS orders_2024
  PARTITION OF orders FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE IF NOT EXISTS orders_2025
  PARTITION OF orders FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS orders_2026
  PARTITION OF orders FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS orders_future
  PARTITION OF orders FOR VALUES FROM ('2027-01-01') TO ('2099-01-01');
