import { Module } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}