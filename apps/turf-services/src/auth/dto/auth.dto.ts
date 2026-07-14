import { z } from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { normalizePhone } from '../../core/utils/phone.util';

// Password validation regex
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const otpRegex = /^\d{6}$/;

const optionalEmail = z.email('Please provide a valid email address').optional();

const optionalPhone = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') {
    return undefined;
  }
  if (typeof val !== 'string') {
    return val;
  }
  return normalizePhone(val);
}, z.string().optional());

const exactlyOneContactRefine = {
  message: 'Provide exactly one of email or phone',
  path: ['email'] as (string | number)[],
};

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(50, 'Password must not exceed 50 characters')
  .regex(
    passwordRegex,
    'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
  );

const otpField = z
  .string()
  .length(6, 'OTP must be 6 digits')
  .regex(otpRegex, 'OTP must be 6 digits');

// Register Schema
export const RegisterSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    password: passwordField,
    fullName: z
      .string()
      .min(2, 'Full name must be at least 2 characters long')
      .max(100, 'Full name must not exceed 100 characters'),
    bio: z.string().max(500, 'Bio must not exceed 500 characters').optional(),
  })
  .refine(
    (data) => Boolean(data.email) !== Boolean(data.phone),
    exactlyOneContactRefine,
  );

// Login Schema
export const LoginSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    password: z.string().min(1, 'Password cannot be empty'),
  })
  .refine(
    (data) => Boolean(data.email) !== Boolean(data.phone),
    exactlyOneContactRefine,
  );

// Change Password Schema
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').optional(),
  otp: otpField.optional(),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters long')
    .max(50, 'New password must not exceed 50 characters')
    .regex(
      passwordRegex,
      'New password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
    ),
});

// Forgot Password Schema
export const ForgotPasswordSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
  })
  .refine(
    (data) => Boolean(data.email) !== Boolean(data.phone),
    exactlyOneContactRefine,
  );

// Reset Password Schema
export const ResetPasswordSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    otp: otpField,
    password: passwordField,
  })
  .refine(
    (data) => Boolean(data.email) !== Boolean(data.phone),
    exactlyOneContactRefine,
  );

// Update Profile Schema
export const UpdateProfileSchema = z.object({
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters long')
    .max(100, 'Full name must not exceed 100 characters')
    .optional(),
  bio: z.string().max(500, 'Bio must not exceed 500 characters').optional(),
  avatar: z.string().optional(),
});

// Send Verification Email Schema
export const SendVerificationEmailSchema = z.object({
  email: z.email('Please provide a valid email address'),
});

// Verify Email Schema
export const VerifyEmailSchema = z.object({
  email: z.email('Please provide a valid email address'),
  otp: otpField,
});

// Google Mobile Auth Schema
export const GoogleMobileAuthSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export const VerifyLoginOtpSchema = z
  .object({
    email: optionalEmail,
    phone: optionalPhone,
    otp: otpField,
  })
  .refine(
    (data) => Boolean(data.email) !== Boolean(data.phone),
    exactlyOneContactRefine,
  );

export const UpdateTwoFactorSchema = z.object({
  enabled: z.boolean(),
  otp: otpField,
});

export const UpdateNotificationSettingsSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  smsNotificationsEnabled: z.boolean().optional(),
});

// DTO Classes using nestjs-zod
export class RegisterDto extends createZodDto(RegisterSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
export class SendVerificationEmailDto extends createZodDto(
  SendVerificationEmailSchema,
) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}
export class GoogleMobileAuthDto extends createZodDto(GoogleMobileAuthSchema) {}
export class VerifyLoginOtpDto extends createZodDto(VerifyLoginOtpSchema) {}
export class UpdateTwoFactorDto extends createZodDto(UpdateTwoFactorSchema) {}
export class UpdateNotificationSettingsDto extends createZodDto(
  UpdateNotificationSettingsSchema,
) {}
