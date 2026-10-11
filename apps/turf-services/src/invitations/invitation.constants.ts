export enum InvitationKind {
  TEAM_INVITE = 'teamInvite',
  TOURNAMENT_INVITE = 'tournamentInvite',
}

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  REVOKED = 'revoked',
  WITHDRAWN = 'withdrawn',
  EXPIRED = 'expired',
}

export enum TournamentInvitationDirection {
  INVITE = 'invite',
  REQUEST = 'request',
}

const LIVE_INVITATION_STATUSES = [
  InvitationStatus.PENDING,
  InvitationStatus.ACCEPTED,
] as const;

export function isLiveInvitationStatus(status: InvitationStatus): boolean {
  return (LIVE_INVITATION_STATUSES as readonly InvitationStatus[]).includes(
    status,
  );
}
