import { parsePostgresNumeric } from './pg-types';

describe('parsePostgresNumeric', () => {
  it.each([
    ['5.000', 5],
    ['3.125', 3.125],
    ['-12.50', -12.5],
    ['0', 0],
  ])('converts %s to a finite number', (value, expected) => {
    expect(parsePostgresNumeric(value)).toBe(expected);
  });

  it('rejects invalid numeric values', () => {
    expect(() => parsePostgresNumeric('not-a-number')).toThrow(
      'Invalid PostgreSQL numeric value',
    );
  });
});
