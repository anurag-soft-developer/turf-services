import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, tap, throwError } from 'rxjs';
import type { Socket } from 'socket.io';

const WS_COLOR = '\x1b[36m'; // cyan
const RESET_COLOR = '\x1b[0m';

@Injectable()
export class WsLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('WS');

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType<'ws' | 'http' | 'rpc'>() !== 'ws') {
      return next.handle();
    }

    const client = context.switchToWs().getClient<Socket>();
    const event = this.getEventName(context);
    const userId = client.data?.userId ? String(client.data.userId) : 'anonymous';
    const namespace = client.nsp?.name ?? 'unknown';
    const socketId = client.id;
    const startedAt = Date.now();
    const logMeta = `event=${event} userId=${userId} namespace=${namespace} socketId=${socketId}`;

    this.logger.log(`${WS_COLOR}WS|event received ${logMeta}${RESET_COLOR}`);

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startedAt;
        this.logger.log(
          `${WS_COLOR}WS|event handled ${logMeta} durationMs=${durationMs}${RESET_COLOR}`,
        );
      }),
      catchError((error: unknown) => {
        const durationMs = Date.now() - startedAt;
        const message =
          error instanceof Error ? error.message : 'Unknown websocket error';
        this.logger.error(
          `${WS_COLOR}WS|event failed ${logMeta} durationMs=${durationMs} error=${message}${RESET_COLOR}`,
        );
        return throwError(() => error);
      }),
    );
  }

  private getEventName(context: ExecutionContext): string {
    const handlerName = context.getHandler().name || 'unknown';
    const wsData = context.switchToWs().getData() as { event?: string } | undefined;
    return wsData?.event ?? handlerName;
  }
}
