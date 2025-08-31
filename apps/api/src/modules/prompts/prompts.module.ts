import { Module } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}