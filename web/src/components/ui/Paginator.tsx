"use client";

import { DS } from "@/lib/design-system";

interface PaginatorProps {
    page:         number;
    total:        number;
    limit:        number;
    onPageChange: (p: number) => void;
}

export function Paginator({ page, total, limit, onPageChange }: PaginatorProps) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    if (totalPages <= 1) return null;

    const from = (page - 1) * limit + 1;
    const to   = Math.min(page * limit, total);

    // Build visible page numbers: show up to 5 around current
    const pages: number[] = [];
    const start = Math.max(1, page - 2);
    const end   = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) pages.push(i);

    const btnBase: React.CSSProperties = {
        border: `1px solid ${DS.border}`,
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 11,
        fontFamily: "inherit",
        cursor: "pointer",
        background: "transparent",
        color: DS.mid,
        transition: "all 0.15s",
    };

    return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingTop: 14, marginTop: 4, borderTop: `1px solid ${DS.border}`,
        }}>
            <span style={{ fontSize: 11, color: DS.lo }}>
                Showing {from}–{to} of {total.toLocaleString()}
            </span>

            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={page === 1}
                    style={{ ...btnBase, opacity: page === 1 ? 0.35 : 1, cursor: page === 1 ? "not-allowed" : "pointer" }}
                >
                    ← Prev
                </button>

                {start > 1 && (
                    <>
                        <button onClick={() => onPageChange(1)} style={btnBase}>1</button>
                        {start > 2 && <span style={{ fontSize: 11, color: DS.lo, padding: "0 4px" }}>…</span>}
                    </>
                )}

                {pages.map(p => (
                    <button
                        key={p}
                        onClick={() => onPageChange(p)}
                        style={{
                            ...btnBase,
                            background:   p === page ? "rgba(56,189,248,0.12)" : "transparent",
                            color:         p === page ? DS.sky : DS.mid,
                            borderColor:   p === page ? `${DS.sky}55` : DS.border,
                            fontWeight:    p === page ? 700 : 400,
                        }}
                    >
                        {p}
                    </button>
                ))}

                {end < totalPages && (
                    <>
                        {end < totalPages - 1 && <span style={{ fontSize: 11, color: DS.lo, padding: "0 4px" }}>…</span>}
                        <button onClick={() => onPageChange(totalPages)} style={btnBase}>{totalPages}</button>
                    </>
                )}

                <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={page === totalPages}
                    style={{ ...btnBase, opacity: page === totalPages ? 0.35 : 1, cursor: page === totalPages ? "not-allowed" : "pointer" }}
                >
                    Next →
                </button>
            </div>
        </div>
    );
}
