import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import type { NotificationDispatchPayload } from '../../../../libs';
import { socketJwtAuthMiddleware } from '../core/websocket/socket-jwt';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: '*',
  },
})
export class NotificationGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  afterInit(server: Server): void {
    server.use(socketJwtAuthMiddleware());
  }

  handleConnection(client: Socket): void {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    void client.join(`user:${userId}`);
  }

  pushToUser(userId: string, payload: NotificationDispatchPayload): void {
    const sentAt = new Date().toISOString();
    this.server.to(`user:${userId}`).emit('notification.push', {
      ...payload,
      sentAt,
    });
  }
}
