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
import {
  chatRefSchema,
  getChatRoomKey,
  getChatUserRoomKey,
} from '../../../../libs';
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
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      this.logger.warn(
        `Client disconnected (unauthorized): chat socketId=${client.id}`,
      );
      client.disconnect(true);
      return;
    }
    void client.join(getChatUserRoomKey(userId));
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
    const userId = client.data.userId as string;
    const { room } = await this.chatService.joinRoom(userId, ref);
    await client.join(room);
    return { room };
  }

  @SubscribeMessage('chat.leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ room: string }> {
    const ref = chatRefSchema.parse(payload);
    const room = getChatRoomKey(ref);
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
    for (const userId of result.participantUserIds) {
      this.server
        .to(getChatUserRoomKey(userId))
        .emit('chat.inbox.updated', result.inboxUpdated);
    }
    return result.message;
  }

  @SubscribeMessage('chat.delete')
  async onDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const userId = client.data.userId as string;
    const result = await this.chatService.deleteMessage(userId, payload);
    this.server.to(result.room).emit('chat.message.deleted', result.deleted);
    for (const participantUserId of result.participantUserIds) {
      this.server
        .to(getChatUserRoomKey(participantUserId))
        .emit('chat.message.deleted', result.deleted);
    }
    return result.deleted;
  }

  @SubscribeMessage('chat.read')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const ref = chatRefSchema.parse(payload);
    const userId = client.data.userId as string;
    const event = await this.chatService.markRead(userId, ref);
    this.server.to(getChatRoomKey(ref)).emit('chat.read', event);
    return event;
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
