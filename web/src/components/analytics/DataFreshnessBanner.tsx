"use client";

import api from "@/lib/api";
import { DS } from "@/lib/design-system";
import { useAuthedQuery } from "@/lib/react-query-auth";
import { useStore } from "@/lib/store";

type Freshness = {
  last_order_sync?: string | null;
  last_product_sync?: string | null;
  last_inventory_sync?: string | null;
  last_aggregate_refresh?: string | null;
};

function label(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Never synced";
}

export function DataFreshnessBanner() {
  const tenantId = useStore((state) => state.currentCompany?.tenantId);
  const scope = useStore((state) => state.tenantScope);
  const query = useAuthedQuery({
    queryKey: ["analytics", "freshness", tenantId, scope],
    queryFn: async (): Promise<Freshness> => (await api.get("/analytics/freshness")).data.data,
    staleTime: 60_000,
  });
  const data = query.data || {};
  const orderTime = data.last_order_sync ? new Date(data.last_order_sync).getTime() : 0;
  const inventoryTime = data.last_inventory_sync ? new Date(data.last_inventory_sync).getTime() : 0;
  const inventoryBehind = orderTime > 0 && inventoryTime > 0 && orderTime - inventoryTime > 30 * 60 * 1000;

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", border: `1px solid ${inventoryBehind ? `${DS.amber}55` : DS.border}`, borderRadius: 9, background: inventoryBehind ? `${DS.amber}0a` : "rgba(255,255,255,0.018)", color: DS.lo, fontSize: 10 }}>
      <strong style={{ color: DS.mid }}>Data freshness</strong>
      <span>Orders: {label(data.last_order_sync)}</span>
      <span>Products: {label(data.last_product_sync)}</span>
      <span>Inventory: {label(data.last_inventory_sync)}</span>
      <span>Aggregates: {label(data.last_aggregate_refresh)}</span>
      {inventoryBehind && <strong style={{ color: DS.amber }}>Inventory is older than sales data. Cross-domain results may temporarily be inconsistent.</strong>}
    </div>
  );
}
