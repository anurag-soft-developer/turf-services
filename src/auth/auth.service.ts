import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtAuthService } from './jwt-auth.service';
import { RegisterDto, LoginDto, ChangePasswordDto } from './dto/auth.dto';
import type { IUser, Profile } from '../users/interfaces/user.interface';
import { OAuthProvider, UserDocument } from 'users/schemas/user.schema';
import { IAuthResponse } from './interfaces/auth.interface';
import { GoogleProfile } from './strategies/google.strategy';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtAuthService: JwtAuthService,
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
