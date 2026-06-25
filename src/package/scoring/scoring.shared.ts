import z from 'zod';
import { scoringSportTypeSchema } from '../../core/sports/sport-types';

export const scoringSportSchema = scoringSportTypeSchema;
export type ScoringSport = z.infer<typeof scoringSportSchema>;

export const scoringActionSchema = z.enum([
  'append_ball',
  'append_event',
  'undo_ball',
  'undo_event',
]);
export type ScoringAction = z.infer<typeof scoringActionSchema>;

export const scoringUpdatePayloadSchema = z.object({
  eventId: z.string().trim().min(1),
  sport: scoringSportSchema,
  teamMatchId: z.string().trim().min(1),
  actorUserId: z.string().trim().min(1),
  action: scoringActionSchema,
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type ScoringUpdatePayload = z.infer<typeof scoringUpdatePayloadSchema>;

export const scoringMatchRefSchema = z.object({
  teamMatchId: z.string().trim().min(1),
});
export type ScoringMatchRef = z.infer<typeof scoringMatchRefSchema>;
