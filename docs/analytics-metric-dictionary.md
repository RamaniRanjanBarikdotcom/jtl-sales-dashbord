# Analytics Metric Dictionary

All calculations are tenant-scoped and use the selected reporting period unless stated otherwise.

| ID | Label | Definition |
|---|---|---|
| `sales.gross_revenue.v1` | Gross revenue | Sum of valid order gross revenue. |
| `sales.net_revenue.v1` | Net revenue | Sum of valid order net revenue when present; otherwise the explicitly documented gross-revenue fallback. |
| `sales.valid_order.v1` | Valid order | An order not classified as cancelled. |
| `sales.cancelled_order.v1` | Cancelled order | An order whose normalized status is `cancelled`. |
| `sales.returned_order.v1` | Returned order | An order whose normalized status is `returned` or `return`. |
| `sales.units_sold.v1` | Units sold | Sum of order-item quantity for valid orders. |
| `sales.average_order_value.v1` | AOV | Valid-order revenue divided by distinct valid-order count. |
| `sales.average_selling_price.v1` | Average selling price | Product revenue divided by units sold when units are greater than zero. |
| `sales.return_rate.v1` | Return rate | Returned distinct orders divided by eligible distinct orders. |
| `sales.velocity.v1` | Sales velocity | Units sold divided by the number of days in the resolved period. |
| `sales.growth.v1` | Growth | Percentage change from the selected comparison period; unavailable when the baseline is zero. |
| `inventory.current_total_stock.v1` | Current total stock | Sum of `inventory.total`; JTL `TotalStock` / “Bestand alle Lager”. |
| `inventory.available_stock.v1` | Available stock | Sum of `inventory.available`. |
| `inventory.reserved_stock.v1` | Reserved stock | Sum of `inventory.reserved`. |
| `inventory.stock_cover.v1` | Days of stock | Current total stock divided by average daily units; `No demand` when demand is zero. |
| `inventory.dead_stock.v1` | Dead stock | Current total stock greater than zero with zero valid sales in the configured lookback. |
| `inventory.overstock.v1` | Overstock | Stock cover above the configured threshold; current dashboard default is more than 90 days for DSI and 180 days for broad inventory classification. |
| `inventory.stockout_risk.v1` | Stockout risk | Positive recent demand with estimated stock cover of seven days or less. |
| `product.no_sales.v1` | No-sales product | Active product with zero valid sales in the resolved period. |
| `product.average_performer.v1` | Average performer | Current broad inventory rule: average daily units from 0.2 up to 1; ranking median modes remain future work. |
| `profit.margin.v1` | Margin | `(net selling price - real unit cost) / net selling price × 100`; shown only when real cost coverage meets the configured reliability threshold. List price is never used as cost. |
