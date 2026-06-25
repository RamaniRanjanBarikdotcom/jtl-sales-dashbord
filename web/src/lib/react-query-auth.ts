"use client";

import {
    useQuery as useTanstackQuery,
    type UseQueryOptions,
    type UseQueryResult,
    type QueryKey,
} from "@tanstack/react-query";
import { useStore } from "@/lib/store";

export function useAuthedQuery<
    TQueryFnData = unknown,
    TError = Error,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
>(
    options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
    const authReady = useStore((state) => state.authReady);
    const session = useStore((state) => state.session);
    const requestedEnabled = options.enabled ?? true;

    return useTanstackQuery({
        ...options,
        enabled: Boolean(requestedEnabled && authReady && session),
    });
}
