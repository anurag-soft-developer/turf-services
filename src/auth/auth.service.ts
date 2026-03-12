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
} from './dto/auth.dto';
import type { IUser, Profile } from '../users/interfaces/user.interface';
import {
  OAuthProvider,
  OtpKeys,
  UserDocument,
} from '../users/schemas/user.schema';
import { IAuthResponse } from './interfaces/auth.interface';
import { GoogleProfile } from './strategies/google.strategy';
import { EmailService } from '../common/services/email.service';
import type { CookieOptions, Response } from 'express';
import { config } from '../config/env.config';

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
      user: this.sanitizeProfile(user),
      accessToken,
      refreshToken,
    };
  }

  async login(loginDto: LoginDto): Promise<IAuthResponse> {
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

    const accessToken = this.jwtAuthService.generateAccessToken(user);
    const refreshToken = this.jwtAuthService.generateRefreshToken(user);

    await this.usersService.updateLastLogin(user._id.toString());

    return {
      user: this.sanitizeProfile(user),
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
      user: this.sanitizeProfile(user),
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
        user: this.sanitizeProfile(user),
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

    if (!user || !user.password) {
      throw new BadRequestException('Cannot change password for this account');
    }

    const isValidPassword = await this.usersService.validatePassword(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.usersService.changePassword(
      userId,
      changePasswordDto.newPassword,
    );
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
    const isProduction = config.NODE_ENV === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      domain: isProduction ? config.COOKIE_DOMAIN : undefined,
    };
  }

  setCookies(res: Response, accessToken: string, refreshToken: string): void {
    const accessTokenOptions = this.getCookieOptions();

    accessTokenOptions.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    const refreshTokenOptions: CookieOptions = {
      ...accessTokenOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    res.cookie('accessToken', accessToken, accessTokenOptions);
    res.cookie('refreshToken', refreshToken, refreshTokenOptions);
  }

  clearCookies(res: Response): void {
    const clearOptions = this.getCookieOptions();

    res.clearCookie('accessToken', clearOptions);
    res.clearCookie('refreshToken', clearOptions);
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

  sanitizeProfile(user: IUser | UserDocument): Profile {
    return {
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      avatar: user.avatar,
      isActive: user.isActive,
      isVerified: user.isVerified,
      isEmailVerified: user.isEmailVerified,
      phone: user.phone,
      bio: user.bio,
      lastLogin: user.lastLogin?.toString(),
      createdAt: user.createdAt.toString(),
      updatedAt: user.updatedAt.toString(),
    };
  }
}
