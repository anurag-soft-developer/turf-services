import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from './config/env.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      config.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Set global prefix
  app.setGlobalPrefix('api/v1');

  await app.listen(config.PORT);
  logger.log(`🚀 Application is running on: http://localhost:${config.PORT}`);
  logger.log(`📖 API Documentation: http://localhost:${config.PORT}/api`);
  logger.log(`🌍 Environment: ${config.NODE_ENV}`);
  logger.log(`📱 App: ${config.APP_NAME} v${config.APP_VERSION}`);
}
bootstrap();
