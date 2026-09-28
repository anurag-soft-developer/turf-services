import { BadRequestException } from '@nestjs/common';
import { SportType } from '../../core/sports/sport-types';
import { AnnouncedPlayerRole } from './announced-players.schema';

const CRICKET_ROLES = [
  AnnouncedPlayerRole.BATSMAN,
  AnnouncedPlayerRole.BOWLER,
  AnnouncedPlayerRole.ALL_ROUNDER,
  AnnouncedPlayerRole.WICKET_KEEPER,
];

const FOOTBALL_ROLES = [
  AnnouncedPlayerRole.FORWARD,
  AnnouncedPlayerRole.DEFENDER,
  AnnouncedPlayerRole.MIDFIELDER,
  AnnouncedPlayerRole.GOALKEEPER,
];

export function assertAnnouncedPlayerRoleMatchesSport(
  sportType: SportType,
  role: AnnouncedPlayerRole,
): void {
  const allowedRoles =
    sportType === SportType.FOOTBALL
      ? FOOTBALL_ROLES
      : sportType === SportType.CRICKET
        ? CRICKET_ROLES
        : null;
  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new BadRequestException(`Role ${role} is not valid for ${sportType}`);
  }
}

export function defaultAnnouncedPlayerRoleForSport(
  sportType: SportType,
): AnnouncedPlayerRole {
  return sportType === SportType.FOOTBALL
    ? AnnouncedPlayerRole.MIDFIELDER
    : AnnouncedPlayerRole.ALL_ROUNDER;
}
