import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Socket, Server } from 'socket.io';
import { chatRefSchema } from '../../../../libs';
import { socketJwtAuthMiddleware } from '../core/websocket/socket-jwt';
import { ChatService } from './chat.service';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly chatService: ChatService) {}

  afterInit(server: Server): void {
    server.use(socketJwtAuthMiddleware());
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: chat socketId=${client.id}`);
    if (!client.data.userId) {
      this.logger.warn(`Client disconnected (unauthorized): chat socketId=${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: chat socketId=${client.id}`);
  }

  @SubscribeMessage('chat.join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ room: string }> {
    const ref = chatRefSchema.parse(payload);
    const room = await this.chatService.joinRoom(ref);
    await client.join(room);
    return { room };
  }

  @SubscribeMessage('chat.leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ room: string }> {
    const ref = chatRefSchema.parse(payload);
    const room = await this.chatService.joinRoom(ref);
    await client.leave(room);
    return { room };
  }

  @SubscribeMessage('chat.send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const senderUserId = client.data.userId as string;
    const result = await this.chatService.sendMessage(senderUserId, payload);
    this.server.to(result.room).emit('chat.message', result.message);
    return result.message;
  }

  @SubscribeMessage('chat.history')
  async onHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const ref = chatRefSchema.parse(payload);
    const userId = client.data.userId as string;
    return this.chatService.getRecentHistory(userId, ref);
  }
}
