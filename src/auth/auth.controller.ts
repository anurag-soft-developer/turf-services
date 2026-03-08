import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Res,
  Patch,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  UpdateProfileDto,
  SendVerificationEmailDto,
  VerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { IUser } from '../users/interfaces/user.interface';
import { IAuthResponse } from './interfaces/auth.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IAuthResponse> {
    const authResult = await this.authService.register(registerDto);
    
    // Set HTTP-only cookies
    this.authService.setCookies(res, authResult.accessToken, authResult.refreshToken);
    
    return authResult;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IAuthResponse> {
    const authResult = await this.authService.login(loginDto);
    
    // Set HTTP-only cookies
    this.authService.setCookies(res, authResult.accessToken, authResult.refreshToken);
    
    return authResult;
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth(@Req() req: Request) {
    // This route initiates the Google OAuth flow
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const authResult = req.user as IAuthResponse;

    // Set HTTP-only cookies
    this.authService.setCookies(res, authResult.accessToken, authResult.refreshToken);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/auth/callback?token=${authResult.accessToken}&refresh=${authResult.refreshToken}`;

    res.redirect(redirectUrl);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Body('refreshToken') bodyRefreshToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IAuthResponse> {
    // Try to get refresh token from cookie first, then from body
    const refreshToken = req.cookies?.refreshToken || bodyRefreshToken;
    
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not provided');
    }
    
    const authResult = await this.authService.refreshToken(refreshToken);
    
    // Set new HTTP-only cookies
    this.authService.setCookies(res, authResult.accessToken, authResult.refreshToken);
    
    return authResult;
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: IUser) {
    return this.authService.sanitizeProfile(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  async getAuthStatus(@CurrentUser() user: IUser) {
    return {
      isAuthenticated: true,
      user: this.authService.sanitizeProfile(user),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: IUser,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<IUser> {
    return (
      await this.usersService.updateProfile(user._id, updateProfileDto)
    ).toObject();
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: IUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(user._id, changePasswordDto);
    return { message: 'Password changed successfully' };
  }

  @Public()
  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  async sendVerificationEmail(
    @Body() sendVerificationEmailDto: SendVerificationEmailDto,
  ): Promise<{ message: string }> {
    return this.authService.sendVerificationEmail(sendVerificationEmailDto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() verifyEmailDto: VerifyEmailDto,
  ): Promise<{ message: string }> {
    return this.authService.verifyEmail(verifyEmailDto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response): Promise<{ message: string }> {
    // Clear HTTP-only cookies
    this.authService.clearCookies(res);
    
    return { message: 'Logged out successfully' };
  }
}
