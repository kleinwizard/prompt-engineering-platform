import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}