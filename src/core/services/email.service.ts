import { Injectable } from '@nestjs/common';
import { render } from '@react-email/components';
import * as nodemailer from 'nodemailer';
import { VerificationEmail } from '../templates/email/verification-email';
import { PasswordResetEmail } from '../templates/email/password-reset-email';
import { config } from '../config/env.config';

interface SendVerificationEmailOptions {
  to: string;
  userFullName: string;
  otpCode: string;
}

interface SendPasswordResetEmailOptions {
  to: string;
  userFullName: string;
  otpCode: string;
}

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: parseInt(config.SMTP_PORT),
      secure: config.SMTP_PORT === '465',
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(
    options: SendVerificationEmailOptions,
  ): Promise<void> {
    try {
      const emailHtml = await render(
        VerificationEmail({
          userFullName: options.userFullName,
          otpCode: options.otpCode,
          companyName: config.APP_NAME,
        }),
      );

      const mailOptions = {
        from: config.SMTP_FROM,
        to: options.to,
        subject: 'Verify Your Email Address',
        html: emailHtml,
      };

      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(
    options: SendPasswordResetEmailOptions,
  ): Promise<void> {
    try {
      const emailHtml = await render(
        PasswordResetEmail({
          userFullName: options.userFullName,
          otpCode: options.otpCode,
          companyName: config.APP_NAME,
        }),
      );

      const mailOptions = {
        from: config.SMTP_FROM,
        to: options.to,
        subject: 'Reset Your Password',
        html: emailHtml,
      };

      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('SMTP connection failed:', error);
      return false;
    }
  }
}
