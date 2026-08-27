import { DataSource } from 'typeorm';
import {
  getCanonicalSchemaCapabilities,
  resetCanonicalSchemaCapabilities,
} from '../common/utils/canonical-channel-payment';
import { CanonicalChannelPaymentSchemaService } from './canonical-channel-payment-schema.service';

describe('CanonicalChannelPaymentSchemaService', () => {
  afterEach(() => resetCanonicalSchemaCapabilities());

  it('detects canonical and marketplace profiles from metadata only', async () => {
    const query = jest.fn().mockResolvedValue([{
      settings_table: true,
      rules_table: true,
      backfill_runs_table: true,
      backfill_snapshots_table: true,
      resolver_function: true,
      order_columns: 19,
      marketplace_accounts_table: true,
      marketplace_sync_runs_table: true,
      marketplace_raw_entities_table: true,
      marketplace_feedback_sources_table: true,
      marketplace_feedback_capabilities_table: true,
      marketplace_review_insights_table: true,
    }]);
    const service = new CanonicalChannelPaymentSchemaService(
      { query } as unknown as DataSource,
    );

    const result = await service.refresh();

    expect(result.schemaAvailable).toBe(true);
    expect(result.marketplaceSchema20Available).toBe(true);
    expect(result.marketplaceSchema21Available).toBe(true);
    expect(query.mock.calls[0][0]).toContain('information_schema.columns');
    expect(query.mock.calls[0][0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  });

  it('fails closed to legacy mode when metadata inspection fails', async () => {
    const service = new CanonicalChannelPaymentSchemaService(
      { query: jest.fn().mockRejectedValue(new Error('offline')) } as unknown as DataSource,
    );

    await service.refresh();

    expect(getCanonicalSchemaCapabilities().schemaAvailable).toBe(false);
    expect(service.supportsCanonicalOrderIngest()).toBe(false);
  });
});
