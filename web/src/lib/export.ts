import api from "@/lib/api";

async function downloadCsv(url: string, filename: string) {
    const res = await api.get(url, { responseType: "blob" });
    const blob = new Blob([res.data], { type: "text/csv" });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
}

export function exportProductsCsv(filters: { search?: string; sort?: string; order?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.sort)   params.set("sort",   filters.sort);
    if (filters.order)  params.set("order",  filters.order);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/products/export?${params}`, `products-${date}.csv`);
}

export function exportCustomersCsv(filters: { search?: string; segment?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.search)  params.set("search",  filters.search);
    if (filters.segment) params.set("segment", filters.segment);
    const date = new Date().toISOString().split("T")[0];
    return downloadCsv(`/customers/export?${params}`, `customers-${date}.csv`);
}
