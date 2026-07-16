import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseInterceptors } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  scoringMatchRefSchema,
  type ScoringUpdatePayload,
} from '../../../../libs';
import { socketJwtAuthMiddleware } from '../core/websocket/socket-jwt';
import { WsLoggingInterceptor } from '../core/websocket/ws-logging.interceptor';

const WS_COLOR = '\x1b[36m'; // cyan
const RESET_COLOR = '\x1b[0m';

@WebSocketGateway({
  namespace: '/scoring',
  cors: {
    origin: '*',
  },
})
@UseInterceptors(new WsLoggingInterceptor())
export class ScoringGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger('WS:Scoring');

  afterInit(server: Server): void {
    server.use(socketJwtAuthMiddleware());
  }

  handleConnection(client: Socket): void {
    const userId = client.data?.userId ? String(client.data.userId) : 'anonymous';
    const namespace = client.nsp?.name ?? 'unknown';
    this.logger.log(
      `${WS_COLOR}WS|client connected userId=${userId} namespace=${namespace} socketId=${client.id}${RESET_COLOR}`,
    );

    if (!client.data.userId) {
      this.logger.warn(
        `${WS_COLOR}WS|client disconnected (unauthorized) namespace=${namespace} socketId=${client.id}${RESET_COLOR}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.userId ? String(client.data.userId) : 'anonymous';
    const namespace = client.nsp?.name ?? 'unknown';
    this.logger.log(
      `${WS_COLOR}WS|client disconnected userId=${userId} namespace=${namespace} socketId=${client.id}${RESET_COLOR}`,
    );
  }

  @SubscribeMessage('scoring.join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const { teamMatchId } = scoringMatchRefSchema.parse(body);
    const room = this.getRoom(teamMatchId);
    await client.join(room);
    return { room };
  }

  @SubscribeMessage('scoring.leave')
  async onLeave(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const { teamMatchId } = scoringMatchRefSchema.parse(body);
    const room = this.getRoom(teamMatchId);
    await client.leave(room);
    return { room };
  }

  /**
   * Broadcasts a scoring update to every client currently joined to the
   * `scoring:match:<teamMatchId>` room.
   *
   * Called by `ScoringController` after turf-services dispatches an append.
   */
  pushToSession(payload: ScoringUpdatePayload): void {
    const room = this.getRoom(payload.teamMatchId);
    this.server.to(room).emit('scoring.update', payload);
  }

  private getRoom(teamMatchId: string): string {
    return `scoring:match:${teamMatchId}`;
  }
}
