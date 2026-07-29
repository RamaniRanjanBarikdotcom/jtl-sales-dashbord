const SECRET_KEY = /^(authorization|cookie|password|passwordhash|passwd|secret|clientsecret|token|accesstoken|refreshtoken|api[_-]?key|private[_-]?key|connection[_-]?string|databaseurl|redisurl|requestbody|rawpayload|ingestrows|rows|customeraddress|paymentcard|cardnumber|cvv|cvc)$/i;
const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';

export interface MetadataSanitizerOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
  maxBytes?: number;
}

export function sanitizeMetadata(
  input: unknown,
  options: MetadataSanitizerOptions = {},
): Record<string, unknown> {
  const maxDepth = options.maxDepth ?? 8;
  const maxArrayLength = options.maxArrayLength ?? 100;
  const maxStringLength = options.maxStringLength ?? 2000;
  const maxBytes = options.maxBytes ?? 32_000;
  const visit = (value: unknown, depth: number, key?: string): unknown => {
    if (key && SECRET_KEY.test(key)) return REDACTED;
    if (depth > maxDepth) return TRUNCATED;
    if (typeof value === 'string') {
      if (/^Bearer\s+\S+/i.test(value) || /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(value)) {
        return REDACTED;
      }
      const redactedValue = value
        .replace(/\b(postgres(?:ql)?|redis):\/\/[^\s]+/gi, '$1://[REDACTED]')
        .replace(/\b(password|pwd|user\s*id|uid)\s*=\s*[^;\s]+/gi, '$1=[REDACTED]')
        .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]');
      return redactedValue.length > maxStringLength
        ? `${redactedValue.slice(0, maxStringLength)}${TRUNCATED}`
        : redactedValue;
    }
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.slice(0, maxArrayLength).map((item) => visit(item, depth + 1));
    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .map(([childKey, childValue]) => [childKey, visit(childValue, depth + 1, childKey)]));
    }
    return String(value);
  };
  const sanitized = visit(input ?? {}, 0);
  const result = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : { value: sanitized };
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return result;
  return {
    truncated: true,
    metadataTruncated: true,
    originalBytes: Buffer.byteLength(serialized, 'utf8'),
    preview: serialized.slice(0, Math.max(0, maxBytes - 100)),
  };
}
