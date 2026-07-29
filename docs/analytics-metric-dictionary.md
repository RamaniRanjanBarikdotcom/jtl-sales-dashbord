# Analytics Metric Dictionary

All dashboard and Copilot calculations must reference this dictionary or an existing service-owned formula.

| ID | Label | Definition |
|---|---|---|
| `sales.net_revenue.non_cancelled_orders.v1` | Revenue from non-cancelled orders | Sum of `orders.gross_revenue` excluding normalized cancelled statuses in the resolved tenant-local period. |
| `sales.valid_order.v1` | Valid order | A tenant order not classified as cancelled. |
| `sales.units_sold.v1` | Units sold | Sum of order-item quantity for valid orders. |
| `sales.average_order_value.v1` | Average order value | Valid-order revenue divided by valid-order count. |
| `inventory.current_total_stock.v1` | Current total stock | `inventory.total`; JTL “Bestand alle Lager”. |
| `inventory.available_stock.v1` | Available stock | `inventory.available`. |
| `inventory.reserved_stock.v1` | Reserved stock | `inventory.reserved`. |

Cancelled, returned, margin, stock-cover, dead-stock, and customer lifecycle metrics must continue using their owning dashboard service until separately versioned here.
