import { Module } from '@nestjs/common';
import { PromptBuilderController } from './prompt-builder.controller';
import { PromptBuilderService } from './prompt-builder.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PromptBuilderController],
  providers: [PromptBuilderService],
  exports: [PromptBuilderService],
})
export class PromptBuilderModule {}