import { BaseExtractor } from './base.extractor';
import { queryInventory } from '../mssql/queries/inventory.query';

export class InventoryExtractor extends BaseExtractor {
    constructor() { super('inventory'); }
    // Inventory has no watermark — always full refresh; ignore time args
    protected async fetchRows(_lastSyncTime: Date, _syncEndTime: Date): Promise<any[]> {
        return queryInventory();
    }
}
