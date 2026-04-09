import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';

// Password validation regex
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
const otpRegex = /^\d{6}$/;

// Register Schema
export const RegisterSchema = z.object({
  email: z.email('Please provide a valid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .max(50, 'Password must not exceed 50 characters')
    .regex(passwordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
  fullName: z.string()
    .min(2, 'Full name must be at least 2 characters long')
    .max(100, 'Full name must not exceed 100 characters'),
  phone: z.string()
    .regex(phoneRegex, 'Please provide a valid phone number')
    .optional(),
  bio: z.string()
    .max(500, 'Bio must not exceed 500 characters')
    .optional(),
});

// Login Schema
export const LoginSchema = z.object({
  email: z.email('Please provide a valid email address'),
  password: z.string().min(1, 'Password cannot be empty'),
});

// Change Password Schema
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').optional(),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(otpRegex, 'OTP must be 6 digits')
    .optional(),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters long')
    .max(50, 'New password must not exceed 50 characters')
    .regex(passwordRegex, 'New password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
});

// Forgot Password Schema
export const ForgotPasswordSchema = z.object({
  email: z.email('Please provide a valid email address'),
});

// Reset Password Schema
export const ResetPasswordSchema = z.object({
  email: z.email('Please provide a valid email address'),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(otpRegex, 'OTP must be 6 digits'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .max(50, 'Password must not exceed 50 characters')
    .regex(passwordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
});

// Update Profile Schema
export const UpdateProfileSchema = z.object({
  fullName: z.string()
    .min(2, 'Full name must be at least 2 characters long')
    .max(100, 'Full name must not exceed 100 characters')
    .optional(),
  phone: z.string()
    .regex(phoneRegex, 'Please provide a valid phone number')
    .optional(),
  bio: z.string()
    .max(500, 'Bio must not exceed 500 characters')
    .optional(),
  avatar: z.string().optional(),
});

// Send Verification Email Schema
export const SendVerificationEmailSchema = z.object({
  email: z.email('Please provide a valid email address'),
});

// Verify Email Schema
export const VerifyEmailSchema = z.object({
  email: z.email('Please provide a valid email address'),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(otpRegex, 'OTP must be 6 digits'),
});

// Google Mobile Auth Schema
export const GoogleMobileAuthSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export const VerifyLoginOtpSchema = z.object({
  email: z.email('Please provide a valid email address'),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(otpRegex, 'OTP must be 6 digits'),
});

export const UpdateTwoFactorSchema = z.object({
  enabled: z.boolean(),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(otpRegex, 'OTP must be 6 digits'),
});

export const UpdateNotificationSettingsSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  smsNotificationsEnabled: z.boolean().optional(),
});

const RegisterDtoBase: ZodDto<typeof RegisterSchema> =
  createZodDto(RegisterSchema);
const LoginDtoBase: ZodDto<typeof LoginSchema> = createZodDto(LoginSchema);
const ChangePasswordDtoBase: ZodDto<typeof ChangePasswordSchema> =
  createZodDto(ChangePasswordSchema);
const ForgotPasswordDtoBase: ZodDto<typeof ForgotPasswordSchema> =
  createZodDto(ForgotPasswordSchema);
const ResetPasswordDtoBase: ZodDto<typeof ResetPasswordSchema> =
  createZodDto(ResetPasswordSchema);
const UpdateProfileDtoBase: ZodDto<typeof UpdateProfileSchema> =
  createZodDto(UpdateProfileSchema);
const SendVerificationEmailDtoBase: ZodDto<typeof SendVerificationEmailSchema> =
  createZodDto(SendVerificationEmailSchema);
const VerifyEmailDtoBase: ZodDto<typeof VerifyEmailSchema> =
  createZodDto(VerifyEmailSchema);
const GoogleMobileAuthDtoBase: ZodDto<typeof GoogleMobileAuthSchema> =
  createZodDto(GoogleMobileAuthSchema);
const VerifyLoginOtpDtoBase: ZodDto<typeof VerifyLoginOtpSchema> =
  createZodDto(VerifyLoginOtpSchema);
const UpdateTwoFactorDtoBase: ZodDto<typeof UpdateTwoFactorSchema> =
  createZodDto(UpdateTwoFactorSchema);
const UpdateNotificationSettingsDtoBase: ZodDto<
  typeof UpdateNotificationSettingsSchema
> = createZodDto(UpdateNotificationSettingsSchema);

// DTO Classes using nestjs-zod
export class RegisterDto extends RegisterDtoBase {}
export class LoginDto extends LoginDtoBase {}
export class ChangePasswordDto extends ChangePasswordDtoBase {}
export class ForgotPasswordDto extends ForgotPasswordDtoBase {}
export class ResetPasswordDto extends ResetPasswordDtoBase {}
export class UpdateProfileDto extends UpdateProfileDtoBase {}
export class SendVerificationEmailDto extends SendVerificationEmailDtoBase {}
export class VerifyEmailDto extends VerifyEmailDtoBase {}
export class GoogleMobileAuthDto extends GoogleMobileAuthDtoBase {}
export class VerifyLoginOtpDto extends VerifyLoginOtpDtoBase {}
export class UpdateTwoFactorDto extends UpdateTwoFactorDtoBase {}
export class UpdateNotificationSettingsDto extends UpdateNotificationSettingsDtoBase {}
