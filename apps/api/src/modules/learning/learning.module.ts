import { Module } from '@nestjs/common';
import { LearningService } from './learning.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}