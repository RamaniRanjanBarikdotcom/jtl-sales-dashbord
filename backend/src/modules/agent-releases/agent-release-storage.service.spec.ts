import { BadRequestException } from '@nestjs/common';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { AgentReleaseStorageService } from './agent-release-storage.service';

describe('AgentReleaseStorageService', () => {
  const original = process.env.SYNC_AGENT_RELEASE_STORAGE_PATH;
  const storageRoot = join(tmpdir(), 'jtl-agent-releases');

  beforeEach(() => {
    process.env.SYNC_AGENT_RELEASE_STORAGE_PATH = storageRoot;
  });

  afterAll(() => {
    if (original == null) delete process.env.SYNC_AGENT_RELEASE_STORAGE_PATH;
    else process.env.SYNC_AGENT_RELEASE_STORAGE_PATH = original;
  });

  it('resolves only backend-controlled file names inside storage', () => {
    const packagePath = new AgentReleaseStorageService()
      .resolvePackage('JtlSyncEngine-1.5.0.zip');
    expect(dirname(packagePath)).toBe(resolve(storageRoot));
  });

  it.each([
    '../update.zip','sub/update.zip','https://evil.example/update.zip',
    resolve(tmpdir(), 'update.zip'),'update.exe',
  ])('rejects user-controlled path or URL %s', (value) => {
    expect(() => new AgentReleaseStorageService().resolvePackage(value))
      .toThrow(BadRequestException);
  });
});
