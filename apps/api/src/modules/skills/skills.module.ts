import { Module } from '@nestjs/common';
import { SkillsService } from './skills.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}