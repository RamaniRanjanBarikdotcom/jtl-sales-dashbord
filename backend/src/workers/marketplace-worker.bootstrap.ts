import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MarketplaceWorkerModule } from './marketplace-worker.module';

export async function bootstrapMarketplaceWorker(role: 'scheduler' | 'realtime' | 'bulk' | 'postprocess') {
  process.env.MARKETPLACE_WORKER_ROLE = role;
  const logger = new Logger(`Marketplace${role[0].toUpperCase()}${role.slice(1)}`);
  const context = await NestFactory.createApplicationContext(MarketplaceWorkerModule, { logger });
  context.enableShutdownHooks();
  logger.log(`Marketplace ${role} process initialized`);
}
