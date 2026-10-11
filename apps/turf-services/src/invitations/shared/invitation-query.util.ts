import { Model, PopulateOptions } from 'mongoose';
import { PaginatedResult } from '../../core/interfaces/common';
import { InvitationDocument } from '../schemas/invitation.schema';

type InvitationFilter = Record<string, unknown>;
type InvitationPopulate = PopulateOptions | PopulateOptions[];

export async function paginateInvitations(
  invitationModel: Model<InvitationDocument>,
  filter: InvitationFilter,
  page: number,
  limit: number,
  populate?: InvitationPopulate,
): Promise<PaginatedResult<InvitationDocument>> {
  const skip = (page - 1) * limit;
  let query = invitationModel.find(filter).sort({ createdAt: -1 });
  if (populate) {
    query = query.populate(populate);
  }
  const [data, totalDocuments] = await Promise.all([
    query.skip(skip).limit(limit).exec(),
    invitationModel.countDocuments(filter),
  ]);
  return {
    data,
    totalDocuments,
    page,
    limit,
    totalPages: Math.ceil(totalDocuments / limit) || 0,
  };
}
