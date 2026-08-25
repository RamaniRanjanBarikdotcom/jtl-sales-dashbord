import { Injectable } from '@nestjs/common';

const sensitive = /(secret|token|password|private.?key|authorization|credential|refresh)/i;

@Injectable()
export class CredentialRedactorService {
  redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitive.test(key) ? '[REDACTED]' : this.redact(item),
      ]));
    }
    return value;
  }
}
