import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Configuration
import { configuration } from './config/configuration';
import { validationSchema } from './config/validation';

// Database
import { PrismaModule } from './database/prisma.module';

// Core modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PromptsModule } from './modules/prompts/prompts.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { SkillsModule } from './modules/skills/skills.module';
import { LearningModule } from './modules/learning/learning.module';
import { CommunityModule } from './modules/community/community.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TeamsModule } from './modules/teams/teams.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchModule } from './modules/search/search.module';
import { StorageModule } from './modules/storage/storage.module';

// New Phase 1-3 modules
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { CertificationModule } from './modules/certification/certification.module';
import { PromptBuilderModule } from './modules/prompt-builder/prompt-builder.module';
import { DNAAnalysisModule } from './modules/dna-analysis/dna-analysis.module';
import { GitModule } from './modules/version-control/git.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { SecurityModule } from './modules/security/security.module';
import { CustomModelsModule } from './modules/custom-models/custom-models.module';

// Health check
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          name: 'short',
          ttl: 1000,
          limit: configService.get('THROTTLE_SHORT_LIMIT', 10),
        },
        {
          name: 'medium',
          ttl: 10000,
          limit: configService.get('THROTTLE_MEDIUM_LIMIT', 50),
        },
        {
          name: 'long',
          ttl: 60000,
          limit: configService.get('THROTTLE_LONG_LIMIT', 100),
        },
      ],
      inject: [ConfigService],
    }),

    // Background jobs (conditional based on Redis availability)
    ...(process.env.REDIS_HOST ? [BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
        },
      }),
      inject: [ConfigService],
    })] : []),

    // Event system
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),

    // Database
    PrismaModule,

    // Core modules
    AuthModule,
    UsersModule,
    PromptsModule,
    TemplatesModule,
    ChallengesModule,
    GamificationModule,
    SkillsModule,
    LearningModule,
    CommunityModule,
    AnalyticsModule,
    TeamsModule,
    IntegrationsModule,
    NotificationsModule,
    SearchModule,
    StorageModule,

    // New Phase 1-3 modules
    WorkflowsModule,
    CertificationModule,
    PromptBuilderModule,
    DNAAnalysisModule,
    GitModule,
    MarketplaceModule,
    SecurityModule,
    CustomModelsModule,

    // Health check
    HealthModule,
  ],
})
export class AppModule {}