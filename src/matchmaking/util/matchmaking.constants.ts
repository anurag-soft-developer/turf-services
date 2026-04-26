import { PopulateOptions } from 'mongoose';
import { teamPopulateSelectFields } from '../../team/schemas/team.schema';
import { turfSelectFields } from '../../turf/schemas/turf.schema';
import { TeamMatchStatus } from '../schemas/team-match.schema';

export const TERMINAL_PRE_PLAY_STATUSES = [
  TeamMatchStatus.REJECTED,
  TeamMatchStatus.EXPIRED,
  TeamMatchStatus.CANCELLED,
];

export const TERMINAL_ALL_STATUSES = [
  ...TERMINAL_PRE_PLAY_STATUSES,
  TeamMatchStatus.COMPLETED,
  TeamMatchStatus.DRAW,
];

/** Fields returned when populating `turfBookingId` on a team match. */
export const turfBookingPopulateSelectFields =
  'turf bookedBy timeSlots status totalAmount paymentStatus playerCount createdAt updatedAt';

export const TEAM_MATCH_POPULATE: PopulateOptions[] = [
  { path: 'fromTeam', select: teamPopulateSelectFields },
  { path: 'toTeam', select: teamPopulateSelectFields },
  { path: 'proposedTurfs.turfId', select: turfSelectFields },
  { path: 'turfBookingId', select: turfBookingPopulateSelectFields },
];
