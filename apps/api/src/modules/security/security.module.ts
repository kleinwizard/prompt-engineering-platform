import { Module } from '@nestjs/common';
import { PromptSecurityService } from './prompt-security.service';
import { PromptSecurityController } from './prompt-security.controller';
import { PrismaModule } from '../../database/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [PromptSecurityController],
  providers: [PromptSecurityService],
  exports: [PromptSecurityService]
})
export class SecurityModule {}