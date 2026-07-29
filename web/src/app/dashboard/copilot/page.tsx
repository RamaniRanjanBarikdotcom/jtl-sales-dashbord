"use client";

import { useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DS } from "@/lib/design-system";

type Message = { role: "user" | "assistant"; content: string; data?: Record<string, unknown> };

export default function CopilotPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ask = async () => {
    if (!question.trim() || busy) return;
    setBusy(true); setError("");
    const asked = question.trim();
    setMessages((items) => [...items, { role: "user", content: asked }]); setQuestion("");
    try {
      let id = conversationId;
      if (!id) {
        const created = await api.post("/ai/analytics/conversations", { title: asked.slice(0, 80) });
        id = created.data.data.id; setConversationId(id);
      }
      const response = await api.post("/ai/analytics/ask", { conversationId: id, question: asked });
      const result = response.data.data;
      setMessages((items) => [...items, { role: "assistant", content: result.message.content, data: result.data }]);
    } catch (cause: any) {
      setError(cause?.response?.data?.message || "Copilot is unavailable or disabled.");
    } finally { setBusy(false); }
  };
  return <Card accent={DS.violet} style={{ minHeight: 620 }}>
    <SectionHeader title="Analytics Copilot" sub="Sales analytics with tenant-safe, traceable tools" />
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 430 }}>
      {messages.length === 0 && <p style={{ color: DS.lo }}>Try: “What were yesterday&apos;s sales?”</p>}
      {messages.map((message, index) => <div key={index} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        maxWidth: "78%", padding: 12, borderRadius: 12, color: DS.hi,
        background: message.role === "user" ? "rgba(56,189,248,.12)" : "rgba(139,92,246,.12)",
        border: `1px solid ${message.role === "user" ? DS.sky : DS.violet}44` }}>
        {message.content}
        {message.data && <div style={{ color: DS.lo, fontSize: 9, marginTop: 8 }}>Includes resolved period, metric version, freshness, and query reference.</div>}
      </div>)}
      {error && <p style={{ color: DS.rose }}>{error}</p>}
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <input value={question} onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void ask(); }}
        placeholder="Ask a sales question…" maxLength={2000}
        style={{ flex: 1, background: "#090d18", border: `1px solid ${DS.border}`, borderRadius: 10, padding: 12, color: DS.hi }} />
      <button onClick={() => void ask()} disabled={busy}>{busy ? "Working…" : "Ask"}</button>
    </div>
  </Card>;
}
