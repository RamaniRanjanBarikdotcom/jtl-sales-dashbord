export type PaginatedResult<T> = {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  count: number;
};

function toSafePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function buildPaginatedResult<T>(
  rows: T[],
  totalInput: unknown,
  pageInput: unknown,
  limitInput: unknown,
  extras?: Record<string, unknown>,
): PaginatedResult<T> & Record<string, unknown> {
  const total = Math.max(0, Number.parseInt(String(totalInput ?? 0), 10) || 0);
  const page = toSafePositiveInt(pageInput, 1);
  const limit = toSafePositiveInt(limitInput, 50);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    rows,
    total,
    page,
    limit,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1,
    count: rows.length,
    ...(extras || {}),
  };
}
