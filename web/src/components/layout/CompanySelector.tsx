"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanies, useSwitchCompany } from "@/hooks/useCompanyData";
import { DS } from "@/lib/design-system";
import { useStore } from "@/lib/store";

export function CompanySelector() {
    const session = useStore((state) => state.session);
    const storedCompanies = useStore((state) => state.companies);
    const currentCompany = useStore((state) => state.currentCompany);
    const setCompanies = useStore((state) => state.setCompanies);
    const tenantScope = useStore((state) => state.tenantScope);
    const setTenantScopeMode = useStore((state) => state.setTenantScopeMode);
    const companiesQ = useCompanies(Boolean(session));
    const switchCompany = useSwitchCompany();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);

    const isSuperAdmin = Boolean(session?.isSuperAdmin);
    const isAllScope = tenantScope === "all";
    const companies = companiesQ.data?.length ? companiesQ.data : storedCompanies;
    const active = useMemo(
        () => currentCompany
            ?? companies.find((company) => company.tenantId === session?.tenantId)
            ?? companies[0]
            ?? null,
        [companies, currentCompany, session?.tenantId],
    );

    useEffect(() => {
        if (!companies.length) return;
        setCompanies(companies, active ?? null);
    }, [active, companies, setCompanies]);

    // Super admin always sees the switcher (they have the "All Companies" option);
    // a regular user only sees it when they belong to more than one company.
    if (!session) return null;
    if (!isSuperAdmin && companies.length <= 1) return null;

    const selectAllCompanies = () => {
        setTenantScopeMode("all");
        queryClient.invalidateQueries();
        setOpen(false);
    };

    const buttonLabel = isAllScope ? "All Companies" : (active?.name ?? "Select company");

    return (
        <div style={{ position: "relative", flexShrink: 0 }}>
            <button
                onClick={() => setOpen((value) => !value)}
                disabled={switchCompany.isPending}
                aria-label="Switch company"
                style={{
                    minWidth: 170,
                    maxWidth: 230,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    background: open ? "rgba(56,189,248,0.10)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${open ? DS.sky + "66" : DS.border}`,
                    borderRadius: 9,
                    padding: "5px 10px",
                    color: DS.hi,
                    cursor: switchCompany.isPending ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    opacity: switchCompany.isPending ? 0.7 : 1,
                }}
            >
                <span style={{ fontSize: 12, color: isAllScope ? DS.amber : DS.sky }}>{isAllScope ? "⊞" : "▣"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", fontSize: 11, fontWeight: 700 }}>
                    {buttonLabel}
                </span>
                <span style={{ fontSize: 9, color: DS.lo }}>{open ? "▲" : "▼"}</span>
            </button>

            {open && (
                <div style={{
                    position: "absolute",
                    top: "calc(100% + 7px)",
                    right: 0,
                    width: 260,
                    background: "rgba(7,10,24,0.98)",
                    border: `1px solid ${DS.border}`,
                    borderRadius: 12,
                    padding: 8,
                    backdropFilter: "blur(20px)",
                    zIndex: 320,
                    boxShadow: "0 14px 42px rgba(0,0,0,0.68)",
                }}>
                    <div style={{ padding: "6px 8px 8px", borderBottom: `1px solid ${DS.border}`, marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>Company Context</div>
                    </div>
                    {isSuperAdmin && (
                        <button
                            onClick={selectAllCompanies}
                            style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                                border: "none",
                                borderRadius: 8,
                                background: isAllScope ? "rgba(245,158,11,0.14)" : "transparent",
                                color: isAllScope ? DS.amber : DS.hi,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                padding: "8px 9px",
                                textAlign: "left",
                                marginBottom: 4,
                            }}
                        >
                            <span style={{ minWidth: 0 }}>
                                <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>All Companies</span>
                                <span style={{ display: "block", fontSize: 9, color: DS.lo, marginTop: 2 }}>Combined data across every company</span>
                            </span>
                            <span style={{ fontSize: 11 }}>{isAllScope ? "✓" : "⊞"}</span>
                        </button>
                    )}
                    {companies.map((company) => {
                        const selected = !isAllScope && company.tenantId === active?.tenantId;
                        return (
                            <button
                                key={company.tenantId}
                                onClick={async () => {
                                    if (selected) {
                                        setOpen(false);
                                        return;
                                    }
                                    await switchCompany.mutateAsync(company.tenantId);
                                    setOpen(false);
                                }}
                                style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    border: "none",
                                    borderRadius: 8,
                                    background: selected ? "rgba(56,189,248,0.13)" : "transparent",
                                    color: selected ? DS.sky : DS.hi,
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    padding: "8px 9px",
                                    textAlign: "left",
                                }}
                            >
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ display: "block", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {company.name}
                                    </span>
                                    <span style={{ display: "block", fontSize: 9, color: DS.lo, marginTop: 2 }}>
                                        {company.role === "super_admin" ? "Super admin access" : company.role}
                                    </span>
                                </span>
                                <span style={{ fontSize: 11 }}>{selected ? "✓" : "↔"}</span>
                            </button>
                        );
                    })}
                    {switchCompany.isError && (
                        <div style={{ marginTop: 6, padding: "6px 8px", color: DS.rose, fontSize: 10 }}>
                            Company switch failed. Please retry.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
