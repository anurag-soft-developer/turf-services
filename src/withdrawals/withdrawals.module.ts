import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WalletModule } from '../wallet/wallet.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    WalletModule,
    StorageModule,
    MongooseModule.forFeature([{ name: Withdrawal.name, schema: WithdrawalSchema }]),
  ],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
