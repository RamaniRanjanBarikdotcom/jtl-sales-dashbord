import { BaseExtractor } from './base.extractor';
import { queryCustomers } from '../mssql/queries/customers.query';

export class CustomersExtractor extends BaseExtractor {
    constructor() { super('customers'); }
    protected async fetchRows(lastSyncTime: Date): Promise<any[]> {
        return queryCustomers(lastSyncTime);
    }
}
