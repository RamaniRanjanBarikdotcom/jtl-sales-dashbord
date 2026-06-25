import { Injectable } from '@nestjs/common';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { SalesService } from '../sales/sales.service';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly salesService: SalesService,
    private readonly productsService: ProductsService,
    private readonly customersService: CustomersService,
    private readonly inventoryService: InventoryService,
  ) {}

  async getOverview(
    tenantId: string,
    filters: QueryFiltersDto,
    role: string,
    userLevel: string,
  ) {
    const topProductFilters = { ...filters, limit: 20 };
    const dailyFilters = { ...filters, range: '30D' };
    const [
      salesKpis,
      productKpis,
      customerKpis,
      inventoryKpis,
      revenue,
      dailySales,
      categories,
      topProducts,
    ] = await Promise.all([
      this.salesService.getKpis(tenantId, filters, role, userLevel),
      this.productsService.getKpis(tenantId, filters, role, userLevel),
      this.customersService.getKpis(tenantId, filters),
      this.inventoryService.getKpis(tenantId),
      this.salesService.getRevenue(tenantId, filters, role, userLevel),
      this.salesService.getDaily(tenantId, dailyFilters, role, userLevel),
      this.productsService.getCategories(tenantId, filters),
      this.productsService.getTop(tenantId, topProductFilters, role, userLevel),
    ]);

    return {
      kpis: {
        sales: salesKpis,
        products: productKpis,
        customers: customerKpis,
        inventory: inventoryKpis,
      },
      revenue,
      dailySales,
      categories,
      topProducts,
    };
  }
}
