import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { BadgeService } from './badge.service';
import { LeaderboardService } from './leaderboard.service';
import { AchievementService } from './achievement.service';
import { PointsProcessor } from './processors/points.processor';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({
      name: 'points',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  providers: [
    GamificationService,
    BadgeService,
    LeaderboardService,
    AchievementService,
    PointsProcessor,
  ],
  controllers: [GamificationController],
  exports: [GamificationService, BadgeService, AchievementService],
})
export class GamificationModule {}