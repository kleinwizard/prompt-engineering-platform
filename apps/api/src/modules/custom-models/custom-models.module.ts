import { Module } from '@nestjs/common';
import { CustomModelService } from './custom-model.service';
import { CustomModelController } from './custom-model.controller';
import { PrismaModule } from '../../database/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [CustomModelController],
  providers: [CustomModelService],
  exports: [CustomModelService]
})
export class CustomModelsModule {}