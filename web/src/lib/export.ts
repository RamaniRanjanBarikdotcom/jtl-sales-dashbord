import api from "@/lib/api";
import { buildAnalyticsQueryParams, type AnalyticsQueryInput } from "@/lib/analytics-query";
import { useStore, sessionHasPermission } from "@/lib/store";

export const EXPORT_STATUS_EVENT = "jtl:export-status";

export type ExportStatus = {
    state: "preparing" | "success" | "error";
    message: string;
};

function reportExportStatus(status: ExportStatus) {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<ExportStatus>(EXPORT_STATUS_EVENT, { detail: status }));
    }
}

function assertExportPermission(permission: string) {
    const session = useStore.getState().session;
    if (!sessionHasPermission(session, permission)) {
        throw new Error("You do not have permission to export CSV data.");
    }
}

export async function downloadCsv(url: string, filename: string, permission: string) {
    try {
        assertExportPermission(permission);
        reportExportStatus({ state: "preparing", message: "Preparing the filtered CSV export…" });
        const res = await api.get(url, {
            responseType: "blob",
            timeout: 300_000,
        });
        const blob = res.data instanceof Blob
            ? res.data
            : new Blob([res.data], { type: "text/csv;charset=utf-8" });
        const contentType = String(res.headers?.["content-type"] || blob.type || "").toLowerCase();
        if (contentType && !contentType.includes("csv") && !contentType.includes("octet-stream")) {
            const message = await blob.text().catch(() => "The server did not return a CSV file.");
            throw new Error(message || "The server did not return a CSV file.");
        }

        const disposition = String(res.headers?.["content-disposition"] || "");
        const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        const quotedName = disposition.match(/filename="([^"]+)"/i)?.[1];
        const resolvedFilename = encodedName
            ? decodeURIComponent(encodedName)
            : quotedName || filename;
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = resolvedFilename;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
        reportExportStatus({
            state: "success",
            message: `${resolvedFilename} downloaded (${Math.max(1, Math.ceil(blob.size / 1024)).toLocaleString()} KB).`,
        });
    } catch (error) {
        let message = error instanceof Error ? error.message : "CSV export failed.";
        const responseBlob = (error as { response?: { data?: unknown } })?.response?.data;
        if (responseBlob instanceof Blob) {
            const body = await responseBlob.text().catch(() => "");
            if (body) {
                try {
                    const parsed = JSON.parse(body) as { message?: string | string[] };
                    message = Array.isArray(parsed.message) ? parsed.message.join(", ") : parsed.message || message;
                } catch {
                    message = body;
                }
            }
        }
        reportExportStatus({ state: "error", message });
        return;
    }
}

export function exportSalesCsv(filters?: AnalyticsQueryInput) {
    const params = buildAnalyticsQueryParams(filters);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/sales/export?${params}`, `sales-${date}.csv`, "sales.export");
}

export function exportProductsCsv(filters?: AnalyticsQueryInput) {
    const params = buildAnalyticsQueryParams(filters);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/products/export?${params}`, `products-${date}.csv`, "products.export");
}

export function exportProductIntelligenceCsv(productId: number, filters?: AnalyticsQueryInput) {
    const params = buildAnalyticsQueryParams(filters);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/products/${productId}/intelligence/export?${params}`, `product-intelligence-${productId}-${date}.csv`, "products.export");
}

export function exportInventoryCsv(filters?: AnalyticsQueryInput) {
    const params = buildAnalyticsQueryParams(filters);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/inventory/export?${params}`, `inventory-${date}.csv`, "inventory.export");
}

export function exportCustomersCsv(filters: { search?: string; segment?: string } = {}) {
    const params = buildAnalyticsQueryParams(filters);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/customers/export?${params}`, `customers-${date}.csv`, "customers.export");
}
