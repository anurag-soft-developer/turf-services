import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ScoringSession,
  ScoringSessionDocument,
} from './scoring-session.schema';
import { ScoringSessionStatus, SportType } from './scoring.types';

@Injectable()
export class ScoringSessionService {
  constructor(
    @InjectModel(ScoringSession.name)
    private readonly scoringSessionModel: Model<ScoringSessionDocument>,
  ) {}

  async requireSession(sessionId: string): Promise<ScoringSessionDocument> {
    const doc = await this.scoringSessionModel.findById(sessionId);
    if (!doc) {
      throw new NotFoundException('Scoring session not found');
    }
    return doc;
  }

  assertSport(session: ScoringSessionDocument, sport: SportType): void {
    if (session.sport !== sport) {
      throw new BadRequestException(
        `Session sport is ${session.sport}, expected ${sport}`,
      );
    }
  }

  assertCanAppendEvents(session: ScoringSessionDocument): void {
    if (
      session.status === ScoringSessionStatus.COMPLETED ||
      session.status === ScoringSessionStatus.ABANDONED
    ) {
      throw new BadRequestException('Scoring session is closed');
    }
  }

  teamIdsMatchSession(
    session: ScoringSessionDocument,
    teamOneId: string,
    teamTwoId: string,
  ): boolean {
    const ids = new Set([
      session.teamOneId.toString(),
      session.teamTwoId.toString(),
    ]);
    const x = new Types.ObjectId(teamOneId).toString();
    const y = new Types.ObjectId(teamTwoId).toString();
    return ids.size === 2 && ids.has(x) && ids.has(y);
  }
}
