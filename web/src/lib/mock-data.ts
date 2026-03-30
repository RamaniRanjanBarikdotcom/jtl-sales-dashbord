export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const buildMonthly = () => MONTHS.map((m, i) => ({
    month: m,
    revenue: [138, 161, 149, 188, 172, 209, 231, 218, 244, 263, 294, 338][i] * 1000,
    target: [125, 140, 155, 165, 172, 182, 195, 205, 215, 228, 244, 272][i] * 1000,
    orders: [1740, 2050, 1880, 2380, 2190, 2640, 2910, 2760, 3080, 3310, 3700, 4220][i],
    returns: [72, 88, 91, 103, 97, 118, 129, 122, 141, 149, 168, 191][i],
    newCust: [310, 390, 340, 450, 410, 510, 560, 520, 590, 640, 720, 830][i],
    margin: [31, 33, 30, 35, 34, 36, 37, 36, 38, 37, 39, 40][i],
}));

export const MONTHLY = buildMonthly();

export const DAILY = [
    { d:  1, rev:  8200, ord: 420 },
    { d:  2, rev:  9553, ord: 463 },
    { d:  3, rev: 10269, ord: 496 },
    { d:  4, rev: 10013, ord: 510 },
    { d:  5, rev:  8904, ord: 502 },
    { d:  6, rev:  7463, ord: 474 },
    { d:  7, rev:  6370, ord: 433 },
    { d:  8, rev:  6137, ord: 388 },
    { d:  9, rev:  6874, ord: 352 },
    { d: 10, rev:  8235, ord: 332 },
    { d: 11, rev:  9580, ord: 334 },
    { d: 12, rev: 10276, ord: 357 },
    { d: 13, rev: 10040, ord: 395 },
    { d: 14, rev:  8959, ord: 439 },
    { d: 15, rev:  7441, ord: 479 },
    { d: 16, rev:  6362, ord: 504 },
    { d: 17, rev:  6100, ord: 509 },
    { d: 18, rev:  6834, ord: 492 },
    { d: 19, rev:  8042, ord: 457 },
    { d: 20, rev:  9398, ord: 413 },
    { d: 21, rev: 10280, ord: 371 },
    { d: 22, rev: 10079, ord: 341 },
    { d: 23, rev:  9035, ord: 330 },
    { d: 24, rev:  7731, ord: 332 },
    { d: 25, rev:  6628, ord: 372 },
    { d: 26, rev:  6100, ord: 426 },
    { d: 27, rev:  6378, ord: 458 },
    { d: 28, rev:  7731, ord: 487 },
    { d: 29, rev:  8985, ord: 508 },
    { d: 30, rev: 10011, ord: 516 },
];

export const PRODUCTS = [
    { id: 1, rank: 1, name: "Alpha Pro Series", cat: "Electronics", rev: 58400, units: 1420, margin: 42, trend: +12.4, rating: 4.8 },
    { id: 2, rank: 2, name: "Beta Comfort Line", cat: "Apparel", rev: 44200, units: 1080, margin: 55, trend: +8.1, rating: 4.6 },
    { id: 3, rank: 3, name: "Gamma Tools Kit", cat: "Hardware", rev: 37800, units: 940, margin: 31, trend: +3.2, rating: 4.5 },
    { id: 4, rank: 4, name: "Delta Home Essentials", cat: "Home", rev: 31100, units: 780, margin: 48, trend: +18.6, rating: 4.7 },
    { id: 5, rank: 5, name: "Epsilon Sport Max", cat: "Sports", rev: 26400, units: 660, margin: 39, trend: -2.1, rating: 4.4 },
    { id: 6, rank: 6, name: "Zeta Office Bundle", cat: "Office", rev: 22900, units: 572, margin: 44, trend: +6.7, rating: 4.3 },
    { id: 7, rank: 7, name: "Eta Garden Pack", cat: "Garden", rev: 18700, units: 468, margin: 36, trend: +11.2, rating: 4.5 },
    { id: 8, rank: 8, name: "Theta Kids Range", cat: "Kids", rev: 15300, units: 382, margin: 58, trend: +22.3, rating: 4.9 },
];

export const CATS = [
    { name: "Electronics", v: 31, c: "#38bdf8" },
    { name: "Apparel", v: 22, c: "#8b5cf6" },
    { name: "Home & Garden", v: 17, c: "#10b981" },
    { name: "Sports", v: 14, c: "#f59e0b" },
    { name: "Hardware", v: 10, c: "#f43f5e" },
    { name: "Other", v: 6, c: "#22d3ee" },
];

export const REGIONS = [
    { name: "East", rev: 341000, orders: 4270, customers: 3410, growth: +19.4, c: "#38bdf8" },
    { name: "North", rev: 284000, orders: 3560, customers: 2840, growth: +11.2, c: "#22d3ee" },
    { name: "South", rev: 219000, orders: 2740, customers: 2190, growth: +6.8, c: "#8b5cf6" },
    { name: "West", rev: 198000, orders: 2480, customers: 1980, growth: +14.1, c: "#f59e0b" },
    { name: "Central", rev: 156000, orders: 1950, customers: 1560, growth: -1.3, c: "#f43f5e" },
    { name: "Intl.", rev: 94000, orders: 1180, customers: 940, growth: +31.2, c: "#10b981" },
];

export const SEGMENTS = [
    { name: "VIP", count: 842, ltv: 8240, churn: 2.1, growth: 14, c: "#f59e0b", desc: "> €5,000 LTV" },
    { name: "Regular", count: 4210, ltv: 2180, churn: 8.4, growth: 7, c: "#38bdf8", desc: "€1K – €5K LTV" },
    { name: "Casual", count: 7438, ltv: 480, churn: 21.3, growth: 3, c: "#8b5cf6", desc: "< €1,000 LTV" },
];

export const COHORTS = MONTHS.slice(6).map((m, i) => ({
    m, m0: 100,
    m1: Math.round(64 - i * 1.5),
    m2: Math.round(49 - i * 1.8),
    m3: Math.round(40 - i * 1.3),
    m4: Math.round(34 - i * 1.0),
    m5: Math.round(29 - i * 0.8),
}));

export const RADAR = [
    { k: "Revenue", cur: 88, tgt: 85 },
    { k: "Orders", cur: 72, tgt: 80 },
    { k: "Margin", cur: 91, tgt: 75 },
    { k: "Retention", cur: 67, tgt: 70 },
    { k: "NPS", cur: 79, tgt: 75 },
    { k: "Conversion", cur: 58, tgt: 65 },
];

export const DAYS7 = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Deterministic heatmap — base intensity by weekday/weekend × hour, plus a
// simple seeded offset so cells aren't all identical.
const _heatSeed = (di: number, h: number) => ((di * 7 + h * 13 + di * h) % 30);
export const HEAT = DAYS7.flatMap((day, di) =>
    Array.from({ length: 24 }, (_, h) => ({
        day,
        h,
        v: Math.round((["Sat", "Sun"].includes(day) ? 25 : 55) * (h >= 9 && h <= 21 ? 1 : 0.18) + _heatSeed(di, h)),
    }))
);

export const INVENTORY_ALERTS = [
    { id: 1, product: "Epsilon Sport Max", stock: 0, status: 'out_of_stock', dsi: 0, reorderQty: 250, warehouse: "W1 Main" },
    { id: 2, product: "Gamma Tools Kit", stock: 12, status: 'low_stock', dsi: 3, reorderQty: 100, warehouse: "W2 South" },
    { id: 3, product: "Beta Comfort Line", stock: 45, status: 'reorder', dsi: 14, reorderQty: 500, warehouse: "W1 Main" },
    { id: 4, product: "Zeta Office Bundle", stock: 58, status: 'reorder', dsi: 18, reorderQty: 300, warehouse: "W1 Main" },
];

export const CAMPAIGNS = [
    { id: 1, name: "Summer Sale 2026", platform: "Google Ads", spend: 12400, roas: 3.2, cpa: 42, conversions: 890 },
    { id: 2, name: "Retargeting - Cart Abandons", platform: "Meta Ads", spend: 4500, roas: 4.8, cpa: 28, conversions: 760 },
    { id: 3, name: "Brand Search Exact", platform: "Google Ads", spend: 2100, roas: 8.5, cpa: 15, conversions: 1250 },
    { id: 4, name: "New Collection LA", platform: "Meta Ads", spend: 8900, roas: 2.1, cpa: 65, conversions: 290 },
    { id: 5, name: "Spring Newsletter Promo", platform: "Email", spend: 400, roas: 18.4, cpa: 4, conversions: 1840 },
];

export const SYNC_JOBS = [
    { id: "s1", type: "Orders (incremental)", status: "running", lastRun: "Just now", duration: "-", rows: "-" },
    { id: "s2", type: "Inventory", status: "success", lastRun: "5 min ago", duration: "1.2s", rows: "42" },
    { id: "s3", type: "Customers", status: "success", lastRun: "12 min ago", duration: "4.5s", rows: "8" },
    { id: "s4", type: "Products (full)", status: "success", lastRun: "1 hr ago", duration: "28.4s", rows: "1,842" },
    { id: "s5", type: "Google Ads", status: "failed", lastRun: "2 hrs ago", duration: "0.8s", rows: "0" },
];

export const totalRev = MONTHLY.reduce((s, d) => s + d.revenue, 0);
export const totalOrd = MONTHLY.reduce((s, d) => s + d.orders, 0);
export const avgOV = Math.round(totalRev / totalOrd);
export const avgMargin = Math.round(MONTHLY.reduce((s, d) => s + d.margin, 0) / 12);

// Sales by channel (monthly)
export const CHANNELS = MONTHS.map((m, i) => ({
    month: m,
    Direct:      [52, 61, 56, 71, 65, 79, 87, 82, 92,  99, 111, 127][i] * 1000,
    Marketplace: [48, 56, 52, 66, 60, 73, 81, 76, 86,  93, 103, 118][i] * 1000,
    Email:       [22, 27, 24, 31, 28, 34, 38, 36, 40,  43,  48,  55][i] * 1000,
    Referral:    [16, 17, 17, 20, 19, 23, 25, 24, 26,  28,  32,  38][i] * 1000,
}));

// Customer LTV trend (last 6 months)
export const LTV_TREND = MONTHS.slice(6).map((m, i) => ({
    month: m,
    VIP:     [7800, 7950, 8100, 8050, 8200, 8240][i],
    Regular: [2050, 2100, 2120, 2140, 2160, 2180][i],
    Casual:  [ 450,  460,  465,  470,  475,  480][i],
}));

// Churn rate trend (monthly %)
export const CHURN_TREND = MONTHS.map((m, i) => ({
    month: m,
    VIP:     [2.4, 2.3, 2.3, 2.2, 2.1, 2.1, 2.1, 2.0, 2.0, 2.1, 2.1, 2.1][i],
    Regular: [9.1, 8.9, 8.8, 8.6, 8.5, 8.4, 8.4, 8.4, 8.5, 8.4, 8.4, 8.4][i],
    Casual:  [22.1, 21.8, 21.6, 21.4, 21.3, 21.3, 21.2, 21.1, 21.2, 21.2, 21.3, 21.3][i],
}));

// RFM scatter data (recency days, frequency, monetary, segment)
export const RFM_DATA = [
    { r:  12, f: 22, m: 12400, s: "VIP",     c: "#f59e0b" },
    { r:   5, f: 28, m: 18200, s: "VIP",     c: "#f59e0b" },
    { r:  18, f: 19, m:  8900, s: "VIP",     c: "#f59e0b" },
    { r:   8, f: 24, m: 15600, s: "VIP",     c: "#f59e0b" },
    { r:  22, f: 17, m:  7200, s: "VIP",     c: "#f59e0b" },
    { r:   3, f: 31, m: 22000, s: "VIP",     c: "#f59e0b" },
    { r:  45, f:  8, m:  3200, s: "Regular", c: "#38bdf8" },
    { r:  60, f:  6, m:  2800, s: "Regular", c: "#38bdf8" },
    { r:  30, f: 11, m:  4100, s: "Regular", c: "#38bdf8" },
    { r:  75, f:  7, m:  2400, s: "Regular", c: "#38bdf8" },
    { r:  55, f:  9, m:  3600, s: "Regular", c: "#38bdf8" },
    { r:  40, f: 12, m:  4800, s: "Regular", c: "#38bdf8" },
    { r:  90, f:  5, m:  1900, s: "Regular", c: "#38bdf8" },
    { r:  35, f: 10, m:  3900, s: "Regular", c: "#38bdf8" },
    { r: 120, f:  3, m:   820, s: "Casual",  c: "#8b5cf6" },
    { r: 150, f:  2, m:   450, s: "Casual",  c: "#8b5cf6" },
    { r: 200, f:  1, m:   180, s: "Casual",  c: "#8b5cf6" },
    { r: 110, f:  4, m:  1100, s: "Casual",  c: "#8b5cf6" },
    { r: 180, f:  2, m:   380, s: "Casual",  c: "#8b5cf6" },
    { r:  95, f:  3, m:   760, s: "Casual",  c: "#8b5cf6" },
    { r: 280, f:  7, m:  2900, s: "At-Risk", c: "#f43f5e" },
    { r: 310, f:  5, m:  1800, s: "At-Risk", c: "#f43f5e" },
    { r: 260, f:  9, m:  3400, s: "At-Risk", c: "#f43f5e" },
    { r: 290, f:  6, m:  2200, s: "At-Risk", c: "#f43f5e" },
    { r: 450, f:  4, m:  1400, s: "Churned", c: "#22d3ee" },
    { r: 500, f:  3, m:   900, s: "Churned", c: "#22d3ee" },
    { r: 420, f:  6, m:  2100, s: "Churned", c: "#22d3ee" },
];

// Daily ad spend history (30 days)
export const SPEND_HISTORY = [
    { d: 1,  google: 310, meta: 195, email: 18, revenue: 3820 },
    { d: 2,  google: 275, meta: 178, email: 14, revenue: 3420 },
    { d: 3,  google: 290, meta: 185, email: 16, revenue: 3600 },
    { d: 4,  google: 320, meta: 202, email: 20, revenue: 3950 },
    { d: 5,  google: 345, meta: 218, email: 22, revenue: 4180 },
    { d: 6,  google: 260, meta: 165, email: 12, revenue: 3200 },
    { d: 7,  google: 240, meta: 155, email: 10, revenue: 2980 },
    { d: 8,  google: 305, meta: 193, email: 17, revenue: 3780 },
    { d: 9,  google: 330, meta: 208, email: 21, revenue: 4020 },
    { d: 10, google: 355, meta: 225, email: 24, revenue: 4340 },
    { d: 11, google: 340, meta: 215, email: 22, revenue: 4150 },
    { d: 12, google: 360, meta: 228, email: 25, revenue: 4400 },
    { d: 13, google: 280, meta: 177, email: 15, revenue: 3450 },
    { d: 14, google: 250, meta: 160, email: 11, revenue: 3080 },
    { d: 15, google: 315, meta: 199, email: 19, revenue: 3860 },
    { d: 16, google: 335, meta: 212, email: 21, revenue: 4090 },
    { d: 17, google: 350, meta: 222, email: 23, revenue: 4280 },
    { d: 18, google: 370, meta: 234, email: 26, revenue: 4510 },
    { d: 19, google: 365, meta: 231, email: 25, revenue: 4460 },
    { d: 20, google: 345, meta: 218, email: 22, revenue: 4200 },
    { d: 21, google: 270, meta: 171, email: 13, revenue: 3320 },
    { d: 22, google: 255, meta: 162, email: 11, revenue: 3120 },
    { d: 23, google: 325, meta: 206, email: 20, revenue: 3970 },
    { d: 24, google: 340, meta: 215, email: 22, revenue: 4150 },
    { d: 25, google: 358, meta: 227, email: 24, revenue: 4370 },
    { d: 26, google: 375, meta: 237, email: 27, revenue: 4580 },
    { d: 27, google: 368, meta: 233, email: 26, revenue: 4490 },
    { d: 28, google: 348, meta: 220, email: 23, revenue: 4250 },
    { d: 29, google: 295, meta: 187, email: 17, revenue: 3620 },
    { d: 30, google: 315, meta: 199, email: 19, revenue: 3840 },
];

// Warehouse fill levels
export const WAREHOUSES = [
    { name: "W1 Main",  fill: 78, capacity: 10000, used: 7800, color: "#38bdf8" },
    { name: "W2 South", fill: 45, capacity:  5000, used: 2250, color: "#8b5cf6" },
    { name: "W3 East",  fill: 62, capacity:  3000, used: 1860, color: "#10b981" },
];

// Days of stock per product
export const DSI_PRODUCTS = [
    { name: "Alpha Pro",     dsi: 62, target: 30 },
    { name: "Beta Comfort",  dsi: 45, target: 30 },
    { name: "Gamma Tools",   dsi:  3, target: 30 },
    { name: "Delta Home",    dsi: 28, target: 30 },
    { name: "Epsilon Sport", dsi:  0, target: 30 },
    { name: "Zeta Office",   dsi: 18, target: 30 },
    { name: "Eta Garden",    dsi: 35, target: 30 },
    { name: "Theta Kids",    dsi: 52, target: 30 },
];

// Sync volume history (14 days)
export const SYNC_VOLUME = [
    { day: "D-13", orders:  820, inventory: 1840, customers: 42, products: 128 },
    { day: "D-12", orders:  945, inventory: 1910, customers: 38, products: 115 },
    { day: "D-11", orders:  878, inventory: 1860, customers: 51, products: 134 },
    { day: "D-10", orders: 1120, inventory: 1970, customers: 44, products: 142 },
    { day: "D-9",  orders: 1040, inventory: 1920, customers: 47, products: 119 },
    { day: "D-8",  orders: 1180, inventory: 2010, customers: 56, products: 156 },
    { day: "D-7",  orders:  890, inventory: 1850, customers: 39, products: 122 },
    { day: "D-6",  orders:  760, inventory: 1800, customers: 35, products: 108 },
    { day: "D-5",  orders: 1050, inventory: 1940, customers: 48, products: 138 },
    { day: "D-4",  orders: 1220, inventory: 2050, customers: 62, products: 161 },
    { day: "D-3",  orders: 1150, inventory: 1990, customers: 55, products: 148 },
    { day: "D-2",  orders: 1280, inventory: 2080, customers: 68, products: 172 },
    { day: "D-1",  orders: 1090, inventory: 1960, customers: 50, products: 145 },
    { day: "Today",orders:  420, inventory:  940, customers: 22, products:  63 },
];

// Regional current year vs prior year
export const REGIONAL_CY_PY = [
    { name: "East",    cy: 341000, py: 285000, c: "#38bdf8" },
    { name: "North",   cy: 284000, py: 255000, c: "#22d3ee" },
    { name: "South",   cy: 219000, py: 205000, c: "#8b5cf6" },
    { name: "West",    cy: 198000, py: 173000, c: "#f59e0b" },
    { name: "Central", cy: 156000, py: 158000, c: "#f43f5e" },
    { name: "Intl.",   cy:  94000, py:  72000, c: "#10b981" },
];
