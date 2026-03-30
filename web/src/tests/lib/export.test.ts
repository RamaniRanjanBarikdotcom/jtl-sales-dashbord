import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api module
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('exportProductsCsv', () => {
  beforeEach(() => {
    // Reset DOM mocks
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test'),
      revokeObjectURL: vi.fn(),
    });
    document.body.innerHTML = '';
  });

  it('builds correct URL with search filter', async () => {
    const api = (await import('@/lib/api')).default;
    (api.get as any).mockResolvedValue({ data: new Blob(['csv data']) });

    const { exportProductsCsv } = await import('@/lib/export');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await exportProductsCsv({ search: 'test-product' });

    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('search=test-product'),
      expect.objectContaining({ responseType: 'blob' })
    );
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
