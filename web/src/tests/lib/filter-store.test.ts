import { beforeEach, describe, expect, it } from 'vitest';
import { useFilterStore } from '@/lib/store';

describe('canonical dashboard filters', () => {
  beforeEach(() => {
    useFilterStore.setState({
      range: 'ALL',
      from: undefined,
      to: undefined,
      status: 'all',
      invoice: 'all',
      platform: 'all',
      salesChannel: 'all',
      paymentMethod: 'all',
      regionalLocationDimension: 'country',
      regionalLocation: 'all',
    });
  });

  it('serializes prior-period presets without stale custom dates', () => {
    useFilterStore.getState().setRange('PREVIOUS_QUARTER');
    const params = useFilterStore.getState().toParams();
    expect(params.get('range')).toBe('PREVIOUS_QUARTER');
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
  });

  it('serializes regional dimension and location together', () => {
    useFilterStore.getState().setRegionalLocationDimension('city');
    useFilterStore.getState().setRegionalLocation('Berlin');
    const params = useFilterStore.getState().toParams();
    expect(params.get('locationDimension')).toBe('city');
    expect(params.get('location')).toBe('Berlin');
  });

  it('clears every global filter without leaving stale custom dates', () => {
    useFilterStore.getState().setCustom('2026-01-01', '2026-01-31');
    useFilterStore.getState().setStatus('cancelled');
    useFilterStore.getState().setInvoice('with_invoice');
    useFilterStore.getState().setPlatform('Amazon');
    useFilterStore.getState().setSalesChannel('Marketplace');
    useFilterStore.getState().setPaymentMethod('PayPal');
    useFilterStore.getState().setRegionalLocation('Berlin');

    useFilterStore.getState().resetFilters();

    expect(useFilterStore.getState().toParams().toString()).toBe('range=ALL');
  });
});
