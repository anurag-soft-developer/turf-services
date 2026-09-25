import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TermsAndConditions,
  TermsAndConditionsSchema,
} from './schemas/terms-and-conditions.schema';
import { TermsAndConditionsController } from './terms-and-conditions.controller';
import { TermsAndConditionsService } from './terms-and-conditions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TermsAndConditions.name, schema: TermsAndConditionsSchema },
    ]),
  ],
  controllers: [TermsAndConditionsController],
  providers: [TermsAndConditionsService],
  exports: [TermsAndConditionsService],
})
export class TermsAndConditionsModule {}
