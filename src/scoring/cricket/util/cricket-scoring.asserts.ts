import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { assertCanActForTeam } from '../../../matchmaking/util/matchmaking.helpers';
import { TeamMatchDocument } from '../../../matchmaking/schemas/team-match.schema';
import { TeamService } from '../../../team/team.service';
import { TeamMemberService } from '../../../team-member/team-member.service';
import { CreateCricketSessionDto } from '../dto/cricket-scoring.dto';

export async function assertUserOnTeam(
  teamMemberService: TeamMemberService,
  userId: Types.ObjectId,
  teamId: Types.ObjectId,
): Promise<void> {
  const ok = await teamMemberService.hasActiveMembership(
    teamId.toString(),
    userId.toString(),
  );
  if (!ok) {
    throw new BadRequestException(
      `User ${userId.toString()} is not an active member of team ${teamId.toString()}`,
    );
  }
}

export async function assertUsersInTeams(
  teamMemberService: TeamMemberService,
  dto: CreateCricketSessionDto,
  battingTeamId: Types.ObjectId,
  bowlingTeamId: Types.ObjectId,
): Promise<void> {
  if (dto.strikerUserId) {
    await assertUserOnTeam(
      teamMemberService,
      new Types.ObjectId(dto.strikerUserId),
      battingTeamId,
    );
  }
  if (dto.nonStrikerUserId) {
    await assertUserOnTeam(
      teamMemberService,
      new Types.ObjectId(dto.nonStrikerUserId),
      battingTeamId,
    );
  }
  if (dto.bowlerUserId) {
    await assertUserOnTeam(
      teamMemberService,
      new Types.ObjectId(dto.bowlerUserId),
      bowlingTeamId,
    );
  }
}

export async function assertBattingBowlingRoster(
  teamMemberService: TeamMemberService,
  match: TeamMatchDocument,
  striker: Types.ObjectId,
  nonStriker: Types.ObjectId,
  bowler: Types.ObjectId,
): Promise<void> {
  const cs = match.cricketState!;
  await assertUserOnTeam(teamMemberService, striker, cs.battingTeamId);
  await assertUserOnTeam(teamMemberService, nonStriker, cs.battingTeamId);
  await assertUserOnTeam(teamMemberService, bowler, cs.bowlingTeamId);
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
  const players = match.announcedPlayers ?? [];

  const assertOnTeam = (
    label: string,
    userId: Types.ObjectId,
    teamId: Types.ObjectId,
  ): void => {
    const uid = userId.toString();
    const tid = teamId.toString();
    const ok = players.some(
      (p) =>
        p.userId.toString() === uid &&
        p.teamId.toString() === tid &&
        !p.is_substitute,
    );
    if (!ok) {
      throw new BadRequestException(
        `${label} is not in the announced playing XI for that team`,
      );
    }
  };

  assertOnTeam('Striker', striker, battingTeamId);
  assertOnTeam('Non-striker', nonStriker, battingTeamId);
  assertOnTeam('Bowler', bowler, bowlingTeamId);
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
