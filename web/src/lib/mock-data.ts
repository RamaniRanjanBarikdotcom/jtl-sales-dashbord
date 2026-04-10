/**
 * Marketing demo data — kept because JTL-Wawi has no marketing module.
 * All other mock data has been removed; dashboard pages now use real API data.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

export const CAMPAIGNS = [
    { id: 1, name: "Summer Sale 2026", platform: "Google Ads", spend: 12400, roas: 3.2, cpa: 42, conversions: 890 },
    { id: 2, name: "Retargeting - Cart Abandons", platform: "Meta Ads", spend: 4500, roas: 4.8, cpa: 28, conversions: 760 },
    { id: 3, name: "Brand Search Exact", platform: "Google Ads", spend: 2100, roas: 8.5, cpa: 15, conversions: 1250 },
    { id: 4, name: "New Collection LA", platform: "Meta Ads", spend: 8900, roas: 2.1, cpa: 65, conversions: 290 },
    { id: 5, name: "Spring Newsletter Promo", platform: "Email", spend: 400, roas: 18.4, cpa: 4, conversions: 1840 },
];

// Daily ad spend history (30 days) — marketing demo data
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
