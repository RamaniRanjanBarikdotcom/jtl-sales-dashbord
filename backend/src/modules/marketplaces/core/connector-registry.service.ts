import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { Marketplace } from './marketplace.enum';
import { MarketplaceConnector } from './marketplace-connector.interface';

@Injectable()
export class ConnectorRegistryService {
  private readonly logger = new Logger(ConnectorRegistryService.name);
  private readonly registry = new Map<Marketplace, MarketplaceConnector>();

  register(connector: MarketplaceConnector): void {
    this.registry.set(connector.marketplace, connector);
    this.logger.log(`Registered connector: ${connector.marketplace}`);
  }

  get(marketplace: Marketplace): MarketplaceConnector {
    const connector = this.registry.get(marketplace);
    if (!connector) {
      throw new NotImplementedException(`Connector is not available for marketplace: ${marketplace}`);
    }
    return connector;
  }

  has(marketplace: Marketplace): boolean {
    return this.registry.has(marketplace);
  }

  all(): MarketplaceConnector[] {
    return Array.from(this.registry.values());
  }
}
