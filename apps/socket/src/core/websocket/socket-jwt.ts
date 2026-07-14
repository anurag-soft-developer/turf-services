import { createHmac, timingSafeEqual } from 'crypto';
import { Socket } from 'socket.io';
import { z } from 'zod';
import { config } from '../config/env.config';

const jwtHeaderSchema = z.object({
  alg: z.literal('HS256'),
});

const jwtPayloadSchema = z
  .object({
    sub: z.string().min(1),
    exp: z.number().int().positive().optional(),
    nbf: z.number().int().positive().optional(),
  })
  .loose();

export function extractSocketToken(socket: Socket): string | null {
  const candidates = [
    socket.handshake.auth?.token,
    socket.handshake.auth?.accessToken,
    socket.handshake.query?.token,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === 'string') {
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (bearerMatch?.[1]) {
      return bearerMatch[1];
    }
  }

  return null;
}

export function verifySocketAccessToken(
  token: string,
  jwtSecret: string = config.JWT_SECRET,
): { sub: string } | null {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return null;
    }

    const headerResult = jwtHeaderSchema.safeParse(
      JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')),
    );
    if (!headerResult.success) {
      return null;
    }

    const payloadResult = jwtPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')),
    );
    if (!payloadResult.success) {
      return null;
    }

    const payload = payloadResult.data;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp <= now) {
      return null;
    }
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      return null;
    }
    const content = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', jwtSecret)
      .update(content)
      .digest();
    const providedSignature = Buffer.from(encodedSignature, 'base64url');

    if (
      expectedSignature.length !== providedSignature.length ||
      !timingSafeEqual(expectedSignature, providedSignature)
    ) {
      return null;
    }

    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export function socketJwtAuthMiddleware() {
  return (socket: Socket, next: (err?: Error) => void) => {
    const token = extractSocketToken(socket);
    if (!token) {
      return next(new Error('Unauthorized'));
    }
    const payload = verifySocketAccessToken(token);
    if (!payload?.sub) {
      return next(new Error('Unauthorized'));
    }
    socket.data.userId = payload.sub;
    return next();
  };
}
