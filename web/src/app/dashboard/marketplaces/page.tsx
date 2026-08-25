"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  exportComparisonCsv,
  type ComparisonOptions,
  useComparisonChannelOptions,
  useComparisonChannels,
  useComparisonInventory,
  useComparisonOrders,
  useComparisonProducts,
  useComparisonSummary,
  useComparisonTrend,
  useMarketplaceReviews,
} from "@/hooks/useComparisonData";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { DS } from "@/lib/design-system";
import { sessionHasPermission, useStore } from "@/lib/store";
import {
  useMarketplaceAccounts, useMarketplaceFeedbackSummary, useMarketplaceRatingAggregates,
  useMarketplaceReviewInsights, useMarketplaceReviewTrends,
} from "@/hooks/useMarketplaceData";

const ALL_CHANNELS = "ALL";
const PAGE_SIZE = 20;
type Tab = "overview" | "orders" | "products" | "inventory" | "reviews";
type FeedbackTab = "productReviews" | "insights" | "trends" | "ratings" | "sources";

type ChannelRow = {
  channel_id: string; channel_name: string; channel_type?: string; raw_channels?: string[];
  revenue: number; orders: number; units: number; customers: number; returns: number;
  products_sold: number; average_order_value: number; revenue_change?: number | null;
};

const controlStyle = { border: `1px solid ${DS.border}`, borderRadius: 10, background: DS.panel, color: DS.hi, padding: "10px 12px", fontFamily: "inherit", fontSize: 12 };
const buttonStyle = (color = DS.sky) => ({ border: `1px solid ${color}55`, borderRadius: 9, background: `${color}12`, color, padding: "9px 13px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 650 });

export default function MarketplacesPage() {
  const flags = useFeatureFlags();
  const session = useStore((state) => state.session);
  const permitted = useStore((state) => state.can("marketplaces"));
  const enabled = flags.data?.MARKETPLACE_PLATFORM_ENABLED === true && flags.data?.COMPARISON_CHANNEL_DRILLDOWN_ENABLED === true;
  const allowed = permitted && enabled;
  const canExport = sessionHasPermission(session, "comparison.export");
  const canProducts = sessionHasPermission(session, "comparison.products.view");
  const canInventory = sessionHasPermission(session, "comparison.inventory.view");
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedChannel, setSelectedChannel] = useState(ALL_CHANNELS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [productState, setProductState] = useState<"all" | "active" | "inactive">("all");
  const [inventoryState, setInventoryState] = useState("all");
  const [sentiment, setSentiment] = useState<"all" | "positive" | "neutral" | "negative">("all");
  const [reviewFrom, setReviewFrom] = useState("");
  const [reviewTo, setReviewTo] = useState("");
  const [feedbackTab, setFeedbackTab] = useState<FeedbackTab>("productReviews");
  const [feedbackAccountId, setFeedbackAccountId] = useState<string | null>(null);
  const channelFilter = selectedChannel === ALL_CHANNELS ? undefined : selectedChannel;
  const baseOptions: ComparisonOptions = { compareMode: "previous_period", granularity: "day", channels: channelFilter };

  const channelOptionsQuery = useComparisonChannelOptions({ compareMode: "none", granularity: "day" }, allowed);
  const channelsQuery = useComparisonChannels({ compareMode: "previous_period", granularity: "day", page: 1, limit: 100, sort: "revenue", order: "desc" }, allowed && tab === "overview");
  const summaryQuery = useComparisonSummary(baseOptions, allowed && tab === "overview");
  const trendQuery = useComparisonTrend(baseOptions, allowed && tab === "overview");
  const ordersQuery = useComparisonOrders({ ...baseOptions, search: search || undefined, page, limit: PAGE_SIZE }, allowed && tab === "orders");
  const productsQuery = useComparisonProducts({ ...baseOptions, performance: channelFilter ? "with_sales" : "all", productState, search: search || undefined, sort: "revenue", order: "desc", page, limit: PAGE_SIZE }, allowed && canProducts && tab === "products");
  const inventoryQuery = useComparisonInventory({ ...baseOptions, performance: inventoryState, search: search || undefined, sort: "stockValue", order: "desc", page, limit: PAGE_SIZE }, allowed && canInventory && tab === "inventory");
  const reviewsQuery = useMarketplaceReviews({ ...baseOptions, sentiment, reviewFrom: reviewFrom || undefined, reviewTo: reviewTo || undefined, search: search || undefined, page, limit: PAGE_SIZE }, allowed && tab === "reviews");
  const accountsQuery = useMarketplaceAccounts(allowed && tab === "reviews");
  const feedbackSummaryQuery = useMarketplaceFeedbackSummary(feedbackAccountId, allowed && tab === "reviews");
  const insightQuery = useMarketplaceReviewInsights(feedbackAccountId, allowed && tab === "reviews" && feedbackTab === "insights");
  const trendQueryFeedback = useMarketplaceReviewTrends(feedbackAccountId, allowed && tab === "reviews" && feedbackTab === "trends");
  const ratingQuery = useMarketplaceRatingAggregates(feedbackAccountId, allowed && tab === "reviews" && feedbackTab === "ratings");

  const channelOptions = useMemo<ChannelRow[]>(() => channelOptionsQuery.data?.rows ?? [], [channelOptionsQuery.data]);
  const overviewChannels = useMemo<ChannelRow[]>(() => channelsQuery.data?.rows ?? [], [channelsQuery.data]);
  const selected = (overviewChannels.length ? overviewChannels : channelOptions).find((channel) => channel.channel_id === selectedChannel) ?? null;
  const title = selected?.channel_name ?? "All marketplaces & channels";
  const trend = useMemo(() => (trendQuery.data?.current ?? []).map((row: any) => ({ date: String(row.bucket ?? "").slice(0, 10), revenue: Number(row.revenue || 0) })), [trendQuery.data]);
  const activeQuery = tab === "orders" ? ordersQuery : tab === "products" ? productsQuery : tab === "inventory" ? inventoryQuery : tab === "reviews" ? reviewsQuery : summaryQuery;
  const resultTotal = Number((activeQuery.data as any)?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(resultTotal / PAGE_SIZE));

  useEffect(() => { setPage(1); }, [tab, selectedChannel, search, productState, inventoryState, sentiment, reviewFrom, reviewTo]);
  useEffect(() => { if (selectedChannel !== ALL_CHANNELS && channelOptions.length && !selected) setSelectedChannel(ALL_CHANNELS); }, [channelOptions, selected, selectedChannel]);
  useEffect(() => {
    const accounts = accountsQuery.data ?? [];
    if (!accounts.length) { setFeedbackAccountId(null); return; }
    const marketplace = String(selected?.channel_name || "").toLowerCase();
    const matched = accounts.find((account) => marketplace.includes(account.marketplace.toLowerCase()));
    if (!feedbackAccountId || !accounts.some((account) => account.id === feedbackAccountId)) setFeedbackAccountId(matched?.id ?? accounts[0].id);
  }, [accountsQuery.data, feedbackAccountId, selected]);

  if (!permitted) return <Card accent={DS.rose}><SectionHeader title="403 Access Denied" sub="You do not have marketplace analytics access" /></Card>;
  if (flags.isLoading) return <Card><SectionHeader title="Marketplace Performance" sub="Checking feature availability…" /></Card>;
  if (!enabled) return <Card accent={DS.amber}><SectionHeader title="Marketplace Performance Unavailable" sub="Marketplace analytics is disabled" /></Card>;

  const tabs: { id: Tab; label: string; allowed: boolean }[] = [
    { id: "overview", label: "Overview", allowed: true }, { id: "orders", label: "Orders", allowed: true },
    { id: "products", label: "Products", allowed: canProducts }, { id: "inventory", label: "Inventory", allowed: canInventory },
    { id: "reviews", label: "Reviews", allowed: true },
  ];
  const exportDataset = tab === "overview" ? "channels" : tab;
  const exportOptions: ComparisonOptions = { ...baseOptions, search: search || undefined, productState, sentiment, reviewFrom: reviewFrom || undefined, reviewTo: reviewTo || undefined, performance: tab === "inventory" ? inventoryState : undefined, sort: "revenue", order: "desc" };

  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <Card accent={DS.sky}>
      <SectionHeader title="Marketplace Performance" sub="Canonical JTL channel data — identical filters and totals to Sales and Compare"
        right={canExport && <button style={buttonStyle()} onClick={() => exportComparisonCsv(exportDataset, exportOptions)}>Download {tab} CSV</button>} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,2fr) minmax(180px,1fr)", gap: 12, alignItems: "end" }}>
        <Field label="Marketplace / sales channel"><select value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} style={{ ...controlStyle, width: "100%" }}>
          <option value={ALL_CHANNELS}>All marketplaces & channels</option>{channelOptions.map((channel) => <option key={channel.channel_id} value={channel.channel_id}>{channel.channel_name}</option>)}
        </select></Field>
        <div style={{ color: DS.lo, fontSize: 10, lineHeight: 1.6 }}><strong style={{ color: DS.hi }}>{title}</strong><br />“All” removes the channel filter; selecting Amazon or another channel scopes every tab.</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>{tabs.filter((item) => item.allowed).map((item) => <button key={item.id} onClick={() => { setTab(item.id); setSearch(""); }} style={buttonStyle(tab === item.id ? DS.sky : DS.lo)}>{item.label}</button>)}</div>
    </Card>

    {activeQuery.isError && <Card accent={DS.rose} style={{ color: DS.rose, fontSize: 12 }}>The selected marketplace dataset could not be loaded. Retry after confirming schema and permissions.</Card>}
    {tab === "overview" && <Overview title={title} selected={selected} totals={summaryQuery.data?.current ?? {}} channels={overviewChannels} trend={trend} loading={summaryQuery.isLoading || trendQuery.isLoading || channelsQuery.isLoading} onSelect={setSelectedChannel} />}
    {tab === "orders" && <DatasetCard title={`${title} Orders`} sub="Real tenant orders filtered by canonical channel and dashboard date/status" search={search} setSearch={setSearch}>
      <OrderTable rows={ordersQuery.data?.rows ?? []} loading={ordersQuery.isLoading} />
    </DatasetCard>}
    {tab === "products" && <DatasetCard title={`${title} Products`} sub="Sold and catalogue products, including active and inactive state" search={search} setSearch={setSearch}
      filters={<select value={productState} onChange={(event) => setProductState(event.target.value as typeof productState)} style={controlStyle}><option value="all">Active + inactive</option><option value="active">Active only</option><option value="inactive">Inactive only</option></select>}>
      <ProductTable rows={productsQuery.data?.rows ?? []} loading={productsQuery.isLoading} />
    </DatasetCard>}
    {tab === "inventory" && <DatasetCard title={`${title} Inventory`} sub={channelFilter ? "Current JTL stock for products sold on this channel" : "Current JTL stock across all products"} search={search} setSearch={setSearch}
      filters={<select value={inventoryState} onChange={(event) => setInventoryState(event.target.value)} style={controlStyle}><option value="all">All stock states</option><option value="stockout_risk">Stockout risk</option><option value="dead_stock">Dead stock</option><option value="fast_moving">Fast moving</option><option value="slow_moving">Slow moving</option><option value="overstock">Overstock</option></select>}>
      <InventoryTable rows={inventoryQuery.data?.rows ?? []} loading={inventoryQuery.isLoading} />
    </DatasetCard>}
    {tab === "reviews" && <FeedbackWorkspace title={title} search={search} setSearch={setSearch}
      feedbackTab={feedbackTab} setFeedbackTab={setFeedbackTab} accounts={accountsQuery.data ?? []}
      accountId={feedbackAccountId} setAccountId={setFeedbackAccountId}
      sentiment={sentiment} setSentiment={setSentiment} reviewFrom={reviewFrom} setReviewFrom={setReviewFrom}
      reviewTo={reviewTo} setReviewTo={setReviewTo} comparison={reviewsQuery.data}
      summary={feedbackSummaryQuery.data} reviewsLoading={reviewsQuery.isLoading || feedbackSummaryQuery.isLoading}
      insights={insightQuery.data} trends={trendQueryFeedback.data} ratings={ratingQuery.data} />}
    {tab !== "overview" && <Pagination page={page} pages={totalPages} total={resultTotal} setPage={setPage} />}
  </div>;
}

function Overview({ title, selected, totals, channels, trend, loading, onSelect }: any) {
  const metrics = selected ? { revenue: selected.revenue, orders: selected.orders, units: selected.units, averageOrderValue: selected.average_order_value, products: selected.products_sold, returns: selected.returns }
    : { revenue: totals.revenue, orders: totals.orders, units: totals.units, averageOrderValue: totals.averageOrderValue, products: channels.reduce((sum: number, row: ChannelRow) => sum + Number(row.products_sold || 0), 0), returns: channels.reduce((sum: number, row: ChannelRow) => sum + Number(row.returns || 0), 0) };
  return <><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12 }}><Metric label="Revenue" value={money(metrics.revenue)} color={DS.sky} /><Metric label="Orders" value={integer(metrics.orders)} color={DS.violet} /><Metric label="Units" value={integer(metrics.units)} color={DS.emerald} /><Metric label="Average order" value={money(metrics.averageOrderValue)} color={DS.amber} /><Metric label={selected ? "Products sold" : "Channel-product links"} value={integer(metrics.products)} color={DS.sky} /><Metric label="Returns" value={integer(metrics.returns)} color={DS.rose} /></div>
    <Card><SectionHeader title={`${title} Revenue Trend`} sub="Real order revenue for active dashboard filters" /><div style={{ height: 280 }}>{loading ? <Empty text="Loading revenue trend…" /> : !trend.length ? <Empty text="No order revenue for these filters." /> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend}><CartesianGrid stroke={DS.border} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fill: DS.lo, fontSize: 9 }} minTickGap={30} /><YAxis tick={{ fill: DS.lo, fontSize: 9 }} tickFormatter={compactMoney} width={58} /><Tooltip contentStyle={{ background: DS.panel, border: `1px solid ${DS.border}` }} formatter={(value) => [money(Number(value || 0)), "Revenue"]} /><Area type="monotone" dataKey="revenue" stroke={DS.sky} fill={`${DS.sky}35`} /></AreaChart></ResponsiveContainer>}</div></Card>
    <Card><SectionHeader title="Channel Breakdown" sub="Select a row to scope all detail tabs" /><ChannelTable rows={channels} onSelect={onSelect} /></Card></>;
}

function DatasetCard({ title, sub, search, setSearch, filters, children }: any) { return <Card><SectionHeader title={title} sub={sub} /><div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" style={{ ...controlStyle, minWidth: 230 }} />{filters}</div>{children}</Card>; }
function ChannelTable({ rows, onSelect }: any) { return <Table headers={["Channel", "Type", "Revenue", "Orders", "Units", "AOV", "Products", "Returns"]} empty="No channel sales data.">{rows.map((row: ChannelRow) => <tr key={row.channel_id} onClick={() => onSelect(row.channel_id)} style={{ cursor: "pointer" }}><Cell main={row.channel_name} sub={(row.raw_channels ?? []).join(", ")} /><Cell main={row.channel_type || "other"} /><Cell main={money(row.revenue)} /><Cell main={integer(row.orders)} /><Cell main={integer(row.units)} /><Cell main={money(row.average_order_value)} /><Cell main={integer(row.products_sold)} /><Cell main={integer(row.returns)} /></tr>)}</Table>; }
function OrderTable({ rows, loading }: any) { return loading ? <Empty text="Loading orders…" /> : <Table headers={["Date", "Order", "Channel", "Status", "Payment", "Items", "Revenue", "Country"]} empty="No orders match this marketplace and filters.">{rows.map((row: any) => <tr key={`${row.jtl_order_id}-${row.order_date}`}><Cell main={date(row.order_date)} /><Cell main={row.order_number || String(row.jtl_order_id)} /><Cell main={row.channel_name} sub={row.raw_channel} /><Cell main={row.status || "—"} /><Cell main={row.payment_method || "—"} /><Cell main={integer(row.item_count)} /><Cell main={money(row.revenue)} /><Cell main={[row.country, row.region].filter(Boolean).join(" / ") || "—"} /></tr>)}</Table>; }
function ProductTable({ rows, loading }: any) { return loading ? <Empty text="Loading products…" /> : <Table headers={["Product", "SKU", "State", "Category", "Revenue", "Units", "Orders", "Stock"]} empty="No products match this marketplace and state.">{rows.map((row: any) => <tr key={row.id}><Cell main={row.name} /><Cell main={row.sku || "—"} /><Cell main={row.is_active ? "Active" : "Inactive"} color={row.is_active ? DS.emerald : DS.lo} /><Cell main={row.category || "Uncategorised"} /><Cell main={money(row.revenue)} /><Cell main={integer(row.units)} /><Cell main={integer(row.orders)} /><Cell main={integer(row.stock)} /></tr>)}</Table>; }
function InventoryTable({ rows, loading }: any) { return loading ? <Empty text="Loading inventory…" /> : <Table headers={["Product", "SKU", "Warehouses", "Stock", "Value", "Units 30d", "Cover", "Class"]} empty="No inventory matches this marketplace and stock state.">{rows.map((row: any) => <tr key={row.id}><Cell main={row.name} /><Cell main={row.sku || "—"} /><Cell main={row.warehouses || "—"} /><Cell main={integer(row.stock)} /><Cell main={money(row.stock_value)} /><Cell main={integer(row.units_30d)} /><Cell main={row.stock_cover_days == null ? "No demand" : `${row.stock_cover_days} days`} /><Cell main={String(row.classification || "normal").replaceAll("_", " ")} /></tr>)}</Table>; }
function FeedbackWorkspace(props: any) {
  const selectedAccount = props.accounts.find((account: any) => account.id === props.accountId);
  const sourceState = props.comparison?.source;
  const individual = props.summary?.individualReviews ?? {
    availability: sourceState?.availability ?? "UNKNOWN", coverage: sourceState?.coverage ?? "UNKNOWN",
    count: props.comparison?.summary?.reviews ?? null, averageRating: props.comparison?.summary?.average_rating ?? null,
    positive: props.comparison?.summary?.positive ?? null, neutral: props.comparison?.summary?.neutral ?? null,
    negative: props.comparison?.summary?.negative ?? null,
  };
  const tabs: Array<[FeedbackTab, string, any]> = [
    ["productReviews", "Product Reviews", individual],
    ["insights", "Review Insights", props.summary?.reviewInsights],
    ["trends", "Review Trends", props.summary?.reviewInsights],
    ["ratings", "Product Ratings", props.summary?.ratingAggregates],
    ["sources", "Sources & Coverage", null],
  ];
  return <Card accent={DS.sky}>
    <SectionHeader title={`${props.title} Reviews & Feedback`} sub="Source-aware marketplace feedback. Unknown or unavailable data is never converted to zero."
      right={<select value={props.accountId ?? ""} onChange={(event) => props.setAccountId(event.target.value || null)} style={controlStyle}>
        {!props.accounts.length && <option value="">No feedback account</option>}
        {props.accounts.map((account: any) => <option key={account.id} value={account.id}>{account.marketplace} · {account.displayName}</option>)}
      </select>} />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
      {tabs.map(([id, label, state]) => <button key={id} onClick={() => props.setFeedbackTab(id)} style={buttonStyle(props.feedbackTab === id ? DS.sky : DS.lo)}>
        {label}{state?.coverage && state.coverage !== "UNKNOWN" ? ` · ${friendly(state.coverage)}` : ""}
      </button>)}
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <Badge label={`Account ${selectedAccount?.status ?? "not configured"}`} color={selectedAccount?.status === "ACTIVE" ? DS.emerald : DS.amber} />
      <Badge label={`Availability ${friendly(activeFeedbackState(props.feedbackTab, props.summary, individual)?.availability || "UNKNOWN")}`} color={availabilityColor(activeFeedbackState(props.feedbackTab, props.summary, individual)?.availability)} />
      <Badge label={`Coverage ${friendly(activeFeedbackState(props.feedbackTab, props.summary, individual)?.coverage || "UNKNOWN")}`} color={DS.violet} />
      <Badge label={`Freshness ${friendly(props.summary?.freshness?.freshnessState || "NOT_SYNCED")}`} color={props.summary?.freshness?.freshnessState === "FRESH" ? DS.emerald : DS.amber} />
    </div>
    {props.feedbackTab === "productReviews" && <>
      <ReviewSummary summary={{ reviews: individual.count, average_rating: individual.averageRating,
        positive: individual.positive, neutral: individual.neutral, negative: individual.negative }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Product, SKU or review" style={{ ...controlStyle, flex: "1 1 220px" }} />
        <select value={props.sentiment} onChange={(event) => props.setSentiment(event.target.value)} style={controlStyle}><option value="all">All sentiment</option><option value="positive">Positive (4–5★)</option><option value="neutral">Neutral (3★)</option><option value="negative">Negative (1–2★)</option></select>
        <input type="date" value={props.reviewFrom} onChange={(event) => props.setReviewFrom(event.target.value)} style={controlStyle} />
        <input type="date" value={props.reviewTo} onChange={(event) => props.setReviewTo(event.target.value)} style={controlStyle} />
      </div>
      <CapabilityMessage state={individual} />
      <ReviewTable rows={props.comparison?.rows ?? []} loading={props.reviewsLoading} source={sourceState} />
    </>}
    {props.feedbackTab === "insights" && <><CapabilityMessage state={props.summary?.reviewInsights} /><FeedbackRows type="insights" data={props.insights} /></>}
    {props.feedbackTab === "trends" && <><CapabilityMessage state={props.summary?.reviewInsights} /><FeedbackRows type="trends" data={props.trends} /></>}
    {props.feedbackTab === "ratings" && <><CapabilityMessage state={props.summary?.ratingAggregates} /><FeedbackRows type="ratings" data={props.ratings} /></>}
    {props.feedbackTab === "sources" && <Sources rows={props.summary?.sources ?? []} />}
  </Card>;
}

function activeFeedbackState(tab: FeedbackTab, summary: any, individual: any) {
  if (tab === "productReviews") return individual;
  if (tab === "insights" || tab === "trends") return summary?.reviewInsights;
  if (tab === "ratings") return summary?.ratingAggregates;
  return null;
}

function CapabilityMessage({ state }: { state: any }) {
  if (!state || state.availability === "AVAILABLE") return null;
  const messages: Record<string, string> = {
    UNKNOWN: "This feedback capability has not been verified. Configure the authorized provider credentials, then test feedback capability.",
    NOT_AUTHORIZED: "The connected account is not authorized for this feedback resource.",
    NOT_SUPPORTED: "This provider source does not support this feedback resource.",
    EXTERNAL_SOURCE_REQUIRED: "This marketplace API does not provide the complete dataset. Connect a separately authorized review source.",
    ERROR: "The last capability test failed. Existing marketplace orders and inventory remain unaffected.",
    DISCOVERING: "Feedback capability discovery is in progress.",
  };
  return <div style={{ border: `1px solid ${availabilityColor(state.availability)}55`, borderRadius: 10,
    background: `${availabilityColor(state.availability)}0d`, color: DS.hi, padding: "12px 14px", marginBottom: 12, fontSize: 11 }}>
    <strong style={{ color: availabilityColor(state.availability) }}>{friendly(state.availability)}</strong><br />
    <span style={{ color: DS.lo }}>{state.message || messages[state.availability] || "Feedback data is currently unavailable."}</span>
  </div>;
}

function FeedbackRows({ type, data }: { type: "insights" | "trends" | "ratings"; data: any }) {
  const rows = data?.rows ?? [];
  if (!rows.length) return <Empty text={`No verified ${type.replaceAll("_", " ")} data has been synchronized from this source.`} />;
  if (type === "ratings") return <Table headers={["Product", "Average", "Reviews", "Updated"]} empty="No product ratings available.">{rows.map((row: any) => <tr key={row.id}><Cell main={row.marketplace_product_id} /><Cell main={row.average_rating == null ? "—" : `${Number(row.average_rating).toFixed(2)} / ${Number(row.rating_scale || 5)}`} /><Cell main={row.review_count == null ? "—" : integer(row.review_count)} /><Cell main={date(row.source_updated_at)} /></tr>)}</Table>;
  if (type === "trends") return <Table headers={["Period", "Product", "Topic", "Sentiment", "Occurrence", "Rating impact"]} empty="No review trends available.">{rows.map((row: any) => <tr key={row.id}><Cell main={`${date(row.period_start)} – ${date(row.period_end)}`} /><Cell main={row.asin || row.marketplace_product_id || "—"} /><Cell main={row.topic} /><Cell main={row.sentiment || "—"} /><Cell main={row.occurrence_percentage == null ? "—" : `${row.occurrence_percentage}%`} /><Cell main={row.star_rating_impact ?? "—"} /></tr>)}</Table>;
  return <Table headers={["Product", "Topic", "Sentiment", "Mentions", "Occurrence", "Period"]} empty="No review insights available.">{rows.map((row: any) => <tr key={row.id}><Cell main={row.asin || row.marketplace_product_id || "—"} /><Cell main={row.topic} /><Cell main={row.sentiment || "—"} /><Cell main={row.mentions ?? "—"} /><Cell main={row.occurrence_percentage == null ? "—" : `${row.occurrence_percentage}%`} /><Cell main={`${date(row.source_period_start)} – ${date(row.source_period_end)}`} /></tr>)}</Table>;
}

function Sources({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty text="No feedback source is configured for this marketplace account." />;
  const sources = Array.from(new Map(rows.map((row) => [row.source_id, row])).values());
  return <Table headers={["Source", "Type", "Status", "Enabled", "Last tested", "Last successful sync"]} empty="No feedback sources configured.">{sources.map((row: any) => <tr key={row.source_id}><Cell main={row.display_name || row.source_key} /><Cell main={friendly(row.source_type)} /><Cell main={friendly(row.source_status)} /><Cell main={row.enabled ? "Yes" : "No"} /><Cell main={date(row.last_tested_at)} /><Cell main={date(row.last_successful_sync_at)} /></tr>)}</Table>;
}

function ReviewSummary({ summary }: any) { if (!summary) return null; return <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(100px,1fr))", gap: 8, marginBottom: 14 }}><Mini label="Reviews" value={nullableInteger(summary.reviews)} /><Mini label="Average" value={summary.average_rating == null ? "—" : `${Number(summary.average_rating).toFixed(2)}★`} /><Mini label="Positive" value={nullableInteger(summary.positive)} color={DS.emerald} /><Mini label="Neutral" value={nullableInteger(summary.neutral)} color={DS.amber} /><Mini label="Negative" value={nullableInteger(summary.negative)} color={DS.rose} /></div>; }
function ReviewTable({ rows, loading, source }: any) {
  if (loading) return <Empty text="Loading reviews…" />;
  const empty = source?.state === "NOT_CONFIGURED" ? "No marketplace review account is configured for this company."
    : source?.state === "NOT_SUPPORTED" ? "The configured connector does not provide reviews. Amazon Client ID and Client Secret alone do not grant product-review access."
      : source?.state === "NOT_AUTHORIZED" ? "The marketplace account is not authorized to read reviews. Grant the required provider permission and test the connection again."
        : source?.state === "EXTERNAL_SOURCE_REQUIRED" ? "The marketplace API does not provide complete individual reviews. Connect an authorized external review source."
        : source?.state === "CAPABILITY_UNKNOWN" ? "Review capability has not been verified. Test feedback capability after configuring the provider authorization."
        : source?.state === "NOT_SYNCED" ? "Review access is available, but no review sync has completed yet. Run the review sync from Marketplace Connections."
          : "No reviews match the selected marketplace, sentiment, and date filters.";
  return <Table headers={["Date", "Rating", "Sentiment", "Product", "Review", "Verified"]} empty={empty}>{rows.map((row: any) => <tr key={row.id}><Cell main={date(row.reviewed_at)} /><Cell main={`${Number(row.rating).toFixed(1)}★`} /><Cell main={row.sentiment} color={row.sentiment === "positive" ? DS.emerald : row.sentiment === "negative" ? DS.rose : DS.amber} /><Cell main={row.product_name || row.sku || row.external_product_id || "Unknown product"} /><Cell main={row.title || "Untitled"} sub={row.review_text || "No review text supplied"} /><Cell main={row.verified_purchase == null ? "Unknown" : row.verified_purchase ? "Yes" : "No"} /></tr>)}</Table>;
}

function Table({ headers, empty, children }: any) { const rows = Array.isArray(children) ? children : children ? [children] : []; return !rows.length ? <Empty text={empty} /> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse" }}><thead><tr>{headers.map((header: string) => <th key={header} style={headCell}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Cell({ main, sub, color = DS.hi }: { main: any; sub?: any; color?: string }) { return <td style={bodyCell}><div style={{ color }}>{main ?? "—"}</div>{sub && <div style={{ color: DS.lo, fontSize: 9, marginTop: 3, maxWidth: 360 }}>{sub}</div>}</td>; }
function Field({ label, children }: any) { return <label style={{ color: DS.lo, fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em" }}>{label}<div style={{ marginTop: 6 }}>{children}</div></label>; }
function Pagination({ page, pages, total, setPage }: any) { return <Card style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ color: DS.lo, fontSize: 10 }}>{integer(total)} records · Page {page} of {pages}</span><div style={{ display: "flex", gap: 8 }}><button disabled={page <= 1} style={buttonStyle()} onClick={() => setPage(Math.max(1, page - 1))}>Previous</button><button disabled={page >= pages} style={buttonStyle()} onClick={() => setPage(Math.min(pages, page + 1))}>Next</button></div></Card>; }
function Metric({ label, value, color }: any) { return <Card accent={color} style={{ padding: "16px 18px" }}><div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase" }}>{label}</div><div style={{ color, fontFamily: DS.display, fontSize: 23, marginTop: 7 }}>{value}</div></Card>; }
function Mini({ label, value, color = DS.hi }: any) { return <div style={{ border: `1px solid ${DS.border}`, borderRadius: 9, padding: 10 }}><div style={{ color: DS.lo, fontSize: 8, textTransform: "uppercase" }}>{label}</div><div style={{ color, fontSize: 16, marginTop: 4 }}>{value}</div></div>; }
function Badge({ label, color }: { label: string; color: string }) { return <span style={{ color, border: `1px solid ${color}55`, background: `${color}10`, borderRadius: 999, padding: "5px 9px", fontSize: 9, textTransform: "uppercase" }}>{label}</span>; }
function Empty({ text }: { text: string }) { return <div style={{ minHeight: 150, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: DS.lo, fontSize: 12 }}>{text}</div>; }
function money(value: any) { return `${Number(value || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`; }
function integer(value: any) { return Math.round(Number(value || 0)).toLocaleString("de-DE"); }
function nullableInteger(value: any) { return value == null ? "—" : integer(value); }
function friendly(value: any) { return String(value || "unknown").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function availabilityColor(value: any) { return value === "AVAILABLE" ? DS.emerald : value === "ERROR" || value === "NOT_AUTHORIZED" ? DS.rose : value === "EXTERNAL_SOURCE_REQUIRED" ? DS.amber : DS.lo; }
function compactMoney(value: number) { return new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function date(value: any) { return value ? new Date(value).toLocaleDateString("de-DE") : "—"; }
const headCell = { padding: "9px 10px", borderBottom: `1px solid ${DS.border}`, color: DS.lo, fontSize: 9, textAlign: "left" as const, textTransform: "uppercase" as const, letterSpacing: ".07em", whiteSpace: "nowrap" as const };
const bodyCell = { padding: "11px 10px", borderBottom: `1px solid ${DS.border}`, color: DS.lo, fontSize: 11, verticalAlign: "top" as const };
