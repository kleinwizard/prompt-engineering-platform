import { Module } from '@nestjs/common';
import { PerformanceMonitorService } from './performance-monitor.service';
import { PerformanceMonitorController } from './performance-monitor.controller';
import { PrismaModule } from '../../database/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [PerformanceMonitorController],
  providers: [PerformanceMonitorService],
  exports: [PerformanceMonitorService]
})
export class AnalyticsModule {}