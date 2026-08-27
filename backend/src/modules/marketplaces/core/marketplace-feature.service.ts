import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PlatformConfigService } from '../../../config/platform-config.service';
import { CanonicalChannelPaymentSchemaService } from '../../../database/canonical-channel-payment-schema.service';

@Injectable()
export class MarketplaceFeatureService {
  constructor(
    private readonly config: PlatformConfigService,
    private readonly schema: CanonicalChannelPaymentSchemaService,
  ) {}

  assertApiEnabled(): void {
    if (!this.config.enabled('MARKETPLACE_PLATFORM_ENABLED') ||
        !this.config.enabled('MARKETPLACE_ACCOUNT_API_ENABLED')) {
      throw new NotFoundException('Marketplace account API is disabled');
    }
    if (!this.schema.current().marketplaceSchema20Available) {
      throw new ServiceUnavailableException(
        'Marketplace schema is unavailable; apply schema 20 before enabling marketplace APIs',
      );
    }
  }

  assertQueueEnabled(): void {
    this.assertApiEnabled();
    if (!this.config.enabled('MARKETPLACE_QUEUE_ENABLED')) {
      throw new ServiceUnavailableException('Marketplace queue is disabled');
    }
  }

  assertFeedbackEnabled(): void {
    this.assertApiEnabled();
    if (!this.config.enabled('MARKETPLACE_REVIEWS_ENABLED')) {
      throw new NotFoundException('Marketplace feedback API is disabled');
    }
    if (!this.schema.current().marketplaceSchema21Available) {
      throw new ServiceUnavailableException(
        'Marketplace feedback schema is unavailable; apply schema 21 before enabling feedback APIs',
      );
    }
  }

  state() {
    const capabilities = this.schema.current();
    return {
      platformEnabled: this.config.enabled('MARKETPLACE_PLATFORM_ENABLED'),
      accountApiEnabled: this.config.enabled('MARKETPLACE_ACCOUNT_API_ENABLED'),
      queueEnabled: this.config.enabled('MARKETPLACE_QUEUE_ENABLED'),
      schedulerEnabled: this.config.enabled('MARKETPLACE_SCHEDULER_ENABLED'),
      mockConnectorEnabled: this.config.enabled('MARKETPLACE_MOCK_CONNECTOR_ENABLED'),
      canonicalReadsEnabled: this.config.enabled('MARKETPLACE_CANONICAL_READS_ENABLED'),
      writeActionsEnabled: this.config.enabled('MARKETPLACE_WRITE_ACTIONS_ENABLED'),
      reviewsEnabled: this.config.enabled('MARKETPLACE_REVIEWS_ENABLED'),
      schema20Available: capabilities.marketplaceSchema20Available,
      schema21Available: capabilities.marketplaceSchema21Available,
      mode: 'SHADOW',
    };
  }
}
