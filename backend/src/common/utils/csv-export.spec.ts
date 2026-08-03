import { buildCsv, CSV_EXPORT_MAX_ROWS, safeCsvCell } from './csv-export';

describe('csv export utility', () => {
  it('adds BOM and protects Excel CSV edge cases', () => {
    const csv = buildCsv(
      [
        {
          name: 'Müller "Test"',
          note: 'line one\nline two',
          formula: '=SUM(A1:A2)',
        },
      ],
      [
        { key: 'name', header: 'Name' },
        { key: 'note', header: 'Note' },
        { key: 'formula', header: 'Formula' },
      ],
    );

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Müller ""Test"""');
    expect(csv).toContain('"line one\nline two"');
    expect(csv).toContain('"\'=SUM(A1:A2)"');
  });

  it('neutralises every dangerous formula prefix, including leading whitespace', () => {
    ['=cmd', '+1+1', '-1+1', '@SUM(1)', '  =cmd'].forEach((value) => {
      expect(safeCsvCell(value)).toContain("'");
    });
    expect(safeCsvCell('safe value')).toBe('"safe value"');
  });

  it('separates rows with CRLF for Excel', () => {
    const csv = buildCsv([{ a: '1' }, { a: '2' }], [{ key: 'a', header: 'A' }]);
    expect(csv).toContain('\r\n');
  });

  it('exposes a bounded row cap so paged exports cannot loop unbounded', () => {
    expect(CSV_EXPORT_MAX_ROWS).toBeGreaterThan(0);
    expect(Number.isFinite(CSV_EXPORT_MAX_ROWS)).toBe(true);
    expect(CSV_EXPORT_MAX_ROWS).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('reports truncation through metadata rather than hiding it', () => {
    const csv = buildCsv([{ a: '1' }], [{ key: 'a', header: 'A' }], {
      metadata: { total_matching_rows: 90_000, exported_rows: 1, complete: false },
    });
    expect(csv).toContain('total_matching_rows');
    expect(csv).toContain('false');
  });
});
