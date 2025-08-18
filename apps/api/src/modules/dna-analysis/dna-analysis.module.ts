import { Module } from '@nestjs/common';
import { DNAAnalysisController } from './dna-analysis.controller';
import { DNAAnalysisService } from './dna-analysis.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DNAAnalysisController],
  providers: [DNAAnalysisService],
  exports: [DNAAnalysisService],
})
export class DNAAnalysisModule {}