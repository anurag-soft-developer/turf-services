import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IUser } from '../../users/interfaces/user.interface';

export const CurrentUser = createParamDecorator(
  (
    data: keyof IUser | undefined,
    ctx: ExecutionContext,
  ): IUser | string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // If a specific property is requested, return that property
    if (data && user) {
      return user[data];
    }

    // Otherwise return the full user object
    return user;
  },
);
