import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MarketplaceFeatureService } from './marketplace-feature.service';

describe('MarketplaceFeatureService schema profiles', () => {
  const config = (enabled: Record<string, boolean>) => ({ enabled: (key: string) => Boolean(enabled[key]) });
  const schema = (schema20: boolean, schema21: boolean) => ({
    current: () => ({ marketplaceSchema20Available: schema20, marketplaceSchema21Available: schema21 }),
  });

  it('returns disabled semantics without touching missing marketplace tables', () => {
    const service = new MarketplaceFeatureService(config({}) as never, schema(false, false) as never);
    expect(() => service.assertApiEnabled()).toThrow(NotFoundException);
  });

  it('fails closed when flags are enabled but schema 20 is absent', () => {
    const service = new MarketplaceFeatureService(config({
      MARKETPLACE_PLATFORM_ENABLED: true,
      MARKETPLACE_ACCOUNT_API_ENABLED: true,
    }) as never, schema(false, false) as never);
    expect(() => service.assertApiEnabled()).toThrow(ServiceUnavailableException);
  });

  it('requires schema 21 independently for feedback APIs', () => {
    const service = new MarketplaceFeatureService(config({
      MARKETPLACE_PLATFORM_ENABLED: true,
      MARKETPLACE_ACCOUNT_API_ENABLED: true,
      MARKETPLACE_REVIEWS_ENABLED: true,
    }) as never, schema(true, false) as never);
    expect(() => service.assertApiEnabled()).not.toThrow();
    expect(() => service.assertFeedbackEnabled()).toThrow(ServiceUnavailableException);
  });
});
