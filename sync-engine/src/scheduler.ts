import * as cron from 'node-cron';
import { config } from './config';
import { moduleLogger } from './utils/logger';
import { engineState, setModuleStatus, notifyStateChange } from './utils/state';
import { checkIdleAndSync } from './utils/activity-checker';
import { OrdersExtractor }    from './extractors/orders.extractor';
import { ProductsExtractor }  from './extractors/products.extractor';
import { CustomersExtractor } from './extractors/customers.extractor';
import { InventoryExtractor } from './extractors/inventory.extractor';

const log = moduleLogger('scheduler');

const running: Record<string, boolean> = {
    orders: false, products: false, customers: false, inventory: false,
};

async function runSafe(module: string, fn: () => Promise<void>): Promise<void> {
    if (running[module]) {
        log.warn(`[CRON  ] ${module} — SKIPPED (previous run still in progress)`);
        return;
    }
    running[module] = true;
    log.info(`[CRON  ] ${module} — job started`);
    const t0 = Date.now();
    try {
        await fn();
        log.info(`[CRON  ] ${module} — job finished in ${Date.now() - t0}ms`);
    } catch (err: any) {
        log.error(`[CRON  ] ${module} — job FAILED after ${Date.now() - t0}ms: ${err.message}`);
    } finally {
        running[module] = false;
    }
}

export function startScheduler(): void {
    log.info('[CRON  ] Registering all cron jobs…');

    // ── Orders (every 15 min) ────────────────────────────────────────────────
    cron.schedule(config.cron.orders, () => {
        log.info(`[CRON  ] ⏰ orders tick — ${new Date().toISOString()}`);
        runSafe('orders', () => new OrdersExtractor().run().then());
    });
    log.info(`[CRON  ]   orders    → "${config.cron.orders}"`);

    // ── Inventory (every 30 min) ─────────────────────────────────────────────
    cron.schedule(config.cron.inventory, () => {
        log.info(`[CRON  ] ⏰ inventory tick — ${new Date().toISOString()}`);
        runSafe('inventory', () => new InventoryExtractor().run().then());
    });
    log.info(`[CRON  ]   inventory → "${config.cron.inventory}"`);

    // ── Products (hourly at :05) ─────────────────────────────────────────────
    cron.schedule(config.cron.products, () => {
        log.info(`[CRON  ] ⏰ products tick — ${new Date().toISOString()}`);
        runSafe('products', () => new ProductsExtractor().run().then());
    });
    log.info(`[CRON  ]   products  → "${config.cron.products}"`);

    // ── Customers (top of every hour) ────────────────────────────────────────
    cron.schedule(config.cron.customers, () => {
        log.info(`[CRON  ] ⏰ customers tick — ${new Date().toISOString()}`);
        runSafe('customers', () => new CustomersExtractor().run().then());
    });
    log.info(`[CRON  ]   customers → "${config.cron.customers}"`);

    // ── Full resync (Sunday 03:00) ────────────────────────────────────────────
    cron.schedule(config.cron.fullResync, () => {
        log.info(`[CRON  ] ⏰ FULL RESYNC triggered (weekly) — ${new Date().toISOString()}`);
        runFullSync();
    });
    log.info(`[CRON  ]   fullResync → "${config.cron.fullResync}"`);

    // ── Idle watcher ─────────────────────────────────────────────────────────
    const idleCron = `*/${config.idle.checkIntervalMinutes} * * * *`;
    cron.schedule(idleCron, () => {
        log.info(`[IDLE  ] Checking dashboard activity — ${new Date().toISOString()}`);
        checkIdleAndSync(runFullSync);
    });
    log.info(`[CRON  ]   idleCheck → every ${config.idle.checkIntervalMinutes} min`);

    log.info('[CRON  ] All cron jobs registered ✓');
}

export async function runFullSync(): Promise<void> {
    log.info('[FULL  ] ══ Full sync START ══════════════════════════');
    const t0 = Date.now();
    const results = await Promise.allSettled([
        runSafe('orders',    () => new OrdersExtractor().run().then()),
        runSafe('products',  () => new ProductsExtractor().run().then()),
        runSafe('customers', () => new CustomersExtractor().run().then()),
        runSafe('inventory', () => new InventoryExtractor().run().then()),
    ]);
    const ok  = results.filter(r => r.status === 'fulfilled').length;
    const err = results.filter(r => r.status === 'rejected').length;
    log.info(`[FULL  ] ══ Full sync DONE — ${ok} ok / ${err} failed / ${Date.now() - t0}ms`);
}

export async function triggerModule(module: string): Promise<void> {
    log.info(`[MANUAL] Manual trigger — module=${module}`);
    const map: Record<string, () => Promise<void>> = {
        orders:    () => new OrdersExtractor().run().then(),
        products:  () => new ProductsExtractor().run().then(),
        customers: () => new CustomersExtractor().run().then(),
        inventory: () => new InventoryExtractor().run().then(),
    };
    if (!map[module]) throw new Error(`Unknown module: ${module}`);
    await runSafe(module, map[module]);
}
