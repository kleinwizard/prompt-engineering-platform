import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [],
  exports: [],
})
export class TeamsModule {}