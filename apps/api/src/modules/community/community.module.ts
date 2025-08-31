import { Module } from '@nestjs/common';
import { CommunityService } from './community.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}