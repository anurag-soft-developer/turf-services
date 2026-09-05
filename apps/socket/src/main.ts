import { NestFactory } from '@nestjs/core';
import morgan from 'morgan';
import { SocketModule } from './socket.module';
import { RedisIoAdapter } from './chat/adapters/redis-io.adapter';
import { RedisService } from './core/redis/redis.service';
import { config } from './core/config/env.config';
import { WsLoggingInterceptor } from './core/websocket/ws-logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(SocketModule);
  app.use(morgan('combined'));
  app.useGlobalInterceptors(new WsLoggingInterceptor());
  const redisService = app.get(RedisService);
  const redisAdapter = new RedisIoAdapter(app, redisService);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  await app.listen(config.PORT);
}
bootstrap();
