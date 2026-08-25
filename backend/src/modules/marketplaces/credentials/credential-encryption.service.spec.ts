import { ConfigService } from '@nestjs/config';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CredentialRedactorService } from './credential-redactor.service';

describe('marketplace credential security', () => {
  const config = { get: (name: string, fallback?: string) => name === 'MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY'
    ? '11'.repeat(32) : name === 'MARKETPLACE_CREDENTIAL_KEY_ID' ? 'test-key' : fallback } as ConfigService;

  it('round-trips AES-GCM credentials without plaintext persistence', () => {
    const service = new CredentialEncryptionService(config);
    const encrypted = service.encrypt({ clientSecret: 'very-secret', accessToken: 'token-value' });
    expect(encrypted).not.toContain('very-secret');
    expect(service.decrypt(encrypted)).toEqual({ clientSecret: 'very-secret', accessToken: 'token-value' });
  });

  it('redacts nested credential fields', () => {
    const redacted = new CredentialRedactorService().redact({ clientSecret: 'x', nested: { refreshToken: 'y', region: 'DE' } });
    expect(redacted).toEqual({ clientSecret: '[REDACTED]', nested: { refreshToken: '[REDACTED]', region: 'DE' } });
  });
});
