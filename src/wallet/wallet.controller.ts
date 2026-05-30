import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { IUser } from '../users/interfaces/user.interface';
import { UpdatePayoutDetailsDto } from './dto/wallet.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('me')
  async getMyWallet(@CurrentUser() user: IUser) {
    return this.walletService.getWalletByUserId(user._id.toString());
  }

  @Patch('payout-details')
  async updatePayoutDetails(
    @CurrentUser() user: IUser,
    @Body() dto: UpdatePayoutDetailsDto,
  ) {
    return this.walletService.updatePayoutDetails(user._id.toString(), dto);
  }
}
