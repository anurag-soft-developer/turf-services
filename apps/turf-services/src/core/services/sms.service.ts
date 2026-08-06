import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import { config } from '../config/env.config';

interface SendOtpSmsOptions {
  to: string;
  otpCode: string;
  purpose: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: ReturnType<typeof twilio>;

  constructor() {
    this.client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }

  async sendOtpSms(options: SendOtpSmsOptions): Promise<void> {
    const body = `${config.APP_NAME}: Your ${options.purpose} code is ${options.otpCode}. It expires in 10 minutes.`;

    try {
      await this.client.messages.create({
        body,
        from: config.TWILIO_FROM_NUMBER,
        to: options.to,
      });
    } catch (error) {
      this.logger.error('Error sending OTP SMS', error);
      throw new Error('Failed to send OTP SMS');
    }
  }

  async sendTeamInviteSms(options: {
    to: string;
    inviterName: string;
    teamName: string;
  }): Promise<void> {
    const body = `${config.APP_NAME}: ${options.inviterName} invited you to join ${options.teamName}. Open the app, sign up or log in with this number, then go to Invitations to accept or decline.`;

    try {
      await this.client.messages.create({
        body,
        from: config.TWILIO_FROM_NUMBER,
        to: options.to,
      });
    } catch (error) {
      this.logger.error('Error sending team invite SMS', error);
      throw new Error('Failed to send team invite SMS');
    }
  }
}
