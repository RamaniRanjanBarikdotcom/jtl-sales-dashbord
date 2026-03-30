import { Controller, Get, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get('kpis')
  async kpis(@Req() req: any) {
    return this.svc.getKpis(req.user.tenantId);
  }

  @Get('segments')
  async segments(@Req() req: any) {
    return this.svc.getSegments(req.user.tenantId);
  }

  @Get('monthly')
  async monthly(@Req() req: any) {
    return this.svc.getMonthly(req.user.tenantId);
  }

  @Get('top')
  async top(@Req() req: any) {
    return this.svc.getTopByRevenue(req.user.tenantId);
  }

  @Get('export')
  async export(@Req() req: any, @Query() query: any, @Res() res: Response) {
    const csv = await this.svc.exportList(req.user.tenantId, query);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${date}.csv"`);
    res.send(csv);
  }

  @Get()
  async list(@Req() req: any, @Query() query: any) {
    return this.svc.getList(req.user.tenantId, query);
  }
}
