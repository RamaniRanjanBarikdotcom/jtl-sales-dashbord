/**
 * TanStack Query hooks for the Marketing module.
 * Plan Section 9:  GET /api/marketing/{kpis, channels, campaigns, roas-trend}
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";
import { CAMPAIGNS, SPEND_HISTORY } from "@/lib/mock-data";

const HAS_API = () => !!process.env.NEXT_PUBLIC_API_URL;

export interface MarketingKpis {
    totalSpend:       number;
    blendedRoas:      number;
    avgCpa:           number;
    totalConversions: number;
}

const MOCK_MKPIS: MarketingKpis = {
    totalSpend:       CAMPAIGNS.reduce((s, c) => s + c.spend, 0),
    blendedRoas:      +(CAMPAIGNS.reduce((s, c) => s + c.roas, 0) / CAMPAIGNS.length).toFixed(2),
    avgCpa:           Math.round(CAMPAIGNS.reduce((s, c) => s + c.cpa, 0) / CAMPAIGNS.length),
    totalConversions: CAMPAIGNS.reduce((s, c) => s + c.conversions, 0),
};

export function useMarketingKpis() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['marketing', 'kpis', toParams().toString()],
        queryFn: async (): Promise<MarketingKpis> => {
            if (!HAS_API()) return MOCK_MKPIS;
            const res = await api.get(`/marketing/kpis?${toParams()}`);
            return res.data.data;
        },
        placeholderData:MOCK_MKPIS,
        staleTime: 30 * 60 * 1000,
    });
}

export function useMarketingChannels() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['marketing', 'channels', toParams().toString()],
        queryFn: async () => {
            if (!HAS_API()) return SPEND_HISTORY;
            const res = await api.get(`/marketing/channels?${toParams()}`);
            return res.data.data;
        },
        placeholderData:SPEND_HISTORY,
        staleTime: 30 * 60 * 1000,
    });
}

export function useMarketingCampaigns() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['marketing', 'campaigns', toParams().toString()],
        queryFn: async () => {
            if (!HAS_API()) return CAMPAIGNS;
            const res = await api.get(`/marketing/campaigns?${toParams()}`);
            const payload = res.data?.data;
            if (Array.isArray(payload)) return payload;
            return payload?.rows ?? [];
        },
        placeholderData:CAMPAIGNS,
        staleTime: 30 * 60 * 1000,
    });
}

export function useMarketingRoasTrend() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['marketing', 'roas-trend', toParams().toString()],
        queryFn: async () => {
            if (!HAS_API()) return SPEND_HISTORY;
            const res = await api.get(`/marketing/roas-trend?${toParams()}`);
            return res.data.data;
        },
        placeholderData:SPEND_HISTORY,
        staleTime: 30 * 60 * 1000,
    });
}
