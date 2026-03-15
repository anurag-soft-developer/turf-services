import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import morgan from 'morgan';
import { AppModule } from './app.module';
import { config } from './config/env.config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(cookieParser());

  app.use(
    morgan(
      '📨 :method :url :status :res[content-length] - :response-time ms - :remote-addr',
    ),
  );

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

  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`🚀 Application is running on: http://0.0.0.0:${config.PORT}`);
  logger.log(`🌍 Environment: ${config.NODE_ENV}`);
}
bootstrap();
