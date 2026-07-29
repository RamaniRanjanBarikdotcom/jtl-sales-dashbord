import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformConfigService } from './platform-config.service';

@Controller('features')
export class PlatformConfigController {
  constructor(private readonly config: PlatformConfigService) {}
  @Get()
  @Public()
  getFlags() { return this.config.publicFlags(); }
}
