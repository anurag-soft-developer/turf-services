import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtAuthService } from './jwt-auth.service';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  SendVerificationEmailDto,
  VerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyLoginOtpDto,
  UpdateTwoFactorDto,
  UpdateNotificationSettingsDto,
} from './dto/auth.dto';
import type { IUser, Profile } from '../users/interfaces/user.interface';
import ms from 'ms';
import {
  OAuthProvider,
  OtpKeys,
  UserDocument,
} from '../users/schemas/user.schema';
import {
  IAuthOtpChallengeResponse,
  IAuthResponse,
} from './interfaces/auth.interface';
import { GoogleProfile } from './strategies/google.strategy';
import { EmailService } from '../core/services/email.service';
import type { CookieOptions, Response } from 'express';
import { config } from '../core/config/env.config';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtAuthService: JwtAuthService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto): Promise<IAuthResponse> {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const user = await this.usersService.create({
      ...registerDto,
    });

    const accessToken = this.jwtAuthService.generateAccessToken(user);
    const refreshToken = this.jwtAuthService.generateRefreshToken(user);

    await this.usersService.updateLastLogin(user._id.toString());

    return {
      user: UsersService.sanitizeProfile(user),
      accessToken,
      refreshToken,
    };
  }

  async login(
    loginDto: LoginDto,
  ): Promise<IAuthResponse | IAuthOtpChallengeResponse> {
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'Please use social login or reset your password',
      );
    }

    const isValidPassword = await this.usersService.validatePassword(
      loginDto.password,
      user.password,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.twoFactorEnabled) {
      const { otpWithKey, otpDisplay } = this.generateOTP(OtpKeys.LOGIN_2FA);
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await this.usersService.updateOTP(user._id.toString(), otpWithKey, otpExpiry);
      await this.emailService.sendOtpEmail({
        to: user.email,
        userFullName: user.fullName || 'User',
        otpCode: otpDisplay,
        subject: 'Your Login OTP Code',
        title: 'Login Verification',
        instructionText:
          'Use the following one-time password (OTP) to complete your login.',
      });

      return {
        message: 'OTP sent to your registered email',
        requiresOtp: true,
        email: user.email,
      };
    }

    const accessToken = this.jwtAuthService.generateAccessToken(user);
    const refreshToken = this.jwtAuthService.generateRefreshToken(user);

    await this.usersService.updateLastLogin(user._id.toString());

    return {
      user: UsersService.sanitizeProfile(user),
      accessToken,
      refreshToken,
    };
  }

  async verifyLoginOtp(verifyLoginOtpDto: VerifyLoginOtpDto): Promise<IAuthResponse> {
    const user = await this.usersService.findByEmailWithOTP(verifyLoginOtpDto.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.otp || !user.otpExpiry) {
      throw new BadRequestException('No OTP found. Please login again');
    }

    if (new Date() > user.otpExpiry) {
      throw new BadRequestException('OTP has expired. Please login again');
    }

    const { otp: storedOtp, key: storedKey } = this.splitOTPAndKey(user.otp);
    if (storedKey !== OtpKeys.LOGIN_2FA || storedOtp !== verifyLoginOtpDto.otp) {
      throw new BadRequestException('Invalid OTP');
    }

    await this.usersService.clearOTP(user._id.toString());

    const accessToken = this.jwtAuthService.generateAccessToken(user);
    const refreshToken = this.jwtAuthService.generateRefreshToken(user);

    await this.usersService.updateLastLogin(user._id.toString());

    return {
      user: UsersService.sanitizeProfile(user),
      accessToken,
      refreshToken,
    };
  }

  async googleLogin(profile: GoogleProfile): Promise<IAuthResponse> {
    if (!profile.emails || profile.emails.length === 0) {
      throw new BadRequestException('No email found in Google profile');
    }

    const email = profile.emails[0].value;
    const fullName = profile.name
      ? `${profile.name.givenName} ${profile.name.familyName}`.trim()
      : undefined;
    const avatar =
      profile.photos && profile.photos.length > 0
        ? profile.photos[0].value
        : undefined;

    const user = await this.usersService.createOrUpdateFromOAuth(email, {
      provider: OAuthProvider.GOOGLE,
      id: profile.id,
      fullName,
      avatar,
    });

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const accessToken = this.jwtAuthService.generateAccessToken(user);
    const refreshToken = this.jwtAuthService.generateRefreshToken(user);

    await this.usersService.updateLastLogin(user._id.toString());

    return {
      user: UsersService.sanitizeProfile(user),
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(refreshToken: string): Promise<{
    user: Profile;
    accessToken: string;
    refreshToken: string;
  }> {
    try {
      const payload =
        await this.jwtAuthService.verifyRefreshToken(refreshToken);
      const user = await this.usersService.findById(payload.sub);

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newAccessToken = this.jwtAuthService.generateAccessToken(user);
      const newRefreshToken = this.jwtAuthService.generateRefreshToken(user);

      return {
        user: UsersService.sanitizeProfile(user),
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const userBase = await this.usersService.findById(userId);
    if (!userBase) {
      throw new NotFoundException('User not found');
    }

    const user = await this.usersService.findByEmailWithPassword(
      userBase.email,
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      if (!changePasswordDto.otp) {
        throw new BadRequestException(
          'OTP is required to set password for OAuth accounts',
        );
      }

      await this.assertValidChangePasswordOtp(
        userBase.email,
        changePasswordDto.otp,
      );

      await this.usersService.changePassword(userId, changePasswordDto.newPassword);
      await this.usersService.clearOTP(userId);
      return;
    }

    if (!changePasswordDto.currentPassword) {
      throw new BadRequestException('Current password is required');
    }

    const isValidPassword = await this.usersService.validatePassword(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (user.twoFactorEnabled) {
      if (!changePasswordDto.otp) {
        throw new BadRequestException(
          'OTP is required to change your password while two-factor authentication is enabled. Request a code using the password change OTP flow.',
        );
      }

      await this.assertValidChangePasswordOtp(
        userBase.email,
        changePasswordDto.otp,
      );
    }

    await this.usersService.changePassword(
      userId,
      changePasswordDto.newPassword,
    );

    if (user.password && user.twoFactorEnabled) {
      await this.usersService.clearOTP(userId);
    }
  }

  async sendChangePasswordOtp(userId: string): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { otpWithKey, otpDisplay } = this.generateOTP(OtpKeys.CHANGE_PASSWORD);
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await this.usersService.updateOTP(user._id.toString(), otpWithKey, otpExpiry);

    await this.emailService.sendOtpEmail({
      to: user.email,
      userFullName: user.fullName || 'User',
      otpCode: otpDisplay,
      subject: 'Password Change OTP',
      title: 'Password Change Verification',
      instructionText:
        'Use the following one-time password (OTP) to continue changing your password.',
    });

    return { message: 'Password change OTP sent to your email' };
  }

  async updateTwoFactor(
    userId: string,
    updateTwoFactorDto: UpdateTwoFactorDto,
  ): Promise<Profile> {
    const userBase = await this.usersService.findById(userId);
    if (!userBase) {
      throw new NotFoundException('User not found');
    }

    const userWithOtp = await this.usersService.findByEmailWithOTP(userBase.email);
    if (!userWithOtp || !userWithOtp.otp || !userWithOtp.otpExpiry) {
      throw new BadRequestException('No 2FA OTP found. Please request a new one');
    }

    if (new Date() > userWithOtp.otpExpiry) {
      throw new BadRequestException('2FA OTP has expired. Please request a new one');
    }

    const { otp: storedOtp, key: storedKey } = this.splitOTPAndKey(userWithOtp.otp);
    if (storedKey !== OtpKeys.UPDATE_2FA || storedOtp !== updateTwoFactorDto.otp) {
      throw new BadRequestException('Invalid OTP for 2FA update');
    }

    const user = await this.usersService.updateById(userId, {
      twoFactorEnabled: updateTwoFactorDto.enabled,
    });
    await this.usersService.clearOTP(userId);
    return UsersService.sanitizeProfile(user);
  }

  async sendTwoFactorOtp(userId: string): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { otpWithKey, otpDisplay } = this.generateOTP(OtpKeys.UPDATE_2FA);
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await this.usersService.updateOTP(user._id.toString(), otpWithKey, otpExpiry);

    await this.emailService.sendOtpEmail({
      to: user.email,
      userFullName: user.fullName || 'User',
      otpCode: otpDisplay,
      subject: '2FA Settings OTP',
      title: '2FA Settings Verification',
      instructionText:
        'Use the following one-time password (OTP) to update your 2FA settings.',
    });

    return { message: '2FA OTP sent to your email' };
  }

  async updateNotificationSettings(
    userId: string,
    updateNotificationSettingsDto: UpdateNotificationSettingsDto,
  ): Promise<Profile> {
    const user = await this.usersService.updateById(userId, {
      emailNotificationsEnabled: updateNotificationSettingsDto.emailNotificationsEnabled,
      smsNotificationsEnabled: updateNotificationSettingsDto.smsNotificationsEnabled,
    });
    return UsersService.sanitizeProfile(user);
  }

  async sendVerificationEmail(
    sendVerificationEmailDto: SendVerificationEmailDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(
      sendVerificationEmailDto.email,
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const { otpWithKey, otpDisplay } = this.generateOTP(OtpKeys.VERIFY_EMAIL);
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.usersService.updateOTP(
      user._id.toString(),
      otpWithKey,
      otpExpiry,
    );

    await this.emailService.sendVerificationEmail({
      to: user.email,
      userFullName: user.fullName || 'User',
      otpCode: otpDisplay,
    });

    return { message: 'Verification email sent successfully' };
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const user = await this.usersService.findByEmailWithOTP(
      verifyEmailDto.email,
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    if (!user.otp || !user.otpExpiry) {
      throw new BadRequestException(
        'No verification code found. Please request a new one',
      );
    }

    if (new Date() > user.otpExpiry) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new one',
      );
    }

    const { otp: storedOtp, key: storedKey } = this.splitOTPAndKey(user.otp);

    if (storedOtp !== verifyEmailDto.otp) {
      throw new BadRequestException('Invalid verification code');
    }

    if (storedKey !== OtpKeys.VERIFY_EMAIL) {
      throw new BadRequestException('Invalid verification context');
    }

    const updatedUser = await this.usersService.updateById(
      user._id.toString(),
      {
        isEmailVerified: true,
        otp: undefined,
        otpExpiry: undefined,
      },
    );

    const accessToken = this.jwtAuthService.generateAccessToken(updatedUser);
    const refreshToken = this.jwtAuthService.generateRefreshToken(updatedUser);

    return {
      message: 'Email verified successfully',
      accessToken,
      refreshToken,
    };
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(forgotPasswordDto.email);

    if (!user) {
      // Don't reveal if user exists for security reasons
      return {
        message:
          'If an account with that email exists, we have sent a password reset code',
      };
    }

    const { otpWithKey, otpDisplay } = this.generateOTP(
      OtpKeys.FORGOT_PASSWORD,
    );
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.usersService.updateOTP(
      user._id.toString(),
      otpWithKey,
      otpExpiry,
    );

    await this.emailService.sendPasswordResetEmail({
      to: user.email,
      userFullName: user.fullName || 'User',
      otpCode: otpDisplay,
    });

    return {
      message:
        'If an account with that email exists, we have sent a password reset code',
    };
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailWithOTP(
      resetPasswordDto.email,
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.otp || !user.otpExpiry) {
      throw new BadRequestException(
        'No reset code found. Please request a new one',
      );
    }

    if (new Date() > user.otpExpiry) {
      throw new BadRequestException(
        'Reset code has expired. Please request a new one',
      );
    }

    const { otp: storedOtp, key: storedKey } = this.splitOTPAndKey(user.otp);

    if (storedOtp !== resetPasswordDto.otp) {
      throw new BadRequestException('Invalid reset code');
    }

    if (storedKey !== OtpKeys.FORGOT_PASSWORD) {
      throw new BadRequestException('Invalid reset context');
    }

    await this.usersService.changePassword(
      user._id.toString(),
      resetPasswordDto.password,
    );
    await this.usersService.clearOTP(user._id.toString());

    return { message: 'Password reset successfully' };
  }

  private getCookieOptions(): CookieOptions {
    // const isProduction = config.NODE_ENV === 'production';

    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      // domain: isProduction ? config.COOKIE_DOMAIN : undefined,
    };
  }

  setCookies(res: Response, accessToken: string, refreshToken: string): void {
    const accessTokenOptions = this.getCookieOptions();

    accessTokenOptions.maxAge = ms(config.JWT_EXPIRES_IN); // 7 days

    const refreshTokenOptions: CookieOptions = {
      ...accessTokenOptions,
      maxAge: ms(config.JWT_REFRESH_EXPIRES_IN), // 7 days
    };

    res.cookie('accessToken', accessToken, accessTokenOptions);
    res.cookie('refreshToken', refreshToken, refreshTokenOptions);
  }

  clearCookies(res: Response): void {
    const clearOptions = this.getCookieOptions();

    res.clearCookie('accessToken', clearOptions);
    res.clearCookie('refreshToken', clearOptions);
  }

  private async assertValidChangePasswordOtp(
    email: string,
    otp: string,
  ): Promise<void> {
    const userWithOtp = await this.usersService.findByEmailWithOTP(email);
    if (!userWithOtp || !userWithOtp.otp || !userWithOtp.otpExpiry) {
      throw new BadRequestException(
        'No password change OTP found. Please request a new one',
      );
    }

    if (new Date() > userWithOtp.otpExpiry) {
      throw new BadRequestException(
        'Password change OTP has expired. Please request a new one',
      );
    }

    const { otp: storedOtp, key: storedKey } = this.splitOTPAndKey(
      userWithOtp.otp,
    );
    if (storedKey !== OtpKeys.CHANGE_PASSWORD || storedOtp !== otp) {
      throw new BadRequestException('Invalid OTP for password change');
    }
  }

  private generateOTP(key: OtpKeys): {
    otpWithKey: string;
    otpDisplay: string;
  } {
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    const otpWithKey = `${key}:${otp}`;

    return {
      otpWithKey,
      otpDisplay: otp,
    };
  }

  private splitOTPAndKey(otpWithKey: string): { key: OtpKeys; otp: string } {
    const parts = otpWithKey.split(':');
    if (
      parts.length !== 2 ||
      !Object.values(OtpKeys).includes(parts[0] as OtpKeys)
    ) {
      throw new BadRequestException('Invalid OTP format');
    }

    return {
      key: parts[0] as OtpKeys,
      otp: parts[1],
    };
  }

}
