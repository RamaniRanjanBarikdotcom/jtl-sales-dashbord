import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantContextModule } from '../../common/tenant-context.module';
import { MarketplaceAccountController } from './accounts/marketplace-account.controller';
import { MarketplaceAccount } from './accounts/marketplace-account.entity';
import { MarketplaceAccountService } from './accounts/marketplace-account.service';
import { MarketplaceCapability } from './capabilities/marketplace-capability.entity';
import { ConnectorRegistryService } from './core/connector-registry.service';
import { MarketplaceFeatureService } from './core/marketplace-feature.service';
import { CredentialEncryptionService } from './credentials/credential-encryption.service';
import { CredentialRedactorService } from './credentials/credential-redactor.service';
import { MarketplaceCredential } from './credentials/marketplace-credential.entity';
import { MarketplaceOrder } from './normalized/marketplace-order.entity';
import { MarketplaceOrderItem } from './normalized/marketplace-order-item.entity';
import { MarketplaceJobService } from './queues/marketplace-job.service';
import { MarketplaceRawEntity } from './raw-data/marketplace-raw-entity.entity';
import { MarketplaceOrderLink } from './reconciliation/marketplace-order-link.entity';
import { MarketplaceSyncCursor } from './sync/marketplace-sync-cursor.entity';
import { MarketplaceSyncRun } from './sync/marketplace-sync-run.entity';
import { MockConnectorRegistrationService } from './connectors/mock/mock-connector-registration.service';
import { FeedbackController } from './feedback/feedback.controller';
import { FeedbackCapabilityService } from './feedback/feedback-capability.service';
import { FeedbackReadService } from './feedback/feedback-read.service';
import { FeedbackSourceRegistryService } from './feedback/feedback-source-registry.service';

export const MARKETPLACE_ENTITIES = [
  MarketplaceAccount, MarketplaceCredential, MarketplaceCapability, MarketplaceSyncCursor,
  MarketplaceSyncRun, MarketplaceRawEntity, MarketplaceOrder, MarketplaceOrderItem, MarketplaceOrderLink,
];

@Module({
  imports: [TenantContextModule, TypeOrmModule.forFeature(MARKETPLACE_ENTITIES)],
  controllers: [MarketplaceAccountController, FeedbackController],
  providers: [MarketplaceAccountService, ConnectorRegistryService, MarketplaceFeatureService,
    CredentialEncryptionService, CredentialRedactorService, MarketplaceJobService,
    MockConnectorRegistrationService, FeedbackSourceRegistryService, FeedbackCapabilityService, FeedbackReadService],
  exports: [ConnectorRegistryService, FeedbackSourceRegistryService, MarketplaceFeatureService,
    MarketplaceJobService, FeedbackCapabilityService, TypeOrmModule],
})
export class MarketplacesModule {}
