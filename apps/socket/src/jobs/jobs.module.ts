import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { JobsCronService } from './jobs.cron.service';
import { JobsTickerService } from './jobs.ticker.service';

@Module({
  imports: [ChatModule],
  providers: [JobsTickerService, JobsCronService],
})
export class JobsModule {}
