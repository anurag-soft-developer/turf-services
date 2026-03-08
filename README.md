# Truf Services

A NestJS-based authentication service with email verification and password reset functionality using OTP (One-Time Password) system.

## Features

- **User Authentication**: Registration, login, logout with JWT tokens
- **Email Verification**: OTP-based email verification system
- **Password Reset**: Secure password reset with OTP
- **OAuth Integration**: Google OAuth2 authentication
- **React Email Templates**: Beautiful, responsive email templates
- **Security**: Password hashing with bcrypt, JWT access and refresh tokens
- **Role-based Access**: User role management system

## Technology Stack

- **Framework**: NestJS (Node.js)
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT, Passport.js
- **Email Templates**: React Email
- **Email Service**: Nodemailer
- **Validation**: class-validator
- **Password Hashing**: bcryptjs

## Project Setup

### Prerequisites

- Node.js (v16 or higher)
- MongoDB
- SMTP email service (Gmail, SendGrid, etc.)

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd truf-services
```

2. Install dependencies
```bash
npm install
```

3. Environment Configuration
```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/truf-services

# JWT Configuration
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-jwt-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=7d

# Email Configuration (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@trufservices.com

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Application
PORT=3000
FRONTEND_URL=http://localhost:3000
APP_NAME=Truf Services
```

## Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run start:prod
```

The server will start at `http://localhost:3000`

## API Endpoints

### Authentication

#### Register User
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password123!",
  "fullName": "John Doe",
  "phone": "+1234567890" (optional),
  "bio": "User bio" (optional)
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password123!"
}
```

#### Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "your-refresh-token"
}
```

### Email Verification

#### Send Verification Email
```http
POST /auth/send-verification-email
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Verify Email with OTP
```http
POST /auth/verify-email
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

### Password Reset

#### Send Password Reset Email
```http
POST /auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Reset Password with OTP
```http
POST /auth/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "password": "NewPassword123!"
}
```

### User Management

#### Get User Profile
```http
GET /auth/profile
Authorization: Bearer <access-token>
```

#### Update Profile
```http
PATCH /auth/profile
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "fullName": "New Name",
  "phone": "+9876543210",
  "bio": "Updated bio"
}
```

#### Change Password
```http
POST /auth/change-password
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

### OAuth

#### Google OAuth
```http
GET /auth/google
```

## OTP System

The application uses a secure OTP (One-Time Password) system for email verification and password reset:

### Key Features:
- **6-digit OTP**: Random 6-digit codes for verification
- **Key Concatenation**: OTP is concatenated with a context key (e.g., "EMAIL_VERIFICATION:123456")
- **Expiration**: OTPs expire after 10 minutes
- **Context Validation**: Server validates both OTP and context key
- **Security**: Keys are stored server-side only for identification

### OTP Types:
- `EMAIL_VERIFICATION`: For email verification
- `PASSWORD_RESET`: For password reset

## Email Templates

The application uses React Email for beautiful, responsive email templates located in `/src/templates/`:

- **Verification Email**: For email verification with OTP
- **Password Reset Email**: For password reset with OTP

### Template Development
```bash
cd src/templates
npm run dev  # Preview templates in development
```

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## File Structure

```
src/
├── auth/                    # Authentication module
│   ├── decorators/         # Custom decorators
│   ├── dto/                # Data transfer objects
│   ├── guards/             # Authentication guards
│   ├── interfaces/         # TypeScript interfaces
│   └── strategies/         # Passport strategies
├── common/
│   ├── services/           # Shared services
│   └── utils/              # Utility functions
├── config/                 # Configuration files
├── templates/              # React Email templates
└── users/                  # User management module
```

## Security Features

- **Password Hashing**: bcrypt with 12 salt rounds
- **JWT Tokens**: Access and refresh token system
- **Email Verification**: Required for account activation
- **Rate Limiting**: Built-in protection against brute force
- **OTP Security**: Context-aware OTP validation
- **OAuth Integration**: Secure third-party authentication

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

For support, email support@trufservices.com or create an issue in the repository.
