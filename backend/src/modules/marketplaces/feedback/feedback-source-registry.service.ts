import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceFeedbackSourceConnector } from './marketplace-feedback-source.interface';

@Injectable()
export class FeedbackSourceRegistryService {
  private readonly connectors = new Map<string, MarketplaceFeedbackSourceConnector>();

  register(connector: MarketplaceFeedbackSourceConnector): void {
    const key = this.key(connector.marketplace, connector.sourceKey);
    if (this.connectors.has(key)) throw new ConflictException(`Feedback source already registered: ${key}`);
    this.connectors.set(key, connector);
  }

  find(marketplace: Marketplace, sourceKey: string): MarketplaceFeedbackSourceConnector | null {
    return this.connectors.get(this.key(marketplace, sourceKey)) ?? null;
  }

  get(marketplace: Marketplace, sourceKey: string): MarketplaceFeedbackSourceConnector {
    const connector = this.find(marketplace, sourceKey);
    if (!connector) throw new NotFoundException(`Feedback source connector unavailable: ${marketplace}/${sourceKey}`);
    return connector;
  }

  forMarketplace(marketplace: Marketplace): MarketplaceFeedbackSourceConnector[] {
    return [...this.connectors.values()].filter((connector) => connector.marketplace === marketplace);
  }

  private key(marketplace: Marketplace, sourceKey: string): string {
    return `${marketplace}:${sourceKey.trim().toLowerCase()}`;
  }
}
