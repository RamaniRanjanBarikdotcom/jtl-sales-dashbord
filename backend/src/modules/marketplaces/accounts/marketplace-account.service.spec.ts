import { ConflictException, NotFoundException } from '@nestjs/common';
import { MarketplaceAccountService } from './marketplace-account.service';
import { Marketplace } from '../core/marketplace.enum';

describe('MarketplaceAccountService tenant isolation', () => {
  const accounts = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
  };
  const credentials = { findOne: jest.fn(), save: jest.fn(), create: jest.fn((value) => value) };
  const cursors = { findOne: jest.fn(), save: jest.fn(), create: jest.fn((value) => value) };
  const runs = { find: jest.fn(), save: jest.fn(), create: jest.fn((value) => value), manager: { query: jest.fn() } };
  const features = { assertApiEnabled: jest.fn(), assertQueueEnabled: jest.fn() };
  const service = new MarketplaceAccountService(
    accounts as never,
    credentials as never,
    cursors as never,
    runs as never,
    { encrypt: jest.fn(), currentKeyId: jest.fn() } as never,
    {} as never,
    {} as never,
    features as never,
    { log: jest.fn() } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('lists only accounts belonging to the resolved tenant', async () => {
    accounts.find.mockResolvedValue([]);
    await service.list('tenant-a');
    expect(accounts.find).toHaveBeenCalledWith(expect.objectContaining({ where: { tenant_id: 'tenant-a' } }));
  });

  it('never updates an account found only in another tenant', async () => {
    accounts.findOne.mockResolvedValue(null);
    await expect(service.update('tenant-a', 'actor-a', 'account-b', { displayName: 'Blocked' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.findOne).toHaveBeenCalledWith({ where: { id: 'account-b', tenant_id: 'tenant-a' } });
    expect(accounts.save).not.toHaveBeenCalled();
  });

  it('requires client ID and client secret for Amazon accounts', async () => {
    await expect(service.create('tenant-a', 'actor-a', {
      marketplace: Marketplace.AMAZON,
      displayName: 'Amazon Germany',
      credentials: { clientId: 'client-only' },
    })).rejects.toBeInstanceOf(ConflictException);
    expect(accounts.save).not.toHaveBeenCalled();
  });
});
