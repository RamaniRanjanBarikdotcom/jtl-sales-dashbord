import { createSign, createVerify } from 'crypto';

export interface AgentReleaseManifest {
  applicationId: 'JtlSyncEngine';
  channel: string;
  version: string;
  gitSha: string;
  protocolVersion: number;
  minimumSupportedVersion: string | null;
  packagePath: string;
  packageSize: number;
  sha256: string;
  publisherCertificateThumbprints: string[];
  publishedAt: string;
  requiresServiceRestart: boolean;
  requiresMachineRestart: boolean;
  healthTimeoutSeconds: number;
  releaseNotes: string | null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalManifest(manifest: AgentReleaseManifest): string {
  return JSON.stringify(canonicalValue(manifest));
}

export function signManifest(manifest: AgentReleaseManifest, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalManifest(manifest), 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

export function verifyManifest(
  manifest: AgentReleaseManifest,
  signature: string,
  publicKeyPem: string,
): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(canonicalManifest(manifest), 'utf8');
  verifier.end();
  return verifier.verify(publicKeyPem, signature, 'base64');
}
