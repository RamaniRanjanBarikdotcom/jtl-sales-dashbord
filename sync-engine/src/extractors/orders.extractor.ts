import { BaseExtractor } from './base.extractor';
import { queryOrders, queryOrderItems } from '../mssql/queries/orders.query';
import { config } from '../config';

export class OrdersExtractor extends BaseExtractor {
    constructor() { super('orders'); }

    protected async fetchRows(lastSyncTime: Date, syncEndTime: Date): Promise<any[]> {
        const allRows: any[] = [];
        let offset = 0;

        while (true) {
            const orders = await queryOrders(lastSyncTime, syncEndTime, offset, config.batchSize);
            if (orders.length === 0) break;

            // Fetch order items for this batch
            const orderIds = orders.map(o => o.kBestellung);
            const items = await queryOrderItems(orderIds);

            // Attach items to each order
            const itemsByOrder = new Map<number, any[]>();
            for (const item of items) {
                if (!itemsByOrder.has(item.kBestellung)) itemsByOrder.set(item.kBestellung, []);
                itemsByOrder.get(item.kBestellung)!.push(item);
            }

            for (const order of orders) {
                allRows.push({ ...order, items: itemsByOrder.get(order.kBestellung) || [] });
            }

            offset += orders.length;
            if (orders.length < config.batchSize) break;
        }

        return allRows;
    }
}
