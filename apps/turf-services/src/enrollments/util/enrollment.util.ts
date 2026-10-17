import { Types } from 'mongoose';
import { HostSnapshot } from '../../openings/util/opening-host.util';
import {
  OpeningDocument,
  OpeningType,
} from '../../openings/schemas/opening.schema';
import {
  EnrollmentDocument,
  EnrollmentStatus,
} from '../schemas/enrollment.schema';

type PopulatedUser = {
  _id: Types.ObjectId;
  fullName?: string;
  avatar?: string;
};

type PopulatedTeam = {
  _id: Types.ObjectId;
  name?: string;
  logo?: string | null;
};

export type EnrollmentView = {
  _id: string;
  openingId: string;
  subjectType: OpeningType;
  userId: string;
  userName?: string;
  userAvatar?: string;
  teamId?: string;
  teamName?: string;
  teamLogo?: string;
  tournamentId?: string;
  status: EnrollmentStatus;
  title: string;
  sportType: string;
  hostName: string;
  hostImage?: string;
  hostPlace?: string;
  reviewedAt?: Date;
  createdAt: Date;
};

export { assertObjectId, hostId, isDuplicateKey } from '../../openings/util/opening-asserts.util';

export function subjectKey(row: EnrollmentDocument): string | undefined {
  return row.subjectType === OpeningType.TEAM
    ? row.teamId?.toString()
    : row.tournamentId?.toString();
}

export function toEnrollmentView(
  enrollment: EnrollmentDocument,
  opening?: OpeningDocument,
  host?: HostSnapshot,
): EnrollmentView {
  const user = populatedUser(enrollment.user);
  const team = populatedTeam(enrollment.teamId);
  return {
    _id: enrollment._id.toString(),
    openingId: enrollment.openingId.toString(),
    subjectType: enrollment.subjectType,
    userId: user?.id ?? enrollment.user.toString(),
    userName: user?.name,
    userAvatar: user?.avatar,
    teamId: team?.id ?? enrollment.teamId?.toString(),
    teamName: team?.name,
    teamLogo: team?.logo,
    tournamentId: enrollment.tournamentId?.toString(),
    status: enrollment.status,
    title: opening?.title ?? '',
    sportType: opening?.sportType ?? '',
    hostName: host?.name ?? '',
    hostImage: host?.image,
    hostPlace: host?.place,
    reviewedAt: enrollment.reviewedAt,
    createdAt: enrollment.createdAt,
  };
}

function populatedUser(
  value: Types.ObjectId | PopulatedUser,
): { id: string; name?: string; avatar?: string } | null {
  if (value instanceof Types.ObjectId) return { id: value.toString() };
  if (!value || typeof value !== 'object' || !('_id' in value)) return null;
  const avatar = value.avatar?.trim();
  return {
    id: value._id.toString(),
    name: value.fullName?.trim() || undefined,
    avatar: avatar || undefined,
  };
}

function populatedTeam(
  value: Types.ObjectId | PopulatedTeam | undefined,
): { id: string; name?: string; logo?: string } | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return { id: value.toString() };
  if (typeof value !== 'object' || !('_id' in value)) return null;
  const logo = value.logo?.trim();
  return {
    id: value._id.toString(),
    name: value.name?.trim() || undefined,
    logo: logo || undefined,
  };
}
