import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { MailModule } from '../mail/mail.module';
import { TenantContextModule } from '../../common/tenant-context.module';

@Module({
  imports: [MailModule, TenantContextModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
