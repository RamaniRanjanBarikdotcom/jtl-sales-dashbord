"use client";

import { useStore } from "@/lib/store";

export function PermissionGate({ roles, children, fallback = null }: {
    roles: string[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
}) {
    const { session } = useStore();
    if (!session || !roles.includes(session.role)) return <>{fallback}</>;
    return <>{children}</>;
}
