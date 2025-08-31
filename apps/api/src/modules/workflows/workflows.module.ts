import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowExecutorService } from './workflow-executor.service';
import { PrismaModule } from '../../database/prisma.module';
import { LLMClientModule } from '@llm-client/llm-client.module';

@Module({
  imports: [PrismaModule, LLMClientModule],
  controllers: [WorkflowsController],
  providers: [WorkflowExecutorService],
  exports: [WorkflowExecutorService],
})
export class WorkflowsModule {}