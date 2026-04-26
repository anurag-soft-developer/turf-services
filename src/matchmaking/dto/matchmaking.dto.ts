import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const matchResponseActionSchema = z.enum(['accept', 'reject']);
const proposalDecisionActionSchema = z.enum(['accept', 'reject', 'withdraw']);

const TimeSlotSchema = z.object({
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
});

const SendMatchRequestSchema = z.object({
  fromTeamId: z.string().min(1),
  toTeamId: z.string().min(1),
  notes: z.string().trim().max(500).optional(),
  expiresInMinutes: z.coerce.number().int().min(1).optional(),
});

const ListNegotiationsFilterSchema = z.object({
  teamId: z.string().optional(),
  type: z.enum(['incoming', 'outgoing', 'all']).default('all'),
  status: z
    .enum([
      'requested',
      'accepted',
      'negotiating',
      'schedule_finalized',
      'rejected',
      'expired',
      'cancelled',
      'ongoing',
      'completed',
      'draw',
    ])
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
});

const RespondMatchRequestSchema = z.object({
  actorTeamId: z.string().min(1),
  action: matchResponseActionSchema,
});

const ProposeScheduleSchema = z
  .object({
    actorTeamId: z.string().min(1),
    proposedSlots: z.array(TimeSlotSchema).min(1).max(10).optional(),
    proposedTurfIds: z.array(z.string().min(1)).min(1).max(10).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((d) => !!d.proposedSlots || !!d.proposedTurfIds, {
    message: 'Provide proposedSlots and/or proposedTurfIds',
  });

const DecideSlotProposalSchema = z.object({
  actorTeamId: z.string().min(1),
  proposalId: z.string().min(1),
  action: proposalDecisionActionSchema,
  reason: z.string().trim().max(300).optional(),
});

const DecideTurfProposalSchema = z.object({
  actorTeamId: z.string().min(1),
  proposalId: z.string().min(1),
  action: proposalDecisionActionSchema,
  reason: z.string().trim().max(300).optional(),
});

const FinalizeScheduleSchema = z.object({
  actorTeamId: z.string().min(1),
  slotProposalId: z.string().min(1),
  turfProposalId: z.string().min(1),
  notes: z.string().trim().max(500).optional(),
});

const CancelNegotiationSchema = z.object({
  actorTeamId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

const RecordMatchResultSchema = z
  .object({
    actorTeamId: z.string().min(1),
    outcome: z.enum(['ongoing', 'completed', 'draw']),
    winnerTeam: z.string().min(1).optional(),
  })
  .refine((d) => d.outcome !== 'completed' || !!d.winnerTeam, {
    message: 'winnerTeam is required when outcome is completed',
    path: ['winnerTeam'],
  });

const UpdateTeamMatchSchema = z
  .object({
    turfBookingId: z.union([z.string().min(1), z.null()]).optional(),
    notes: z.string().trim().max(500).optional(),
    /** New accepted slot; server creates the proposal and `selectedSlotProposalId`. */
    slot: z
      .object({
        startTime: z.coerce.date(),
        endTime: z.coerce.date(),
      })
      .optional(),
    /** Turf id for a new accepted proposal; server creates the proposal and `selectedTurfProposalId`. */
    turfId: z.string().min(1).optional(),
    /** When set, must be from or to team and the caller must belong to that team. If omitted, caller must belong to exactly one of the two teams (or pass this when they belong to both). */
    selfAcceptTeamId: z.string().min(1).optional(),
  })
  .refine(
    (d) =>
      d.turfBookingId !== undefined ||
      d.notes !== undefined ||
      d.slot !== undefined ||
      d.turfId !== undefined,
    { message: 'Provide at least one field to update' },
  );

export class SendMatchRequestDto extends createZodDto(SendMatchRequestSchema) {}
export class ListNegotiationsFilterDto extends createZodDto(
  ListNegotiationsFilterSchema,
) {}
export class RespondMatchRequestDto extends createZodDto(
  RespondMatchRequestSchema,
) {}
export class ProposeScheduleDto extends createZodDto(ProposeScheduleSchema) {}
export class DecideSlotProposalDto extends createZodDto(
  DecideSlotProposalSchema,
) {}
export class DecideTurfProposalDto extends createZodDto(
  DecideTurfProposalSchema,
) {}
export class FinalizeScheduleDto extends createZodDto(FinalizeScheduleSchema) {}
export class CancelNegotiationDto extends createZodDto(
  CancelNegotiationSchema,
) {}
export class RecordMatchResultDto extends createZodDto(
  RecordMatchResultSchema,
) {}
export class UpdateTeamMatchDto extends createZodDto(UpdateTeamMatchSchema) {}
