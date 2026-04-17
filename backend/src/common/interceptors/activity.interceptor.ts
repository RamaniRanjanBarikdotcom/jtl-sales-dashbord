import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ActivityService } from '../../activity/activity.service';

@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActivityInterceptor.name);

  constructor(private readonly activityService: ActivityService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest().user;
    if (user?.tenantId) {
      this.activityService.recordActivity(user.tenantId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown activity error';
        this.logger.warn(`Activity tracking failed for tenant ${user.tenantId}: ${message}`);
      });
    }
    return next.handle();
  }
}
