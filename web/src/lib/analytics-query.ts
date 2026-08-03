import { useFilterStore } from "@/lib/store";

export type AnalyticsQueryInput = URLSearchParams | string | Record<string, unknown> | undefined;

export function buildAnalyticsQueryParams(input?: AnalyticsQueryInput): URLSearchParams {
    const params = new URLSearchParams(useFilterStore.getState().toParams());
    if (!input) return params;
    if (typeof input === "string" || input instanceof URLSearchParams) {
        const override = new URLSearchParams(input.toString());
        override.forEach((value, key) => {
            if (value === "" || value === "all") params.delete(key);
            else params.set(key, value);
        });
        return params;
    }
    Object.entries(input).forEach(([key, value]) => {
        if (value == null || value === "" || value === "all") {
            params.delete(key);
        } else {
            params.set(key, String(value));
        }
    });
    return params;
}
