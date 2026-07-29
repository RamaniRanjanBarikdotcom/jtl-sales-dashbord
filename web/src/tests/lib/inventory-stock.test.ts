import { describe, expect, it } from "vitest";

import { normalizeInventoryRow } from "@/hooks/useInventoryData";

describe("normalizeInventoryRow", () => {
    it("keeps the numeric compatibility field and exposes canonical stock values", () => {
        const row = normalizeInventoryRow({
            id: 7,
            total_available: "5",
            available_stock: "3",
            total_reserved: "2",
        });

        expect(row.stock).toBe(5);
        expect(row.stock_quantity).toBe(5);
        expect(row.inventoryStock).toEqual({
            totalStock: 5,
            availableStock: 3,
            reservedStock: 2,
        });
    });

    it("falls back to legacy stock when canonical total is absent", () => {
        const row = normalizeInventoryRow({ stock: "4" });

        expect(row.stock).toBe(4);
        expect(row.inventoryStock.totalStock).toBe(4);
    });
});
