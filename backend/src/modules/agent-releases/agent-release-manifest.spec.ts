import { generateKeyPairSync } from 'crypto';
import {
  AgentReleaseManifest, canonicalManifest, signManifest, verifyManifest,
} from './agent-release-manifest';

function manifest(): AgentReleaseManifest {
  return {
    applicationId: 'JtlSyncEngine',channel: 'stable',version: '1.5.0',
    gitSha: 'abcdef1234567',protocolVersion: 2,minimumSupportedVersion: '1.4.0',
    packagePath: '/api/sync-agent/releases/release-id/package',
    packageSize: 1024,sha256: 'a'.repeat(64),
    publisherCertificateThumbprints: ['ABCDEF1234567890ABCDEF1234567890ABCDEF12'],
    publishedAt: '2026-07-29T00:00:00.000Z',requiresServiceRestart: true,
    requiresMachineRestart: false,healthTimeoutSeconds: 120,releaseNotes: 'Secure update',
  };
}

describe('agent release manifest', () => {
  const signing = generateKeyPairSync('rsa',{ modulusLength: 2048 });
  const other = generateKeyPairSync('rsa',{ modulusLength: 2048 });
  const privatePem = signing.privateKey.export({ type: 'pkcs8',format: 'pem' }).toString();
  const publicPem = signing.publicKey.export({ type: 'spki',format: 'pem' }).toString();
  const otherPublicPem = other.publicKey.export({ type: 'spki',format: 'pem' }).toString();

  it('canonicalizes object keys deterministically', () => {
    const value = manifest();
    expect(canonicalManifest(value)).toBe(canonicalManifest({ ...value }));
    expect(canonicalManifest(value)).toBe(
      `{"applicationId":"JtlSyncEngine","channel":"stable","gitSha":"abcdef1234567",` +
      `"healthTimeoutSeconds":120,"minimumSupportedVersion":"1.4.0",` +
      `"packagePath":"/api/sync-agent/releases/release-id/package","packageSize":1024,` +
      `"protocolVersion":2,"publishedAt":"2026-07-29T00:00:00.000Z",` +
      `"publisherCertificateThumbprints":["ABCDEF1234567890ABCDEF1234567890ABCDEF12"],` +
      `"releaseNotes":"Secure update","requiresMachineRestart":false,` +
      `"requiresServiceRestart":true,"sha256":"${'a'.repeat(64)}","version":"1.5.0"}`,
    );
  });

  it('accepts a valid signature and rejects tampering', () => {
    const value = manifest();
    const signature = signManifest(value,privatePem);
    expect(verifyManifest(value,signature,publicPem)).toBe(true);
    expect(verifyManifest({ ...value,version: '1.5.1' },signature,publicPem)).toBe(false);
  });

  it('rejects an unknown signing key', () => {
    const value = manifest();
    expect(verifyManifest(value,signManifest(value,privatePem),otherPublicPem)).toBe(false);
  });
});
