const { types } = require('pg') as {
  types: {
    setTypeParser: (
      oid: number,
      parser: (value: string) => number,
    ) => void;
  };
};

const NUMERIC_OID = 1700;

export function parsePostgresNumeric(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid PostgreSQL numeric value: ${value}`);
  }
  return parsed;
}

export function configurePostgresTypeParsers() {
  types.setTypeParser(NUMERIC_OID, parsePostgresNumeric);
}
