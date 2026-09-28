import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { resolveId } from '../../core/utils/mongo-ref.util';
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
    if (settings.fromTeamOpen) ids.push(resolveId(match.fromTeam));
    if (settings.toTeamOpen) ids.push(resolveId(match.toTeam));
    return ids;
}

export function countForTeam(
    match: TeamMatchDocument,
    teamId: Types.ObjectId | string,
): number {
    const tid = resolveId(teamId);
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
    return {
        guestJoin: settingsOf(match),
        openTeamIds: availableTeamIds,
        joinedTeamId: current ? resolveId(current.teamId) : null,
        canSwitch: availableTeamIds.length > 1,
        counts: {
            [resolveId(match.fromTeam)]: countForTeam(match, match.fromTeam),
            [resolveId(match.toTeam)]: countForTeam(match, match.toTeam),
        },
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
