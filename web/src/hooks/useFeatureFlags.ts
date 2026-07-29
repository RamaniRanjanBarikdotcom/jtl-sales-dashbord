"use client";

import { useAuthedQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";

export function useFeatureFlags() {
  return useAuthedQuery({
    queryKey: ["platform-feature-flags"],
    queryFn: async (): Promise<Record<string,boolean>> =>
      (await api.get("/features")).data.data ?? {},
    staleTime: 60_000,
  });
}
