import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Socket, Server } from 'socket.io';
import type { NotificationDispatchPayload } from '../../../../libs';
import { socketJwtAuthMiddleware } from '../core/websocket/socket-jwt';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: '*',
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  afterInit(server: Server): void {
    server.use(socketJwtAuthMiddleware());
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: notifications socketId=${client.id}`);
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      this.logger.warn(
        `Client disconnected (unauthorized): notifications socketId=${client.id}`,
      );
      client.disconnect(true);
      return;
    }
    void client.join(`user:${userId}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: notifications socketId=${client.id}`);
  }

  pushToUser(userId: string, payload: NotificationDispatchPayload): void {
    const sentAt = new Date().toISOString();
    this.server.to(`user:${userId}`).emit('notification.push', {
      ...payload,
      sentAt,
    });
  }
}
