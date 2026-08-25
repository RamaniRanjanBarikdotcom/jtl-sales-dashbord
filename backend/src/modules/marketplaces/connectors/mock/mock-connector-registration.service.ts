import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistryService } from '../../core/connector-registry.service';
import { MockMarketplaceConnector } from './mock-marketplace.connector';

@Injectable()
export class MockConnectorRegistrationService implements OnModuleInit {
  constructor(private readonly config: ConfigService, private readonly registry: ConnectorRegistryService) {}

  onModuleInit(): void {
    if (this.config.get<string>('MARKETPLACE_MOCK_CONNECTOR_ENABLED', 'false').toLowerCase() === 'true') {
      this.registry.register(new MockMarketplaceConnector());
    }
  }
}
