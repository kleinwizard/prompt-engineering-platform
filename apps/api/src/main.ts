import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  
  // Security middlewares
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  
  // Request ID middleware
  app.use(new RequestIdMiddleware().use);
  
  // Global request logging interceptor
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  // CORS configuration
  app.enableCors({
    origin: configService.get('CORS_ORIGIN', 'http://localhost:3001'),
    credentials: true,
  });

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  if (configService.get('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Prompt Engineering Platform API')
      .setDescription('Comprehensive API for the Prompt Engineering Platform')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication endpoints')
      .addTag('users', 'User management')
      .addTag('prompts', 'Prompt improvement engine')
      .addTag('templates', 'Template management')
      .addTag('challenges', 'Challenges and competitions')
      .addTag('gamification', 'Points, badges, leaderboards')
      .addTag('skills', 'Skill assessment and tracking')
      .addTag('learning', 'Learning hub and lessons')
      .addTag('community', 'Community features')
      .addTag('analytics', 'Analytics and insights')
      .addTag('teams', 'Team management')
      .addTag('integrations', 'External integrations')
      .build();
    
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const port = configService.get('PORT', 3001);
  await app.listen(port);
  
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`API documentation available at: http://localhost:${port}/api/docs`);
}

bootstrap().catch((error) => {
  console.error('Error starting application:', error);
  process.exit(1);
});