import { transformOrders } from './orders.transformer';

describe('transformOrders channel and payment evidence', () => {
  it('preserves exact source evidence while retaining legacy normalized channel', () => {
    const transformed = transformOrders({
      kAuftrag: 42,
      dErstellt: '2026-08-01T10:00:00Z',
      channelName: ' Amazon.DE ',
      zahlungsartName: 'Amazon Marktplatz',
      versandartName: 'DHL Paket',
      marketplaceName: 'Amazon DE',
      marketplaceAccount: 'Account A',
      shopName: 'Store 7',
      cExterneAuftragsnummer: 'masked-by-test',
    }, '11111111-1111-4111-8111-111111111111');

    expect(transformed.channel).toBe('amazon.de');
    expect(transformed.source_platform_raw).toBe(' Amazon.DE ');
    expect(transformed.source_payment_raw).toBe('Amazon Marktplatz');
    expect(transformed.source_shipping_raw).toBe('DHL Paket');
    expect(transformed.source_marketplace_raw).toBe('Amazon DE');
    expect(transformed.source_account_raw).toBe('Account A');
    expect(transformed.source_shop_raw).toBe('Store 7');
    expect(transformed.source_external_order_raw).toBe('masked-by-test');
  });

  it('does not fabricate a raw platform when the source omits it', () => {
    const transformed = transformOrders({ kAuftrag: 43 }, '11111111-1111-4111-8111-111111111111');

    expect(transformed.channel).toBe('direct');
    expect(transformed.source_platform_raw).toBeNull();
  });
});
