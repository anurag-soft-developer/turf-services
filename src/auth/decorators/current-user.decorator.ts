import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IUser } from '../../users/interfaces/user.interface';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): IUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);