import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { IndustryTemplatesService } from './industry-templates.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TemplatesService, IndustryTemplatesService],
  exports: [TemplatesService, IndustryTemplatesService],
})
export class TemplatesModule {}