import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { resolveId, resolveIdOrNull } from '../../core/utils/mongo-ref.util';
import { announcedUserId } from '../announcedPlayers/announced-player.identity';
import {
    AnnouncedPlayer,
    TeamMatchDocument,
} from '../schemas/team-match.schema';

export interface GuestJoinState {
    guestJoin: {
        fromTeamOpen: boolean;
        toTeamOpen: boolean;
        maxPerTeam: number;
    };
    openTeamIds: string[];
    joinedTeamId: string | null;
    canSwitch: boolean;
    counts: Record<string, number>;
}

export function settingsOf(
    match: TeamMatchDocument,
): GuestJoinState['guestJoin'] {
    return {
        fromTeamOpen: match.guestJoin?.fromTeamOpen ?? false,
        toTeamOpen: match.guestJoin?.toTeamOpen ?? false,
        maxPerTeam: match.guestJoin?.maxPerTeam ?? 0,
    };
}

export function openTeamIds(match: TeamMatchDocument): string[] {
    const settings = settingsOf(match);
    const ids: string[] = [];
    const fromId = resolveIdOrNull(match.fromTeam);
    const toId = resolveIdOrNull(match.toTeam);
    if (settings.fromTeamOpen && fromId) ids.push(fromId);
    if (settings.toTeamOpen && toId) ids.push(toId);
    return ids;
}

export function countForTeam(
    match: TeamMatchDocument,
    teamId: Types.ObjectId | string | null | undefined,
): number {
    const tid = resolveIdOrNull(teamId);
    if (!tid) return 0;
    return (match.announcedPlayers ?? []).filter(
        (player) => resolveId(player.teamId) === tid,
    ).length;
}

export function buildGuestJoinState(
    match: TeamMatchDocument,
    userId: string,
): GuestJoinState {
    const availableTeamIds = openTeamIds(match);
    const current = (match.announcedPlayers ?? []).find(
        (player) => player.isGuest && announcedUserId(player) === userId,
    );
    const fromId = resolveIdOrNull(match.fromTeam);
    const toId = resolveIdOrNull(match.toTeam);
    const counts: Record<string, number> = {};
    if (fromId) counts[fromId] = countForTeam(match, fromId);
    if (toId) counts[toId] = countForTeam(match, toId);
    return {
        guestJoin: settingsOf(match),
        openTeamIds: availableTeamIds,
        joinedTeamId: current ? resolveId(current.teamId) : null,
        canSwitch: availableTeamIds.length > 1,
        counts,
    };
}

export function resolveTargetTeam(
    match: TeamMatchDocument,
    requestedTeamId: string | undefined,
    availableTeamIds: string[],
): string {
    if (requestedTeamId) {
        if (!availableTeamIds.includes(requestedTeamId)) {
            throw new ForbiddenException('That team is not open for guest players');
        }
        return requestedTeamId;
    }
    if (availableTeamIds.length === 1) {
        return availableTeamIds[0];
    }
    const [first, second] = availableTeamIds;
    return countForTeam(match, second) < countForTeam(match, first)
        ? second
        : first;
}

export function plainEntry(player: AnnouncedPlayer): AnnouncedPlayer {
    const source = player as AnnouncedPlayer & {
        toObject?: () => AnnouncedPlayer;
    };
    return source.toObject ? source.toObject() : { ...player };
}
