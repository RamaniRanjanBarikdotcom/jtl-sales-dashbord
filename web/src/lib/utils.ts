import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

function toFiniteNumber(value: unknown): number {
    if (value == null) {
        return 0;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return 0;
        const cleaned = trimmed.replace(/[^\d.-]/g, "");
        if (!cleaned) return 0;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "bigint") {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    if (typeof value === "object") {
        const primitive = (value as { valueOf?: () => unknown }).valueOf?.();
        if (primitive !== undefined && primitive !== value) {
            return toFiniteNumber(primitive);
        }
        const asString = (value as { toString?: () => string }).toString?.();
        if (typeof asString === "string" && asString !== "[object Object]") {
            return toFiniteNumber(asString);
        }
    }
    return 0;
}

export const eur = (value: unknown) => {
    const n = toFiniteNumber(value);
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
};

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Safe parseFloat that always returns a finite number (0 on failure) */
export function safeFloat(v: unknown): number {
    return toFiniteNumber(v);
}

/** Safe parseInt that always returns a finite integer (0 on failure) */
export function safeInt(v: unknown): number {
    return Math.round(toFiniteNumber(v));
}

/** Safely access a string field, defaulting to fallback */
export function safeStr(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}
