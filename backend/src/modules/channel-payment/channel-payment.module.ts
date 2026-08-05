import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { TenantContextModule } from '../../common/tenant-context.module';
import { ChannelPaymentController } from './channel-payment.controller';
import { ChannelPaymentService } from './channel-payment.service';

@Module({
  imports: [AuditModule, TenantContextModule],
  controllers: [ChannelPaymentController],
  providers: [ChannelPaymentService],
})
export class ChannelPaymentModule {}
