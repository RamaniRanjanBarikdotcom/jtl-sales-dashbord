"use client";

import { DS } from "@/lib/design-system";

const shimmer: React.CSSProperties = {
  background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.03) 100%)",
  backgroundSize: "240% 100%",
  animation: "dashShimmer 1.1s linear infinite",
};

export default function DashboardLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`@keyframes dashShimmer { 0% { background-position: 200% 0; } 100% { background-position: -40% 0; } }`}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ ...shimmer, border: `1px solid ${DS.border}`, borderRadius: 14, height: 120 }} />
        ))}
      </div>
      <div style={{ ...shimmer, border: `1px solid ${DS.border}`, borderRadius: 14, height: 260 }} />
      <div style={{ ...shimmer, border: `1px solid ${DS.border}`, borderRadius: 14, height: 340 }} />
    </div>
  );
}
