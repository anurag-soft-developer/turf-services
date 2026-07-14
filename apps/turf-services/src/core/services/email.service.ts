import { Injectable } from '@nestjs/common';
import { render } from '@react-email/components';
import * as nodemailer from 'nodemailer';
import { OtpEmailTemplate } from '../templates/email/otp-email';
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

interface SendOtpEmailOptions {
  to: string;
  userFullName: string;
  otpCode: string;
  subject: string;
  title?: string;
  instructionText: string;
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
        OtpEmailTemplate({
          userFullName: options.userFullName,
          otpCode: options.otpCode,
          title: 'Verify Your Email Address',
          instructionText:
            'Welcome! Use the following one-time password (OTP) to verify your email address.',
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
        OtpEmailTemplate({
          userFullName: options.userFullName,
          otpCode: options.otpCode,
          title: 'Reset Your Password',
          instructionText:
            'We received a request to reset your password. Use the code below to continue.',
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

  async sendOtpEmail(options: SendOtpEmailOptions): Promise<void> {
    try {
      const emailHtml = await render(
        OtpEmailTemplate({
          userFullName: options.userFullName,
          otpCode: options.otpCode,
          title: options.title ?? 'Your OTP Code',
          instructionText: options.instructionText,
          companyName: config.APP_NAME,
        }),
      );

      await this.transporter.sendMail({
        from: config.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        html: emailHtml,
      });
    } catch (error) {
      console.error('Error sending OTP email:', error);
      throw new Error('Failed to send OTP email');
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
