"use client";

import { useCallback, useState } from "react";
import { useAuthedQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";

export interface CopilotMessage {
    role: "user" | "assistant";
    content: string;
    citations?: Array<Record<string, unknown>>;
}

export interface CopilotStatus {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    reason: "FEATURE_DISABLED" | "NOT_CONFIGURED" | null;
}

// Server errors are deliberately masked to "Internal server error", so the
// reason has to come from the status endpoint rather than the failed request.
const UNAVAILABLE: Record<string, string> = {
    FEATURE_DISABLED: "Analytics Copilot is switched off. An administrator can enable it in the platform settings.",
    NOT_CONFIGURED: "Analytics Copilot is enabled but has no AI provider configured yet.",
};

export function useCopilotStatus() {
    return useAuthedQuery({
        queryKey: ["copilot-status"],
        queryFn: async (): Promise<CopilotStatus> => (await api.get("/ai/analytics/status")).data.data,
        staleTime: 60_000,
    });
}

export function useCopilotChat() {
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<CopilotMessage[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const { data: status } = useCopilotStatus();

    const ask = useCallback(async (question: string) => {
        const asked = question.trim();
        if (!asked || busy) return;
        if (status && !status.ready) {
            setError(UNAVAILABLE[status.reason ?? ""] ?? "Analytics Copilot is unavailable.");
            return;
        }
        setBusy(true);
        setError("");
        setMessages((items) => [...items, { role: "user", content: asked }]);
        try {
            let id = conversationId;
            if (!id) {
                const created = await api.post("/ai/analytics/conversations", { title: asked.slice(0, 80) });
                id = created.data.data.id as string;
                setConversationId(id);
            }
            const response = await api.post("/ai/analytics/ask", { conversationId: id, question: asked });
            const result = response.data.data;
            setMessages((items) => [...items, {
                role: "assistant",
                content: result.message.content,
                citations: result.citations ?? [],
            }]);
        } catch (cause: any) {
            const masked = cause?.response?.status >= 500;
            setError(
                (!masked && cause?.response?.data?.message) ||
                "The Copilot could not answer that. Please try again.",
            );
        } finally {
            setBusy(false);
        }
    }, [busy, conversationId, status]);

    const reset = useCallback(() => {
        setConversationId(null);
        setMessages([]);
        setError("");
    }, []);

    return { messages, busy, error, ask, reset, conversationId, status };
}
