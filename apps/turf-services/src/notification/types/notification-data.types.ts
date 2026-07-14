import type { TeamMatchStatus } from '../../matchmaking/schemas/team-match.schema';
import type { WithdrawalStatus } from '../../withdrawals/interfaces/withdrawal.interface';
import type { WalletType } from '../../wallet/interfaces/wallet.interface';

export type TurfBookingNotificationKind =
  | 'booking_paid'
  | 'booking_confirmed'
  | 'booking_hold_expired'
  | 'payment_failed'
  | 'booking_cancelled';

export type EventBookingNotificationKind =
  | 'booking_paid'
  | 'booking_confirmed'
  | 'booking_hold_expired'
  | 'payment_failed'
  | 'booking_cancelled';

export type MatchmakingNotificationKind =
  | 'match_request_received'
  | 'match_request_accepted'
  | 'match_request_rejected'
  | 'match_schedule_proposed'
  | 'match_slot_decided'
  | 'match_turf_decided'
  | 'match_schedule_finalized'
  | 'match_cancelled'
  | 'match_result_recorded'
  | 'match_updated'
  | 'announced_player_added'
  | 'announced_player_removed';

export type TeamNotificationKind =
  | 'team_join_request'
  | 'team_join_accepted'
  | 'team_join_rejected';

export type ConnectionNotificationKind =
  | 'connection_request'
  | 'connection_accepted'
  | 'connection_rejected';

export type WithdrawalNotificationKind =
  | 'withdrawal_submitted'
  | 'withdrawal_status_changed';

export type TurfApprovalNotificationKind =
  | 'turf_submitted'
  | 'turf_published'
  | 'turf_rejected';

export type NotificationKind =
  | TurfBookingNotificationKind
  | EventBookingNotificationKind
  | MatchmakingNotificationKind
  | TeamNotificationKind
  | ConnectionNotificationKind
  | WithdrawalNotificationKind
  | TurfApprovalNotificationKind;

export type TurfBookingNotificationData =
  | { kind: 'booking_paid'; bookingId: string }
  | { kind: 'booking_confirmed'; bookingId: string }
  | { kind: 'booking_hold_expired'; bookingId: string }
  | { kind: 'payment_failed'; bookingId: string }
  | {
      kind: 'booking_cancelled';
      bookingId: string;
      cancelledBy: 'owner' | 'booker';
    };

export type EventBookingNotificationData =
  | { kind: 'booking_paid'; bookingId: string; eventId: string }
  | { kind: 'booking_confirmed'; bookingId: string; eventId: string }
  | { kind: 'booking_hold_expired'; bookingId: string; eventId: string }
  | { kind: 'payment_failed'; bookingId: string; eventId: string }
  | {
      kind: 'booking_cancelled';
      bookingId: string;
      eventId: string;
      cancelledBy: 'organizer' | 'booker';
    };

export type MatchmakingNotificationData =
  | { kind: 'match_request_received'; matchId: string }
  | { kind: 'match_request_accepted'; matchId: string }
  | { kind: 'match_request_rejected'; matchId: string }
  | { kind: 'match_schedule_proposed'; matchId: string }
  | { kind: 'match_slot_decided'; matchId: string; accepted: boolean }
  | { kind: 'match_turf_decided'; matchId: string; accepted: boolean }
  | { kind: 'match_schedule_finalized'; matchId: string }
  | { kind: 'match_cancelled'; matchId: string }
  | {
      kind: 'match_result_recorded';
      matchId: string;
      status: TeamMatchStatus;
    }
  | { kind: 'match_updated'; matchId: string }
  | { kind: 'announced_player_added'; matchId: string }
  | { kind: 'announced_player_removed'; matchId: string };

export type TeamNotificationData =
  | {
      kind: 'team_join_request';
      teamId: string;
      membershipId: string;
      actorUserId: string;
    }
  | {
      kind: 'team_join_accepted';
      teamId: string;
      membershipId: string;
    }
  | {
      kind: 'team_join_rejected';
      teamId: string;
      membershipId: string;
    };

export type ConnectionNotificationData =
  | {
      kind: 'connection_request';
      connectionId: string;
      actorUserId: string;
    }
  | { kind: 'connection_accepted'; connectionId: string }
  | { kind: 'connection_rejected'; connectionId: string };

export type WithdrawalNotificationData =
  | {
      kind: 'withdrawal_submitted';
      withdrawalId: string;
      amount: number;
      walletType: WalletType;
      actorUserId: string;
    }
  | {
      kind: 'withdrawal_status_changed';
      withdrawalId: string;
      status: WithdrawalStatus;
      amount: number;
      walletType: WalletType;
      rejectionReason?: string;
    };

export type TurfApprovalNotificationData =
  | {
      kind: 'turf_submitted';
      turfId: string;
      actorUserId: string;
    }
  | { kind: 'turf_published'; turfId: string }
  | { kind: 'turf_rejected'; turfId: string; rejectionReason?: string };

export type NotificationData =
  | TurfBookingNotificationData
  | EventBookingNotificationData
  | MatchmakingNotificationData
  | TeamNotificationData
  | ConnectionNotificationData
  | WithdrawalNotificationData
  | TurfApprovalNotificationData;
