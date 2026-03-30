import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ActivityService } from '../../activity/activity.service';

@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activityService: ActivityService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const user = ctx.switchToHttp().getRequest().user;
    if (user?.tenantId) {
      this.activityService.recordActivity(user.tenantId).catch(() => {});
    }
    return next.handle();
  }
}
