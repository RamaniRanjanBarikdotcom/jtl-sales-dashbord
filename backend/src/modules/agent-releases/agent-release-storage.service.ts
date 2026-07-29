import {
  BadRequestException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { basename, resolve, sep } from 'path';

@Injectable()
export class AgentReleaseStorageService {
  private root(): string {
    const configured = String(process.env.SYNC_AGENT_RELEASE_STORAGE_PATH || '').trim();
    if (!configured) {
      throw new ServiceUnavailableException('Agent release storage is not configured');
    }
    return resolve(configured);
  }

  resolvePackage(fileName: string): string {
    if (basename(fileName) !== fileName || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.zip$/.test(fileName)) {
      throw new BadRequestException('Invalid release package file name');
    }
    const root = this.root();
    const candidate = resolve(root, fileName);
    if (!candidate.startsWith(`${root}${sep}`)) throw new BadRequestException('Invalid package path');
    return candidate;
  }

  async stat(fileName: string) {
    try {
      const stats = await fs.stat(this.resolvePackage(fileName));
      if (!stats.isFile()) throw new NotFoundException('Release package not found');
      return stats;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new NotFoundException('Release package not found');
    }
  }

  stream(fileName: string) {
    return createReadStream(this.resolvePackage(fileName));
  }
}
