import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { RajorpayService } from '../../core/services/rajorpay/rajorpay.service';
import { Turf, TurfDocument } from '../../turf/schemas/turf.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { isHostPayoutReady } from '../../users/interfaces/host-onboarding.interface';
import { TurfBookingDocument } from '../schemas/turf-booking.schema';

const logger = new Logger('TurfBookingPayout');

export async function settleOwnerPayoutForBooking(params: {
  booking: TurfBookingDocument;
  paymentId: string;
  turfModel: Model<TurfDocument>;
  userModel: Model<UserDocument>;
  rajorpayService: RajorpayService;
}): Promise<void> {
  const { booking, paymentId, turfModel, userModel, rajorpayService } = params;

  if (booking.razorpayTransferId) {
    return;
  }

  const turf = await turfModel.findById(booking.turf).exec();
  if (!turf) {
    return;
  }

  const owner = await userModel.findById(turf.postedBy).exec();
  const ownerAccountId = owner?.hostOnboarding?.razorpayAccountId;

  if (!ownerAccountId || !isHostPayoutReady(owner?.hostOnboarding)) {
    logger.warn(
      `Skipping payout transfer for booking ${booking._id}: owner payout account not active`,
    );
    return;
  }

  const { platformFeeAmount, ownerPayoutAmount } =
    rajorpayService.calculateOwnerPayoutAmount(booking.totalAmount);

  if (ownerPayoutAmount <= 0) {
    booking.platformFeeAmount = platformFeeAmount;
    booking.ownerPayoutAmount = 0;
    await booking.save();
    return;
  }

  try {
    const transferResponse = await rajorpayService.createTransfersFromPayment(
      paymentId,
      [
        {
          account: ownerAccountId,
          amount: Math.round(ownerPayoutAmount * 100),
        },
      ],
    );

    const transferId = transferResponse.items?.[0]?.id;
    booking.platformFeeAmount = platformFeeAmount;
    booking.ownerPayoutAmount = ownerPayoutAmount;
    booking.razorpayTransferId = transferId;
    await booking.save();
  } catch (error) {
    logger.error(
      `Failed owner payout transfer for booking ${booking._id}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
