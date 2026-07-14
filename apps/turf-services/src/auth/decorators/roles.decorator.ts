import { SetMetadata } from '@nestjs/common';

export enum UserRole {
  ADMIN = 'admin',
  PLATFORM_ADMIN = 'platform_admin',
  USER = 'user',
  MODERATOR = 'moderator',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
