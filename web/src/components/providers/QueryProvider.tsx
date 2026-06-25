"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [client] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime:          5 * 60 * 1000,   // 5 min — won't refetch if fresh
                        gcTime:            30 * 60 * 1000,   // 30 min — keep cache across nav
                        retry:              1,
                        refetchOnWindowFocus: false,
                    },
                },
            })
    );

    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
