import { sanitizeMetadata } from './metadata-sanitizer';

describe('sanitizeMetadata', () => {
  it('redacts secrets recursively and case-insensitively', () => {
    expect(sanitizeMetadata({
      Authorization: 'Bearer unsafe',
      nested: [{ apiKey: 'unsafe' }, { value: 'safe' }],
    })).toEqual({
      Authorization: '[REDACTED]',
      nested: [{ apiKey: '[REDACTED]' }, { value: 'safe' }],
    });
  });

  it('bounds oversized metadata', () => {
    const result = sanitizeMetadata({ message: 'x'.repeat(5000) }, { maxBytes: 200 });
    expect(result.truncated).toBe(true);
    expect(result.metadataTruncated).toBe(true);
  });

  it('redacts infrastructure URLs, JWT values, and raw ingest rows', () => {
    const result = sanitizeMetadata({
      databaseUrl: 'postgres://user:pass@db/private',
      redisUrl: 'redis://:pass@redis',
      message: 'Bearer abc.def.ghi',
      accessToken: 'header.payload.signature',
      rows: [{ customerAddress: 'private' }],
    });
    expect(result).toEqual({
      databaseUrl: '[REDACTED]',
      redisUrl: '[REDACTED]',
      message: '[REDACTED]',
      accessToken: '[REDACTED]',
      rows: '[REDACTED]',
    });
  });

  it('redacts credentials embedded inside safe-message strings', () => {
    expect(sanitizeMetadata({
      safeMessage: 'Failed postgres://user:pass@db/private Password=unsafe; retrying',
      note: 'Card 4111 1111 1111 1111 rejected',
    })).toEqual({
      safeMessage: 'Failed postgres://[REDACTED] Password=[REDACTED]; retrying',
      note: 'Card [REDACTED_CARD] rejected',
    });
  });
});
