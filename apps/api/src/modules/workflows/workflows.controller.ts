import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkflowExecutorService } from './workflow-executor.service';
import { 
  CreateWorkflowDto, 
  UpdateWorkflowDto, 
  ExecuteWorkflowDto 
} from './dto/workflows.dto';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private workflowService: WorkflowExecutorService) {}

  @Get()
  async getWorkflows(
    @Request() req: any,
    @Query('includePublic') includePublic?: string
  ) {
    return this.workflowService.getWorkflows(
      req.user.id,
      includePublic === 'true'
    );
  }

  @Get(':id')
  async getWorkflow(@Param('id') id: string, @Request() req: any) {
    return this.workflowService.getWorkflowById(id, req.user.id);
  }

  @Post()
  async createWorkflow(
    @Body() createWorkflowDto: CreateWorkflowDto,
    @Request() req: any
  ) {
    return this.workflowService.createWorkflow(req.user.id, createWorkflowDto);
  }

  @Put(':id')
  async updateWorkflow(
    @Param('id') id: string,
    @Body() updateWorkflowDto: UpdateWorkflowDto,
    @Request() req: any
  ) {
    return this.workflowService.updateWorkflow(id, req.user.id, updateWorkflowDto);
  }

  @Delete(':id')
  async deleteWorkflow(@Param('id') id: string, @Request() req: any) {
    return this.workflowService.deleteWorkflow(id, req.user.id);
  }

  @Post(':id/execute')
  async executeWorkflow(
    @Param('id') id: string,
    @Body() executeDto: ExecuteWorkflowDto,
    @Request() req: any
  ) {
    return this.workflowService.executeWorkflow(
      id,
      executeDto.inputs,
      req.user.id
    );
  }

  @Get(':id/executions')
  async getExecutionHistory(
    @Param('id') id: string,
    @Request() req: any
  ) {
    return this.workflowService.getExecutionHistory(id, req.user.id);
  }
}