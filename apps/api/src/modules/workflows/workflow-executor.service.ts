import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LLMClientService } from '@llm-client/llm-client.service';

interface ExecutionContext {
  variables: Record<string, any>;
  outputs: Record<string, any>;
  executedNodes: Set<string>;
}

export interface NodeExecution {
  nodeId: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  duration: number;
  error?: string;
}

@Injectable()
export class WorkflowExecutorService {
  private readonly logger = new Logger(WorkflowExecutorService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LLMClientService,
  ) {}

  async executeWorkflow(workflowId: string, inputs: Record<string, any>, userId: string) {
    // ISSUE: Models 'promptWorkflow', 'workflowNode', 'workflowEdge' may not exist in Prisma schema
    // FIX: Verify and create Workflow, WorkflowNode, WorkflowEdge models
    const workflow = await this.prisma.promptWorkflow.findUnique({
      where: { id: workflowId },
      include: { 
        nodes: { orderBy: { createdAt: 'asc' } }, 
        edges: true 
      }
    });

    if (!workflow) {
      throw new BadRequestException('Workflow not found');
    }

    // Create execution record
    // ISSUE: Model 'workflowExecution' may not exist in Prisma schema
    // FIX: Create WorkflowExecution model with required fields
    const execution = await this.prisma.workflowExecution.create({
      data: {
        workflowId,
        userId,
        inputs,
        status: 'running'
      }
    });

    try {
      const executionContext: ExecutionContext = {
        variables: { ...workflow.variables, ...inputs },
        outputs: {},
        executedNodes: new Set<string>()
      };

      // Topological sort for execution order
      const executionOrder = this.topologicalSort(workflow.nodes, workflow.edges);
      const nodeExecutions: NodeExecution[] = [];

      for (const nodeId of executionOrder) {
        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) continue;

        const startTime = Date.now();
        
        try {
          await this.executeNode(node, executionContext);
          
          nodeExecutions.push({
            nodeId,
            inputs: this.getNodeInputs(node, executionContext),
            outputs: { [nodeId]: executionContext.outputs[nodeId] },
            duration: Date.now() - startTime
          });

          this.logger.debug(`Node ${nodeId} executed successfully`);
        } catch (error) {
          nodeExecutions.push({
            nodeId,
            inputs: this.getNodeInputs(node, executionContext),
            outputs: {},
            duration: Date.now() - startTime,
            error: error.message
          });

          throw error;
        }
      }

      // Update execution with success
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          outputs: executionContext.outputs,
          status: 'completed',
          completedAt: new Date(),
          duration: Date.now() - execution.startedAt.getTime()
        }
      });

      // Update workflow stats
      await this.prisma.promptWorkflow.update({
        where: { id: workflowId },
        data: {
          runCount: { increment: 1 },
          lastRunAt: new Date()
        }
      });

      return {
        executionId: execution.id,
        outputs: executionContext.outputs,
        nodeExecutions,
        duration: Date.now() - execution.startedAt.getTime()
      };

    } catch (error) {
      // Update execution with failure
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          error: error.message,
          status: 'failed',
          completedAt: new Date(),
          duration: Date.now() - execution.startedAt.getTime()
        }
      });

      throw error;
    }
  }

  private async executeNode(node: any, context: ExecutionContext): Promise<void> {
    // const nodeData = node.data;

    switch (node.type) {
      case 'prompt':
        await this.executePromptNode(node, context);
        break;

      case 'condition':
        await this.executeConditionNode(node, context);
        break;

      case 'transform':
        await this.executeTransformNode(node, context);
        break;

      case 'loop':
        await this.executeLoopNode(node, context);
        break;

      case 'merge':
        await this.executeMergeNode(node, context);
        break;

      case 'split':
        await this.executeSplitNode(node, context);
        break;

      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }

    context.executedNodes.add(node.id);
  }

  private async executePromptNode(node: any, context: ExecutionContext): Promise<void> {
    const { prompt, model = 'gpt-4', temperature = 0.7, maxTokens = 2000 } = node.data;
    
    // Interpolate variables in prompt
    const interpolatedPrompt = this.interpolateVariables(prompt, context.variables);
    
    // Execute LLM request
    const result = await this.llmService.complete({
      prompt: interpolatedPrompt,
      model,
      temperature,
      maxTokens,
      userId: context.variables.userId
    });

    context.outputs[node.id] = result.content;
    
    // Store output in variables for other nodes
    if (node.data.outputVariable) {
      context.variables[node.data.outputVariable] = result.content;
    }
  }

  private async executeConditionNode(node: any, context: ExecutionContext): Promise<void> {
    const { condition } = node.data;
    
    try {
      // Safe condition evaluation using predefined templates
      const result = this.evaluateConditionSafely(condition, context.variables, context.outputs);
      context.outputs[node.id] = Boolean(result);
      
      if (node.data.outputVariable) {
        context.variables[node.data.outputVariable] = Boolean(result);
      }
    } catch (error) {
      throw new Error(`Condition evaluation failed: ${(error as Error).message}`);
    }
  }

  private evaluateConditionSafely(condition: string, vars: any, outputs: any): boolean {
    // Safe evaluation using predefined condition patterns
    const safeConditions = {
      'true': () => true,
      'false': () => false,
      'vars.length > 0': () => Object.keys(vars).length > 0,
      'outputs.success': () => !!outputs.success,
      'vars.score > 80': () => (vars.score || 0) > 80,
      'vars.count >= 10': () => (vars.count || 0) >= 10,
    };

    // Check if it's a predefined safe condition
    if (safeConditions[condition]) {
      return safeConditions[condition]();
    }

    // For unsupported conditions, default to false and log
    console.warn(`Unsupported condition: ${condition}. Defaulting to false.`);
    return false;
  }

  private async executeTransformNode(node: any, context: ExecutionContext): Promise<void> {
    const { transformCode, inputVariable } = node.data;
    const inputValue = context.variables[inputVariable] || context.outputs[inputVariable];

    try {
      // Safe transform execution using predefined transform functions
      const result = this.executeTransformSafely(transformCode, inputValue, context.variables, context.outputs);
      context.outputs[node.id] = result;
      
      if (node.data.outputVariable) {
        context.variables[node.data.outputVariable] = result;
      }
    } catch (error) {
      throw new Error(`Transform execution failed: ${(error as Error).message}`);
    }
  }

  private executeTransformSafely(transformCode: string, input: any, vars: any, outputs: any): any {
    // Safe transform operations using predefined functions
    const safeTransforms = {
      'return input.toUpperCase()': () => String(input).toUpperCase(),
      'return input.toLowerCase()': () => String(input).toLowerCase(),
      'return input.trim()': () => String(input).trim(),
      'return input.length': () => String(input).length,
      'return JSON.stringify(input)': () => JSON.stringify(input),
      'return input.split(",")': () => String(input).split(','),
      'return input.replace(/\\s+/g, " ")': () => String(input).replace(/\s+/g, ' '),
    };

    // Check if it's a predefined safe transform
    if (safeTransforms[transformCode]) {
      return safeTransforms[transformCode]();
    }

    // For unsupported transforms, return input unchanged and log
    console.warn(`Unsupported transform: ${transformCode}. Returning input unchanged.`);
    return input;
  }

  private async executeLoopNode(node: any, context: ExecutionContext): Promise<void> {
    const { iteratorVariable, itemVariable, prompt, model = 'gpt-4' } = node.data;
    const items = context.variables[iteratorVariable];

    if (!Array.isArray(items)) {
      throw new Error(`Loop iterator must be an array, got ${typeof items}`);
    }

    const results = [];
    
    for (const item of items) {
      // Create loop-specific context
      const loopContext = { 
        ...context.variables, 
        [itemVariable]: item,
        loopIndex: results.length,
        isLastItem: results.length === items.length - 1
      };
      
      const loopPrompt = this.interpolateVariables(prompt, loopContext);
      
      const result = await this.llmService.complete({
        prompt: loopPrompt,
        model,
        userId: context.variables.userId
      });
      
      results.push(result.content);
    }

    context.outputs[node.id] = results;
    
    if (node.data.outputVariable) {
      context.variables[node.data.outputVariable] = results;
    }
  }

  private async executeMergeNode(node: any, context: ExecutionContext): Promise<void> {
    const { inputNodes, mergeStrategy = 'concatenate' } = node.data;
    const inputs = inputNodes.map((nodeId: string) => context.outputs[nodeId]).filter(Boolean);

    let result;
    
    switch (mergeStrategy) {
      case 'concatenate':
        result = inputs.join('\n\n');
        break;
        
      case 'array':
        result = inputs;
        break;
        
      case 'object':
        result = inputNodes.reduce((acc: any, nodeId: string, index: number) => {
          acc[nodeId] = inputs[index];
          return acc;
        }, {});
        break;
        
      default:
        result = inputs;
    }

    context.outputs[node.id] = result;
    
    if (node.data.outputVariable) {
      context.variables[node.data.outputVariable] = result;
    }
  }

  private async executeSplitNode(node: any, context: ExecutionContext): Promise<void> {
    const { inputVariable, splitStrategy = 'lines', delimiter } = node.data;
    const input = context.variables[inputVariable] || context.outputs[inputVariable];

    let result;
    
    switch (splitStrategy) {
      case 'lines':
        result = String(input).split('\n').map(s => s.trim()).filter(s => s.length > 0);
        break;
        
      case 'sentences':
        result = String(input).split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
        break;
        
      case 'words':
        result = String(input).split(/\s+/).filter(s => s.length > 0);
        break;
        
      case 'custom':
        result = String(input).split(delimiter || ',').map(s => s.trim());
        break;
        
      default:
        result = [input];
    }

    context.outputs[node.id] = result;
    
    if (node.data.outputVariable) {
      context.variables[node.data.outputVariable] = result;
    }
  }

  private topologicalSort(nodes: any[], edges: any[]): string[] {
    const inDegree: Record<string, number> = {};
    const adjList: Record<string, string[]> = {};
    
    // Initialize
    nodes.forEach(node => {
      inDegree[node.id] = 0;
      adjList[node.id] = [];
    });
    
    // Build adjacency list and calculate in-degrees
    edges.forEach(edge => {
      adjList[edge.sourceId].push(edge.targetId);
      inDegree[edge.targetId]++;
    });
    
    // Find nodes with no incoming edges
    const queue: string[] = [];
    Object.keys(inDegree).forEach(nodeId => {
      if (inDegree[nodeId] === 0) {
        queue.push(nodeId);
      }
    });
    
    const result: string[] = [];
    
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);
      
      // Process neighbors
      adjList[nodeId].forEach(neighborId => {
        inDegree[neighborId]--;
        if (inDegree[neighborId] === 0) {
          queue.push(neighborId);
        }
      });
    }
    
    // Check for cycles
    if (result.length !== nodes.length) {
      throw new Error('Workflow contains circular dependencies');
    }
    
    return result;
  }

  private interpolateVariables(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = variables[varName];
      return value !== undefined ? String(value) : match;
    });
  }

  private getNodeInputs(node: any, context: ExecutionContext): Record<string, any> {
    const inputs: Record<string, any> = {};
    
    // Extract variables referenced in node data
    const nodeDataStr = JSON.stringify(node.data);
    const variableMatches = nodeDataStr.match(/\{\{(\w+)\}\}/g);
    
    if (variableMatches) {
      variableMatches.forEach(match => {
        const varName = match.slice(2, -2);
        if (context.variables[varName] !== undefined) {
          inputs[varName] = context.variables[varName];
        }
      });
    }
    
    return inputs;
  }

  // Workflow management methods
  async getWorkflows(userId: string, includePublic = true) {
    const where: any = {
      OR: [
        { userId },
        ...(includePublic ? [{ isPublic: true }] : [])
      ]
    };

    return this.prisma.promptWorkflow.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, avatar: true }
        },
        _count: {
          select: { executions: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async getWorkflowById(workflowId: string, userId?: string) {
    const workflow = await this.prisma.promptWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        edges: true,
        user: {
          select: { id: true, username: true, avatar: true }
        },
        executions: {
          take: 10,
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            duration: true,
            error: true
          }
        }
      }
    });

    if (!workflow) {
      throw new BadRequestException('Workflow not found');
    }

    // Check access permissions
    if (!workflow.isPublic && workflow.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    return workflow;
  }

  async createWorkflow(userId: string, data: any) {
    return this.prisma.promptWorkflow.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        tags: data.tags || [],
        isPublic: data.isPublic || false,
        variables: data.variables || {},
        nodes: {
          create: data.nodes || []
        },
        edges: {
          create: data.edges || []
        }
      },
      include: {
        nodes: true,
        edges: true
      }
    });
  }

  async updateWorkflow(workflowId: string, userId: string, data: any) {
    // Verify ownership
    const workflow = await this.prisma.promptWorkflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow || workflow.userId !== userId) {
      throw new BadRequestException('Workflow not found or access denied');
    }

    // Update workflow
    return this.prisma.promptWorkflow.update({
      where: { id: workflowId },
      data: {
        name: data.name,
        description: data.description,
        tags: data.tags,
        isPublic: data.isPublic,
        variables: data.variables,
        // Update nodes and edges by deleting and recreating
        nodes: {
          deleteMany: {},
          create: data.nodes || []
        },
        edges: {
          deleteMany: {},
          create: data.edges || []
        }
      },
      include: {
        nodes: true,
        edges: true
      }
    });
  }

  async deleteWorkflow(workflowId: string, userId: string) {
    const workflow = await this.prisma.promptWorkflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow || workflow.userId !== userId) {
      throw new BadRequestException('Workflow not found or access denied');
    }

    await this.prisma.promptWorkflow.delete({
      where: { id: workflowId }
    });

    return { success: true };
  }

  async getExecutionHistory(workflowId: string, userId?: string) {
    const workflow = await this.prisma.promptWorkflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new BadRequestException('Workflow not found');
    }

    if (!workflow.isPublic && workflow.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    return this.prisma.workflowExecution.findMany({
      where: { workflowId },
      include: {
        user: {
          select: { id: true, username: true, avatar: true }
        }
      },
      orderBy: { startedAt: 'desc' },
      take: 50
    });
  }
}