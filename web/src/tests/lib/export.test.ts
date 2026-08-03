import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api module
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/store', () => ({
  sessionHasPermission: (session: { permissions?: string[] } | null, permission: string) =>
    Boolean(session?.permissions?.includes(permission)),
  useStore: {
    getState: () => ({
      session: {
        permissions: ['sales.export', 'products.export', 'inventory.export', 'customers.export'],
        isSuperAdmin: false,
      },
    }),
  },
  useFilterStore: {
    getState: () => ({
      toParams: () => new URLSearchParams({ range: 'ALL' }),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Keep the native URL constructor intact; only mock blob URL helpers.
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn().mockReturnValue('blob:test'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
  document.body.innerHTML = '';
});

describe('exportProductsCsv', () => {
  it('builds correct URL with search filter', async () => {
    const api = (await import('@/lib/api')).default;
    (api.get as any).mockResolvedValue({ data: new Blob(['csv data']) });

    const { exportProductsCsv } = await import('@/lib/export');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await exportProductsCsv({ search: 'test-product' });

    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('search=test-product'),
      expect.objectContaining({ responseType: 'blob', timeout: 300_000 })
    );
    clickSpy.mockRestore();
  });
});

describe('download delivery', () => {
  it('uses the server filename and reports successful completion', async () => {
    const api = (await import('@/lib/api')).default;
    (api.get as any).mockResolvedValue({
      data: new Blob(['sku,revenue\nABC,10'], { type: 'text/csv' }),
      headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="filtered-products.csv"' },
    });
    const statuses: Array<{ state: string; message: string }> = [];
    const listener = (event: Event) => statuses.push((event as CustomEvent).detail);
    window.addEventListener('jtl:export-status', listener);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { exportProductsCsv } = await import('@/lib/export');
    await exportProductsCsv();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(statuses.map((status) => status.state)).toEqual(['preparing', 'success']);
    expect(statuses.at(-1)?.message).toContain('filtered-products.csv');
    window.removeEventListener('jtl:export-status', listener);
    clickSpy.mockRestore();
  });
});

describe('exportCustomersCsv', () => {
  it('builds correct URL with segment filter', async () => {
    const api = (await import('@/lib/api')).default;
    (api.get as any).mockResolvedValue({ data: new Blob(['csv data']) });

    const { exportCustomersCsv } = await import('@/lib/export');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await exportCustomersCsv({ segment: 'VIP' });

    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('segment=VIP'),
      expect.objectContaining({ responseType: 'blob' })
    );
    clickSpy.mockRestore();
  });
});

describe('exportSalesCsv', () => {
  it('keeps contextual detail filters in the server export request', async () => {
    const api = (await import('@/lib/api')).default;
    (api.get as any).mockResolvedValue({ data: new Blob(['csv data']) });
    const { exportSalesCsv } = await import('@/lib/export');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await exportSalesCsv({ channel: 'Direct', shippingMethod: 'DHL', weekday: 'Mon', hour: 9 });

    const url = String((api.get as any).mock.calls.at(-1)?.[0]);
    expect(url).toContain('channel=Direct');
    expect(url).toContain('shippingMethod=DHL');
    expect(url).toContain('weekday=Mon');
    expect(url).toContain('hour=9');
    clickSpy.mockRestore();
  });
});
