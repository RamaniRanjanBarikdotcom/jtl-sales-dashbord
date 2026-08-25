import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

interface EncryptedEnvelope {
  version: 1;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

@Injectable()
export class CredentialEncryptionService {
  constructor(private readonly config: ConfigService) {}

  currentKeyId(): string {
    return this.config.get<string>('MARKETPLACE_CREDENTIAL_KEY_ID', 'primary');
  }

  encrypt(payload: Record<string, unknown>): string {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      keyId: this.currentKeyId(),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
  }

  decrypt(value: string): Record<string, unknown> {
    const envelope = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as EncryptedEnvelope;
    if (envelope.version !== 1) throw new Error('Unsupported marketplace credential version');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  }

  fingerprint(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  }

  private key(): Buffer {
    const raw = this.config.get<string>('MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY', '').trim();
    if (!raw) throw new ServiceUnavailableException('Marketplace credential encryption is not configured');
    const decoded = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (decoded.length !== 32) {
      throw new ServiceUnavailableException('Marketplace credential encryption key must be 32 bytes');
    }
    return decoded;
  }
}
