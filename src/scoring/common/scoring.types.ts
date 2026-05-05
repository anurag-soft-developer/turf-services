import { SportType } from '../../team/schemas/team.schema';

export { SportType };

export enum ScoringSessionStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}
