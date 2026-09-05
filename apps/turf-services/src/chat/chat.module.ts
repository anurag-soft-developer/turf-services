import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamMemberModule } from '../team-member/team-member.module';
import {
  TeamMatch,
  TeamMatchSchema,
} from '../matchmaking/schemas/team-match.schema';
import { ChatController } from './chat.controller';
import { ChatInboxController } from './chat-inbox.controller';
import { ChatService } from './chat.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import {
  ChatReadCursor,
  ChatReadCursorSchema,
} from './schemas/chat-read-cursor.schema';
import { Team, TeamSchema } from '../team/schemas/team.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from '../team-member/schemas/team-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatReadCursor.name, schema: ChatReadCursorSchema },
      { name: TeamMatch.name, schema: TeamMatchSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Team.name, schema: TeamSchema },
      { name: User.name, schema: UserSchema },
    ]),
    TeamMemberModule,
  ],
  controllers: [ChatController, ChatInboxController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
