import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const eur = (n: number) => {
    if (n >= 1e6) return `€${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `€${(n / 1e3).toFixed(0)}K`;
    return `€${n}`;
};

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
