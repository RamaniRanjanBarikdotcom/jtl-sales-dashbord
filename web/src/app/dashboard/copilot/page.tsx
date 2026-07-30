"use client";

import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CopilotConversation } from "@/components/copilot/CopilotConversation";
import { useCopilotChat } from "@/hooks/useCopilotChat";
import { DS } from "@/lib/design-system";

export default function CopilotPage() {
  const { messages, busy, error, ask, status } = useCopilotChat();
  const blocked = !!status && !status.ready;
  return (
    <Card accent={DS.violet} style={{ minHeight: 620, display: "flex", flexDirection: "column" }}>
      <SectionHeader title="Analytics Copilot" sub="Sales analytics with tenant-safe, traceable tools" />
      {blocked && (
        <div style={{
          background: `${DS.amber}14`, border: `1px solid ${DS.amber}44`, borderRadius: 10,
          padding: "10px 12px", color: DS.amber, fontSize: 12, marginBottom: 12,
        }}>
          {status!.reason === "FEATURE_DISABLED"
            ? "Analytics Copilot is switched off. An administrator can enable it in the platform settings."
            : "Analytics Copilot is enabled but has no AI provider configured yet."}
        </div>
      )}
      <CopilotConversation
        messages={messages} busy={busy} error={error} onAsk={ask} disabled={blocked}
      />
    </Card>
  );
}
