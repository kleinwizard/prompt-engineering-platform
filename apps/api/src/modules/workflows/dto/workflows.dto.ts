import { IsString, IsOptional, IsBoolean, IsArray, IsObject } from 'class-validator';

export class CreateWorkflowDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @IsOptional()
  @IsArray()
  nodes?: WorkflowNodeDto[];

  @IsOptional()
  @IsArray()
  edges?: WorkflowEdgeDto[];
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @IsOptional()
  @IsArray()
  nodes?: WorkflowNodeDto[];

  @IsOptional()
  @IsArray()
  edges?: WorkflowEdgeDto[];
}

export class WorkflowNodeDto {
  @IsString()
  type: string; // prompt, condition, merge, split, loop, transform

  @IsObject()
  position: { x: number; y: number };

  @IsObject()
  data: Record<string, any>;

  @IsOptional()
  @IsArray()
  outputs?: string[];
}

export class WorkflowEdgeDto {
  @IsString()
  sourceId: string;

  @IsString()
  targetId: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class ExecuteWorkflowDto {
  @IsObject()
  inputs: Record<string, any>;
}