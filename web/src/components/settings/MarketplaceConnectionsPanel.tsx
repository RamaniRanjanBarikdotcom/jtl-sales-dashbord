"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import {
  MarketplaceName,
  useCreateMarketplaceAccount,
  useMarketplaceAccounts,
  useMarketplaceStatus,
  usePauseMarketplaceAccount,
  useTestMarketplaceConnection,
} from "@/hooks/useMarketplaceData";
import { DS } from "@/lib/design-system";
import { sessionHasPermission, useStore } from "@/lib/store";

const PROVIDERS: { id: MarketplaceName; label: string }[] = [
  { id: "AMAZON", label: "Amazon" }, { id: "EBAY", label: "eBay" },
  { id: "KAUFLAND", label: "Kaufland" }, { id: "OTTO", label: "Otto" },
  { id: "MEDIAMARKT", label: "MediaMarktSaturn" },
];

const control = {
  width: "100%", boxSizing: "border-box" as const, border: `1px solid ${DS.border}`,
  borderRadius: 9, background: DS.panel, color: DS.hi, padding: "9px 12px", fontFamily: "inherit", fontSize: 12,
};
const button = (color = DS.sky) => ({
  border: `1px solid ${color}55`, borderRadius: 9, background: `${color}12`, color,
  padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 650,
});

export function MarketplaceConnectionsPanel() {
  const flags = useFeatureFlags();
  const session = useStore((state) => state.session);
  const enabled = flags.data?.MARKETPLACE_ACCOUNT_API_ENABLED === true;
  const canManage = sessionHasPermission(session, "marketplaces.manage");
  const status = useMarketplaceStatus(enabled);
  const accounts = useMarketplaceAccounts(enabled);
  const createAccount = useCreateMarketplaceAccount();
  const testConnection = useTestMarketplaceConnection();
  const pauseAccount = usePauseMarketplaceAccount();
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ marketplace: "AMAZON" as MarketplaceName, displayName: "", externalMerchantId: "", regionCode: "DE", currencyCode: "EUR", clientId: "", clientSecret: "" });
  const active = useMemo(() => (accounts.data ?? []).filter((account) => account.status === "ACTIVE").length, [accounts.data]);

  if (flags.isLoading) return <Message text="Checking marketplace configuration…" />;
  if (!enabled) return <Message text="Marketplace account configuration is disabled." color={DS.amber} />;

  const save = async (event: FormEvent) => {
    event.preventDefault(); setNotice("");
    try {
      await createAccount.mutateAsync({
        marketplace: form.marketplace, displayName: form.displayName,
        externalMerchantId: form.externalMerchantId || undefined, regionCode: form.regionCode || undefined,
        currencyCode: form.currencyCode || undefined,
        credentials: { clientId: form.clientId, clientSecret: form.clientSecret },
      });
      setForm((current) => ({ ...current, displayName: "", externalMerchantId: "", clientId: "", clientSecret: "" }));
      setNotice("Marketplace account saved securely.");
    } catch (error: any) { setNotice(error?.response?.data?.message ?? "Account could not be saved."); }
  };

  const test = async (id: string) => {
    setNotice("");
    try {
      const result = await testConnection.mutateAsync(id);
      setNotice(result.success ? "Connection test passed in simulation mode." : result.errorMessage ?? "Connection test failed.");
    } catch (error: any) { setNotice(error?.response?.data?.message ?? "Connector is not available yet."); }
  };

  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <div><p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 600, color: DS.hi }}>Marketplace Connections</p>
      <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>Store tenant marketplace credentials and monitor account connection state.</p></div>
    <hr style={{ border: "none", borderTop: `1px solid ${DS.border}`, margin: 0 }} />

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(120px,1fr))", gap: 10 }}>
      <Stat label="Mode" value={status.data?.mode ?? "SHADOW"} color={DS.violet} />
      <Stat label="Accounts" value={String(accounts.data?.length ?? 0)} color={DS.sky} />
      <Stat label="Connected" value={String(active)} color={DS.emerald} />
    </div>

    {canManage && <form onSubmit={save} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, padding: 16, border: `1px solid ${DS.border}`, borderRadius: 12, background: DS.panel }}>
      <Field label="Marketplace"><select style={control} value={form.marketplace} onChange={(event) => setForm({ ...form, marketplace: event.target.value as MarketplaceName })}>{PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></Field>
      <Field label="Display name"><input required style={control} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Amazon Germany" /></Field>
      <Field label="Merchant / account ID"><input style={control} value={form.externalMerchantId} onChange={(event) => setForm({ ...form, externalMerchantId: event.target.value })} /></Field>
      <Field label="Region"><input style={control} value={form.regionCode} onChange={(event) => setForm({ ...form, regionCode: event.target.value.toUpperCase() })} /></Field>
      <Field label="Currency"><input minLength={3} maxLength={3} style={control} value={form.currencyCode} onChange={(event) => setForm({ ...form, currencyCode: event.target.value.toUpperCase() })} /></Field>
      <Field label={form.marketplace === "AMAZON" ? "Amazon Client ID" : "Client ID"}><input required autoComplete="off" style={control} value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} /></Field>
      <Field label={form.marketplace === "AMAZON" ? "Amazon Client Secret" : "Client Secret"}><input required type="password" autoComplete="new-password" style={control} value={form.clientSecret} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })} /></Field>
      <div style={{ display: "flex", alignItems: "end" }}><button type="submit" disabled={createAccount.isPending} style={button(DS.emerald)}>{createAccount.isPending ? "Saving…" : "Save encrypted connection"}</button></div>
      {form.marketplace === "AMAZON" && <p style={{ gridColumn: "1 / -1", margin: 0, color: DS.amber, fontSize: 10, lineHeight: 1.5 }}>Client ID and Client Secret are stored encrypted. Live Amazon SP-API access additionally requires seller authorization and a refresh token; current tests are simulation-only.</p>}
    </form>}

    {notice && <Message text={notice} color={notice.includes("passed") || notice.includes("saved") ? DS.emerald : DS.amber} />}

    <div style={{ display: "grid", gap: 9 }}>
      {!accounts.data?.length ? <Message text="No marketplace connections configured for this company." /> : accounts.data.map((account) => <div key={account.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px,2fr) repeat(3,minmax(90px,1fr)) auto", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, border: `1px solid ${DS.border}` }}>
        <div><div style={{ color: DS.hi, fontSize: 13, fontWeight: 650 }}>{account.displayName}</div><div style={{ color: DS.lo, fontSize: 10, marginTop: 3 }}>{account.marketplace} · {account.externalMerchantId || "No merchant ID"}</div></div>
        <Cell label="Region" value={account.regionCode || "—"} /><Cell label="Status" value={account.status} /><Cell label="Last test" value={account.lastConnectionStatus || "Not tested"} />
        {canManage && <div style={{ display: "flex", gap: 6 }}><button type="button" style={button()} onClick={() => test(account.id)}>Test</button><button type="button" style={button(DS.amber)} onClick={() => pauseAccount.mutate({ accountId: account.id, paused: account.status !== "PAUSED" })}>{account.status === "PAUSED" ? "Resume" : "Pause"}</button></div>}
      </div>)}
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ color: DS.lo, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}<div style={{ marginTop: 6 }}>{children}</div></label>; }
function Stat({ label, value, color }: { label: string; value: string; color: string }) { return <div style={{ padding: 12, border: `1px solid ${DS.border}`, borderTop: `2px solid ${color}`, borderRadius: 10 }}><div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase" }}>{label}</div><div style={{ color, marginTop: 4, fontSize: 18 }}>{value}</div></div>; }
function Cell({ label, value }: { label: string; value: string }) { return <div><div style={{ color: DS.lo, fontSize: 8, textTransform: "uppercase" }}>{label}</div><div style={{ color: DS.hi, fontSize: 11, marginTop: 4 }}>{value}</div></div>; }
function Message({ text, color = DS.lo }: { text: string; color?: string }) { return <div style={{ padding: 13, borderRadius: 10, border: `1px solid ${color}33`, background: `${color}08`, color, fontSize: 11 }}>{text}</div>; }
