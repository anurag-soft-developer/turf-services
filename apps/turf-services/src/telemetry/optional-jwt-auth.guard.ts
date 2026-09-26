import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Missing Authorization stores the batch with userId null.
 * A present header is verified; failure is 401 so the client can refresh and retry.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
    }>();
    const authorization = request.headers?.authorization;
    if (typeof authorization !== 'string' || authorization.trim() === '') {
      return true;
    }
    return super.canActivate(context);
  }
}
