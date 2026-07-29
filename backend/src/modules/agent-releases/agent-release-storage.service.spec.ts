import { BadRequestException } from '@nestjs/common';
import { AgentReleaseStorageService } from './agent-release-storage.service';

describe('AgentReleaseStorageService', () => {
  const original = process.env.SYNC_AGENT_RELEASE_STORAGE_PATH;

  beforeEach(() => {
    process.env.SYNC_AGENT_RELEASE_STORAGE_PATH = '/tmp/jtl-agent-releases';
  });

  afterAll(() => {
    if (original == null) delete process.env.SYNC_AGENT_RELEASE_STORAGE_PATH;
    else process.env.SYNC_AGENT_RELEASE_STORAGE_PATH = original;
  });

  it('resolves only backend-controlled file names inside storage', () => {
    const path = new AgentReleaseStorageService().resolvePackage('JtlSyncEngine-1.5.0.zip');
    expect(path).toContain('/tmp/jtl-agent-releases/');
  });

  it.each([
    '../update.zip','sub/update.zip','https://evil.example/update.zip',
    '/tmp/update.zip','update.exe',
  ])('rejects user-controlled path or URL %s', (value) => {
    expect(() => new AgentReleaseStorageService().resolvePackage(value))
      .toThrow(BadRequestException);
  });
});
