# Turf Services (Nest monorepo)

HTTP API (`apps/turf-services`) and Socket.io realtime (`apps/socket`) share Zod contracts from `libs/` (plain TS utilities). Apps communicate over HTTP with `x-internal-token` — they do not import Nest gateways across process boundaries.

```text
turf-services/
├── apps/
│   ├── turf-services/   # HTTP API (Vercel)
│   └── socket/          # Socket.io + Redis (always-on host)
├── libs/                  # Shared Zod/utility contracts (not a Nest app)
│   ├── chat/
│   ├── notification/
│   └── scoring/
├── docker-compose.yml   # Local Redis
└── nest-cli.json
```

## Features

- **User Authentication**: Registration, login, logout with JWT tokens
- **Email Verification**: OTP-based email verification system
- **Password Reset**: Secure password reset with OTP
- **OAuth Integration**: Google OAuth2 authentication
- **Realtime**: Chat, scoring updates, and in-app notifications via Socket.io
- **React Email Templates**: Responsive email templates
- **Role-based Access**: User role management system

## Technology Stack

- **Framework**: NestJS monorepo (Node.js)
- **Database**: MongoDB with Mongoose
- **Realtime**: Socket.io + Redis adapter
- **Authentication**: JWT, Passport.js
- **Email Templates**: React Email
- **Validation**: Zod (`nestjs-zod`)

## Prerequisites

- Node.js (v18 or higher)
- MongoDB
- Redis (local: `docker compose up -d`)
- SMTP email service (Gmail, SendGrid, etc.)

## Installation

```bash
git clone <repository-url>
cd turf-services
npm install
cp .env.example .env
cp apps/socket/.env.example apps/socket/.env
docker compose up -d
```

Align secrets across both `.env` files:

| Variable | API (`PORT=3000`) | Socket (`PORT=3001`) |
|---|---|---|
| `JWT_SECRET` | required | same value |
| `INTERNAL_TOKEN` | required | same value |
| `REALTIME_TURF_BASE_URL` | `http://localhost:3001` | — |
| `TURF_SERVICES_BASE_URL` | — | `http://localhost:3000` |
| `REDIS_URL` | — | `redis://localhost:6379` |

## Running locally

```bash
# Terminal 1 — HTTP API
npm run start:dev

# Terminal 2 — Socket app
npm run start:dev:socket
```

- API: `http://localhost:3000`
- Socket: `http://localhost:3001` (namespaces `/chat`, `/scoring`, `/notifications`)

## Build

```bash
npm run build          # turf-services only
npm run build:socket   # socket only
npm run build:all      # both
```

Production start:

```bash
npm run start:prod
npm run start:prod:socket
```

## Deploy

| App | Host | Build | Start |
|---|---|---|---|
| `turf-services` | Vercel | `nest build turf-services` | Existing Vercel Node adapter |
| `socket` | Railway / Render / Fly / VPS + Redis | `nest build socket` | `node dist/apps/socket/main` |

Do **not** deploy `apps/socket` to Vercel (WebSockets + Redis need a long-lived process).

On Vercel set `REALTIME_TURF_BASE_URL` to the public socket URL. On the socket host set `TURF_SERVICES_BASE_URL` to the Vercel API URL.

## Shared contracts

Plain TypeScript utilities under `libs/` (not a Nest library project). Import with a relative path:

```ts
import {
  chatRefSchema,
  scoringUpdatePayloadSchema,
  notificationDispatchSchema,
} from '../../../../libs';
```

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

## Testing

```bash
npm run test
npm run test:e2e
npm run test:cov
```

## License

This project is licensed under the MIT License.
