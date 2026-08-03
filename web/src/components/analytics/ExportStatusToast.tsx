"use client";

import { useEffect, useRef, useState } from "react";
import { EXPORT_STATUS_EVENT, type ExportStatus } from "@/lib/export";

export function ExportStatusToast() {
    const [status, setStatus] = useState<ExportStatus | null>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const onStatus = (event: Event) => {
            const detail = (event as CustomEvent<ExportStatus>).detail;
            if (!detail) return;
            if (timerRef.current) window.clearTimeout(timerRef.current);
            setStatus(detail);
            if (detail.state !== "preparing") {
                timerRef.current = window.setTimeout(() => setStatus(null), detail.state === "error" ? 8_000 : 5_000);
            }
        };
        window.addEventListener(EXPORT_STATUS_EVENT, onStatus);
        return () => {
            window.removeEventListener(EXPORT_STATUS_EVENT, onStatus);
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, []);

    if (!status) return null;

    return (
        <div className={`export-status export-status--${status.state}`} role={status.state === "error" ? "alert" : "status"} aria-live="polite">
            <span className="export-status__icon" aria-hidden="true">
                {status.state === "preparing" ? "⇩" : status.state === "success" ? "✓" : "!"}
            </span>
            <div>
                <strong>{status.state === "preparing" ? "Preparing download" : status.state === "success" ? "Download ready" : "Download failed"}</strong>
                <p>{status.message}</p>
            </div>
            {status.state !== "preparing" && <button type="button" onClick={() => setStatus(null)} aria-label="Dismiss export notification">×</button>}
        </div>
    );
}
