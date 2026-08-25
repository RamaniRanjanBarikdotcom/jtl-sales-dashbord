import { Marketplace } from '../core/marketplace.enum';

export type MarketplaceWorkload = 'realtime' | 'bulk' | 'financial';

export function marketplaceQueueName(marketplace: Marketplace, workload: MarketplaceWorkload): string {
  return `mp.${marketplace.toLowerCase()}.${workload}`;
}

export const MARKETPLACE_CONTROL_QUEUES = {
  webhooks: 'mp.webhooks',
  reconciliation: 'mp.reconciliation',
  projections: 'mp.projections',
  control: 'mp.control',
} as const;
