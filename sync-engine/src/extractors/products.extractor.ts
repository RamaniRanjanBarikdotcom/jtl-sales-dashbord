import { BaseExtractor } from './base.extractor';
import { queryProducts } from '../mssql/queries/products.query';

export class ProductsExtractor extends BaseExtractor {
    constructor() { super('products'); }
    protected async fetchRows(lastSyncTime: Date): Promise<any[]> {
        return queryProducts(lastSyncTime);
    }
}
