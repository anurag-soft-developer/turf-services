import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { assertCanActForTeam } from '../../../matchmaking/util/matchmaking.helpers';
import { TeamMatchDocument } from '../../../matchmaking/schemas/team-match.schema';
import { TeamService } from '../../../team/team.service';
import { TeamMemberService } from '../../../team-member/team-member.service';
import { CreateCricketSessionDto } from '../dto/cricket-scoring.dto';
import { resolveId } from '../../../core/utils/mongo-ref.util';
import { findAnnouncedPlayingPlayer } from '../../../matchmaking/announcedPlayers/announced-player.identity';

export function assertAnnouncedPlayingParticipant(
  match: TeamMatchDocument,
  teamId: Types.ObjectId,
  scoringId: Types.ObjectId,
  label: string,
): void {
  const ok = findAnnouncedPlayingPlayer(
    match,
    resolveId(teamId),
    scoringId.toString(),
  );
  if (!ok) {
    throw new BadRequestException(
      `${label} is not in the announced playing XI for that team`,
    );
  }
}

export function assertUsersInAnnouncedLineup(
  match: TeamMatchDocument,
  dto: CreateCricketSessionDto,
  battingTeamId: Types.ObjectId,
  bowlingTeamId: Types.ObjectId,
): void {
  if (dto.strikerUserId) {
    assertAnnouncedPlayingParticipant(
      match,
      battingTeamId,
      new Types.ObjectId(dto.strikerUserId),
      'Striker',
    );
  }
  if (dto.nonStrikerUserId) {
    assertAnnouncedPlayingParticipant(
      match,
      battingTeamId,
      new Types.ObjectId(dto.nonStrikerUserId),
      'Non-striker',
    );
  }
  if (dto.bowlerUserId) {
    assertAnnouncedPlayingParticipant(
      match,
      bowlingTeamId,
      new Types.ObjectId(dto.bowlerUserId),
      'Bowler',
    );
  }
}

/** Striker / non-striker / bowler must each appear in the playing (non-substitute) announced XI for their team. */
export function assertAnnouncedPlayingLineup(
  match: TeamMatchDocument,
  battingTeamId: Types.ObjectId,
  bowlingTeamId: Types.ObjectId,
  striker: Types.ObjectId,
  nonStriker: Types.ObjectId,
  bowler: Types.ObjectId,
): void {
  assertAnnouncedPlayingParticipant(match, battingTeamId, striker, 'Striker');
  assertAnnouncedPlayingParticipant(
    match,
    battingTeamId,
    nonStriker,
    'Non-striker',
  );
  assertAnnouncedPlayingParticipant(match, bowlingTeamId, bowler, 'Bowler');
}

export async function assertLeadershipOnMatchTeams(
  teamService: TeamService,
  teamMemberService: TeamMemberService,
  userId: string,
  match: TeamMatchDocument,
): Promise<void> {
  const t1 = await teamService.requireTeam(match.fromTeam.toString());
  const t2 = await teamService.requireTeam(match.toTeam.toString());
  const can1 = await canLeadershipAct(
    teamService,
    teamMemberService,
    t1,
    userId,
  );
  const can2 = await canLeadershipAct(
    teamService,
    teamMemberService,
    t2,
    userId,
  );
  if (!can1 && !can2) {
    throw new ForbiddenException(
      'Only owners, captains, or vice captains of a match team can score',
    );
  }
}

async function canLeadershipAct(
  teamService: TeamService,
  teamMemberService: TeamMemberService,
  team: Awaited<ReturnType<TeamService['requireTeam']>>,
  userId: string,
): Promise<boolean> {
  try {
    await assertCanActForTeam(team, userId, teamService, teamMemberService);
    return true;
  } catch {
    return false;
  }
}
