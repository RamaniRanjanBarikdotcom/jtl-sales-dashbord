import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

type PaginationShape = {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  count: number;
};

function extractPagination(data: unknown): PaginationShape | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  const required = ['total', 'page', 'limit', 'total_pages', 'has_next', 'has_prev', 'count'];
  if (!required.every((key) => key in candidate)) return null;
  return {
    total: Number(candidate.total) || 0,
    page: Number(candidate.page) || 1,
    limit: Number(candidate.limit) || 1,
    total_pages: Number(candidate.total_pages) || 1,
    has_next: Boolean(candidate.has_next),
    has_prev: Boolean(candidate.has_prev),
    count: Number(candidate.count) || 0,
  };
}

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const pagination = extractPagination(data);
        return {
          success: true,
          data,
          meta: {
            generated_at: new Date().toISOString(),
            ...(pagination ? { pagination } : {}),
          },
        };
      }),
    );
  }
}
