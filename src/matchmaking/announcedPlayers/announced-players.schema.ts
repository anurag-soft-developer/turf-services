import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Team } from '../../team/schemas/team.schema';
import { User } from '../../users/schemas/user.schema';

/** Cricket squad role for an announced player line-up. */
export enum AnnouncedPlayerRole {
  BATSMAN = 'batsman',
  BOWLER = 'bowler',
  ALL_ROUNDER = 'allrounder',
  WICKET_KEEPER = 'wicket_keeper',
}

@Schema({ _id: false })
export class AnnouncedPlayer {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Team.name,
    required: true,
  })
  teamId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true })
  avatar?: string;

  @Prop({ type: String, trim: true, lowercase: true })
  email?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  userId!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  is_substitute!: boolean;

  @Prop({
    type: String,
    enum: Object.values(AnnouncedPlayerRole),
    required: true,
  })
  role!: AnnouncedPlayerRole;

  @Prop({ type: Boolean, default: false })
  isCaption!: boolean;

  @Prop({ type: Boolean, default: false })
  isWiseCaption!: boolean;
}

export const AnnouncedPlayerSchema =
  SchemaFactory.createForClass(AnnouncedPlayer);
