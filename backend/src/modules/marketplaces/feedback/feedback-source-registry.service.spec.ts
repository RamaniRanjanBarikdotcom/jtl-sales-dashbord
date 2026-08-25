import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../core/marketplace.enum';
import { FeedbackSourceRegistryService } from './feedback-source-registry.service';
import { MarketplaceFeedbackSourceType } from './marketplace-feedback.types';

describe('FeedbackSourceRegistryService', () => {
  it('keeps independent source connectors per marketplace', () => {
    const registry = new FeedbackSourceRegistryService();
    const amazon = { sourceKey: 'official', marketplace: Marketplace.AMAZON,
      sourceType: MarketplaceFeedbackSourceType.OFFICIAL_API, testConnection: jest.fn(), discoverCapabilities: jest.fn() };
    const ebay = { ...amazon, marketplace: Marketplace.EBAY };
    registry.register(amazon);
    registry.register(ebay);

    expect(registry.get(Marketplace.AMAZON, 'official')).toBe(amazon);
    expect(registry.get(Marketplace.EBAY, 'official')).toBe(ebay);
    expect(registry.forMarketplace(Marketplace.AMAZON)).toEqual([amazon]);
  });

  it('rejects ambiguous duplicate source registrations', () => {
    const registry = new FeedbackSourceRegistryService();
    const connector = { sourceKey: 'official', marketplace: Marketplace.AMAZON,
      sourceType: MarketplaceFeedbackSourceType.OFFICIAL_API, testConnection: jest.fn(), discoverCapabilities: jest.fn() };
    registry.register(connector);
    expect(() => registry.register(connector)).toThrow(ConflictException);
    expect(() => registry.get(Marketplace.AMAZON, 'missing')).toThrow(NotFoundException);
  });
});
