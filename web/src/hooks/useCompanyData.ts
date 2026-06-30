"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthedQuery as useQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";
import { CompanySummary, useStore } from "@/lib/store";

function unwrapCompanies(raw: any): CompanySummary[] {
    const data = raw?.data ?? raw ?? {};
    const companies = Array.isArray(data.companies) ? data.companies : [];
    return companies.map((company: any) => ({
        tenantId: String(company.tenantId ?? company.tenant_id ?? ""),
        membershipId: company.membershipId ?? company.membership_id ?? null,
        name: String(company.name ?? company.slug ?? "Company"),
        slug: company.slug ?? null,
        role: String(company.role ?? "viewer"),
        userLevel: company.userLevel ?? company.user_level ?? null,
        permissions: Array.isArray(company.permissions) ? company.permissions.map(String) : [],
    })).filter((company: CompanySummary) => company.tenantId);
}

export function useCompanies(enabled = true) {
    const setCompanies = useStore((state) => state.setCompanies);
    const session = useStore((state) => state.session);
    return useQuery({
        queryKey: ["auth", "companies", session?.sub ?? "anonymous"],
        enabled,
        queryFn: async () => {
            const res = await api.get("/me/tenants");
            const companies = unwrapCompanies(res.data);
            setCompanies(companies);
            return companies;
        },
        staleTime: 60_000,
    });
}

export function useSwitchCompany() {
    const qc = useQueryClient();
    const setToken = useStore((state) => state.setToken);
    const setCurrentCompany = useStore((state) => state.setCurrentCompany);
    return useMutation({
        mutationFn: async (tenantId: string): Promise<CompanySummary | null> => {
            const res = await api.post("/me/switch-tenant", { tenantId });
            const data = res.data?.data ?? res.data ?? {};
            if (data.accessToken) setToken(data.accessToken);
            const currentCompany = data.currentCompany
                ? unwrapCompanies({ companies: [data.currentCompany] })[0] ?? null
                : null;
            setCurrentCompany(currentCompany);
            return currentCompany;
        },
        onSuccess: () => {
            qc.invalidateQueries();
        },
    });
}
