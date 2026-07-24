import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';

import { SKIP_RESPONSE_WRAP_KEY } from '../decorators/skip-response-wrap.decorator';

interface HttpResponse {
  readonly headersSent: boolean;
  getHeader(name: string): number | string | string[] | undefined;
}

export interface SuccessResponse<T> {
  code: 0;
  message: 'success';
  data: T | null;
}

@Injectable()
export class ResponseInterceptor
  implements NestInterceptor<unknown, unknown>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const skipResponseWrap = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_WRAP_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipResponseWrap) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<HttpResponse>();

    return next.handle().pipe(
      map((data: unknown) => {
        if (
          data instanceof StreamableFile ||
          response.headersSent ||
          this.isEventStream(response)
        ) {
          return data;
        }

        return {
          code: 0,
          message: 'success',
          data: data ?? null,
        } satisfies SuccessResponse<unknown>;
      }),
    );
  }

  private isEventStream(response: HttpResponse): boolean {
    const contentType = response.getHeader('content-type');

    // SSE 同时通过装饰器和响应头排除，避免事件流被普通 JSON 响应包装。
    return (
      contentType !== undefined &&
      String(contentType).toLowerCase().includes('text/event-stream')
    );
  }
}
