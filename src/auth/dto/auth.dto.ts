import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Password validation regex
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
const otpRegex = /^\d{6}$/;

// Register Schema
export const RegisterSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
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
  email: z.string().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password cannot be empty'),
});

// Change Password Schema
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters long')
    .max(50, 'New password must not exceed 50 characters')
    .regex(passwordRegex, 'New password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
});

// Forgot Password Schema
export const ForgotPasswordSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
});

// Reset Password Schema
export const ResetPasswordSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
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
  email: z.string().email('Please provide a valid email address'),
});

// Verify Email Schema
export const VerifyEmailSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(otpRegex, 'OTP must be 6 digits'),
});

// Google Mobile Auth Schema
export const GoogleMobileAuthSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

// DTO Classes using nestjs-zod
export class RegisterDto extends createZodDto(RegisterSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
export class SendVerificationEmailDto extends createZodDto(SendVerificationEmailSchema) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}
export class GoogleMobileAuthDto extends createZodDto(GoogleMobileAuthSchema) {}
