export type CsvColumn<T extends Record<string, unknown> = Record<string, unknown>> = {
  key: keyof T | string;
  header: string;
  value?: (row: T) => unknown;
};

type CsvOptions = {
  includeBom?: boolean;
  metadata?: Record<string, unknown>;
};

const DANGEROUS_FORMULA_PREFIX = /^[=+\-@]/;

function normalizeCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function safeCsvCell(value: unknown): string {
  let text = normalizeCell(value);
  if (DANGEROUS_FORMULA_PREFIX.test(text.trimStart())) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
  options: CsvOptions = {},
): string {
  const lines: string[] = [];
  if (options.metadata) {
    Object.entries(options.metadata).forEach(([key, value]) => {
      lines.push([safeCsvCell(`# ${key}`), safeCsvCell(value)].join(','));
    });
    lines.push('');
  }
  lines.push(columns.map((column) => safeCsvCell(column.header)).join(','));
  rows.forEach((row) => {
    lines.push(columns.map((column) => {
      const value = column.value ? column.value(row) : row[column.key as keyof T];
      return safeCsvCell(value);
    }).join(','));
  });
  return `${options.includeBom === false ? '' : '\uFEFF'}${lines.join('\r\n')}`;
}

export function inferCsvColumns(rows: Record<string, unknown>[]): CsvColumn[] {
  if (!rows.length) return [];
  return Object.keys(rows[0])
    .filter((key) => key !== 'total_count')
    .map((key) => ({ key, header: key }));
}

// Upper bound for any paged CSV export. Exports must never truncate silently,
// but they also must not page unbounded — a multi-hundred-thousand row tenant
// would hold the request open and exhaust memory. Callers report the cap in
// their metadata via `complete: false` so truncation is always visible.
export const CSV_EXPORT_MAX_ROWS = 50_000;
