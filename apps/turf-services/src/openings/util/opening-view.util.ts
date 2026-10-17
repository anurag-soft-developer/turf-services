import { Types } from 'mongoose';
import { SportType } from '../../core/sports/sport-types';
import { EnrollmentStatus } from '../../enrollments/schemas/enrollment.schema';
import { TeamStatus, TeamVisibility } from '../../team/schemas/team.schema';
import {
  OpeningJoinMode,
  OpeningStatus,
  OpeningType,
} from '../schemas/opening.schema';
import { HostSnapshot, teamSnapshot, tournamentSnapshot } from './opening-host.util';

type LocationBits = {
  city?: string;
  state?: string;
  country?: string;
  address?: string;
};

export type TeamHostDoc = {
  name: string;
  logo?: string | null;
  visibility: TeamVisibility | string;
  status: TeamStatus | string;
  location?: LocationBits | null;
  sportType?: SportType;
};

export type TournamentHostDoc = {
  name: string;
  coverImages?: string[];
  venueName?: string;
  isPublic?: boolean;
};

export type OpeningPoster = {
  _id: string;
  fullName?: string;
  avatar?: string | null;
};

type PosterDoc = {
  _id: Types.ObjectId;
  fullName?: string;
  avatar?: string | null;
};

export type OpeningView = {
  _id: string;
  type: OpeningType;
  teamId?: string;
  tournamentId?: string;
  postedBy: string;
  poster: OpeningPoster | null;
  title: string;
  sportType: SportType;
  status: OpeningStatus;
  joinMode: OpeningJoinMode;
  maxPendingJoinRequests: number;
  hostName: string;
  hostImage?: string;
  hostPlace?: string;
  myStatus: EnrollmentStatus.PENDING | EnrollmentStatus.ACCEPTED | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OpeningAggRow = {
  _id: Types.ObjectId;
  type: OpeningType;
  teamId?: Types.ObjectId;
  tournamentId?: Types.ObjectId;
  postedBy: Types.ObjectId;
  title: string;
  sportType: SportType;
  status: OpeningStatus;
  joinMode?: OpeningJoinMode;
  maxPendingJoinRequests?: number;
  createdAt: Date;
  updatedAt: Date;
  teamHost?: TeamHostDoc[];
  tournamentHost?: TournamentHostDoc[];
  poster?: PosterDoc[];
};

type OpeningViewSource = {
  _id: Types.ObjectId;
  type: OpeningType;
  teamId?: Types.ObjectId;
  tournamentId?: Types.ObjectId;
  postedBy: Types.ObjectId;
  title: string;
  sportType: SportType;
  status: OpeningStatus;
  joinMode?: OpeningJoinMode;
  maxPendingJoinRequests?: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toOpeningView(
  source: OpeningViewSource,
  host: HostSnapshot,
): OpeningView {
  return {
    _id: source._id.toString(),
    type: source.type,
    teamId: source.teamId?.toString(),
    tournamentId: source.tournamentId?.toString(),
    postedBy: source.postedBy.toString(),
    poster: posterOf(source),
    title: source.title,
    sportType: source.sportType,
    status: source.status,
    joinMode: source.joinMode ?? OpeningJoinMode.APPROVAL,
    maxPendingJoinRequests: source.maxPendingJoinRequests ?? 50,
    hostName: host.name,
    hostImage: host.image,
    hostPlace: host.place,
    myStatus: null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function posterOf(source: OpeningViewSource): OpeningPoster | null {
  const poster = (source as OpeningAggRow).poster?.[0];
  if (!poster?._id) return null;
  return {
    _id: poster._id.toString(),
    fullName: poster.fullName,
    avatar: poster.avatar ?? null,
  };
}

export function hostOf(row: OpeningAggRow): HostSnapshot | null {
  if (row.type === OpeningType.TEAM) {
    const team = row.teamHost?.[0];
    return team ? teamSnapshot(team) : null;
  }
  const tournament = row.tournamentHost?.[0];
  return tournament ? tournamentSnapshot(tournament) : null;
}
