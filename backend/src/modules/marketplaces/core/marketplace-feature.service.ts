import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PlatformConfigService } from '../../../config/platform-config.service';

@Injectable()
export class MarketplaceFeatureService {
  constructor(private readonly config: PlatformConfigService) {}

  assertApiEnabled(): void {
    if (!this.config.enabled('MARKETPLACE_PLATFORM_ENABLED') ||
        !this.config.enabled('MARKETPLACE_ACCOUNT_API_ENABLED')) {
      throw new NotFoundException('Marketplace account API is disabled');
    }
  }

  assertQueueEnabled(): void {
    this.assertApiEnabled();
    if (!this.config.enabled('MARKETPLACE_QUEUE_ENABLED')) {
      throw new ServiceUnavailableException('Marketplace queue is disabled');
    }
  }

  state() {
    return {
      platformEnabled: this.config.enabled('MARKETPLACE_PLATFORM_ENABLED'),
      accountApiEnabled: this.config.enabled('MARKETPLACE_ACCOUNT_API_ENABLED'),
      queueEnabled: this.config.enabled('MARKETPLACE_QUEUE_ENABLED'),
      schedulerEnabled: this.config.enabled('MARKETPLACE_SCHEDULER_ENABLED'),
      mockConnectorEnabled: this.config.enabled('MARKETPLACE_MOCK_CONNECTOR_ENABLED'),
      canonicalReadsEnabled: this.config.enabled('MARKETPLACE_CANONICAL_READS_ENABLED'),
      writeActionsEnabled: this.config.enabled('MARKETPLACE_WRITE_ACTIONS_ENABLED'),
      reviewsEnabled: this.config.enabled('MARKETPLACE_REVIEWS_ENABLED'),
      mode: 'SHADOW',
    };
  }
}
