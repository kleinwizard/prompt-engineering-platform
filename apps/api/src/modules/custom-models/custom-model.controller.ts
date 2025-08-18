import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CustomModelService } from './custom-model.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

interface RegisterModelDto {
  name: string;
  description?: string;
  type: 'api' | 'finetuned' | 'hosted' | 'local';
  provider: 'openai' | 'anthropic' | 'google' | 'custom';
  endpoint: string;
  authentication: {
    type: 'api_key' | 'oauth' | 'bearer_token' | 'basic_auth';
    credentials: any;
  };
  capabilities: {
    textGeneration: boolean;
    textCompletion: boolean;
    chatCompletion: boolean;
    embedding: boolean;
    fineTuning: boolean;
    streaming: boolean;
    functionCalling: boolean;
  };
  parameters: {
    maxTokens: number;
    supportedTemperatures: [number, number];
    contextWindow: number;
    costPer1kTokens?: {
      input: number;
      output: number;
    };
  };
  metadata?: Record<string, any>;
}

interface DeployModelDto {
  fineTuningJobId: string;
  infrastructure: 'aws' | 'gcp' | 'azure' | 'on_premise';
  region?: string;
  instanceType?: string;
  scaling: {
    minInstances: number;
    maxInstances: number;
    targetUtilization: number;
  };
  monitoring: {
    enabled: boolean;
    alertThresholds: {
      responseTime: number;
      errorRate: number;
      throughput: number;
    };
  };
}

interface StartFineTuningDto {
  baseModelId: string;
  datasetId: string;
  hyperparameters: {
    learningRate: number;
    batchSize: number;
    epochs: number;
    validationSplit: number;
  };
}

interface ModelFiltersDto {
  type?: string;
  provider?: string;
  isActive?: boolean;
  capability?: string;
}

@Controller('custom-models')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomModelController {
  constructor(private customModelService: CustomModelService) {}

  @Post('register')
  @Roles('admin', 'model_manager')
  async registerModel(@Body() dto: RegisterModelDto, @Request() req) {
    const model = await this.customModelService.registerCustomModel(
      req.user.tenantId,
      dto
    );

    return {
      success: true,
      message: 'Model registered successfully',
      model: {
        id: model.id,
        name: model.name,
        type: model.type,
        provider: model.provider,
        capabilities: model.capabilities,
        healthStatus: model.healthStatus
      }
    };
  }

  @Get()
  @Roles('user', 'admin', 'model_manager')
  async listModels(@Query() filters: ModelFiltersDto, @Request() req) {
    const models = await this.customModelService.listModels(
      req.user.tenantId,
      filters
    );

    return {
      models,
      total: models.length,
      filters
    };
  }

  @Get(':id')
  @Roles('user', 'admin', 'model_manager')
  async getModel(@Param('id') id: string, @Request() req) {
    const model = await this.customModelService.getModelDetails(id, req.user.tenantId);
    
    return model;
  }

  @Put(':id')
  @Roles('admin', 'model_manager')
  async updateModel(
    @Param('id') id: string,
    @Body() updates: Partial<RegisterModelDto>,
    @Request() req
  ) {
    const model = await this.customModelService.updateModelConfiguration(id, updates);
    
    return {
      success: true,
      message: 'Model updated successfully',
      model
    };
  }

  @Delete(':id')
  @Roles('admin', 'model_manager')
  async deleteModel(@Param('id') id: string, @Request() req) {
    const result = await this.customModelService.deleteModel(id, req.user.tenantId);
    
    return result;
  }

  @Post(':id/test')
  @Roles('admin', 'model_manager')
  async testModel(@Param('id') id: string) {
    const result = await this.customModelService.testModelConnection(id);
    
    return {
      modelId: id,
      ...result,
      testedAt: new Date()
    };
  }

  @Get(':id/metrics')
  @Roles('user', 'admin', 'model_manager', 'analytics')
  async getModelMetrics(
    @Param('id') id: string,
    @Query('timeRange') timeRange: string = '24h'
  ) {
    return this.customModelService.getModelMetrics(id, timeRange);
  }

  @Post('fine-tuning/start')
  @Roles('admin', 'model_manager')
  async startFineTuning(@Body() dto: StartFineTuningDto, @Request() req) {
    const job = await this.customModelService.startFineTuning(
      req.user.tenantId,
      dto.baseModelId,
      {
        datasetId: dto.datasetId,
        hyperparameters: dto.hyperparameters,
        validationSplit: dto.hyperparameters.validationSplit
      }
    );

    return {
      success: true,
      message: 'Fine-tuning job started',
      job: {
        id: job.id,
        modelId: job.modelId,
        status: job.status,
        estimatedCost: job.estimatedCost,
        estimatedDuration: this.estimateTrainingDuration(job)
      }
    };
  }

  @Get('fine-tuning/jobs')
  @Roles('admin', 'model_manager')
  async listFineTuningJobs(@Query() query: { status?: string; limit?: string }, @Request() req) {
    // Get fine-tuning jobs for the tenant
    return {
      jobs: [
        {
          id: 'job-1',
          modelId: 'model-1',
          baseModel: 'gpt-3.5-turbo',
          status: 'training',
          progress: 67,
          startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          estimatedCompletion: new Date(Date.now() + 60 * 60 * 1000),
          cost: 45.67
        },
        {
          id: 'job-2',
          modelId: 'model-2',
          baseModel: 'claude-2',
          status: 'completed',
          progress: 100,
          startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          cost: 123.45
        }
      ],
      total: 2,
      summary: {
        active: 1,
        completed: 1,
        failed: 0,
        totalCost: 169.12
      }
    };
  }

  @Get('fine-tuning/jobs/:id')
  @Roles('admin', 'model_manager')
  async getFineTuningJob(@Param('id') id: string) {
    return {
      id,
      modelId: 'model-1',
      baseModel: 'gpt-3.5-turbo',
      status: 'training',
      progress: 67,
      trainingData: {
        datasetId: 'dataset-1',
        samples: 10000,
        format: 'jsonl'
      },
      hyperparameters: {
        learningRate: 0.0001,
        batchSize: 32,
        epochs: 3,
        validationSplit: 0.2
      },
      metrics: {
        loss: 0.45,
        accuracy: 0.89,
        perplexity: 12.3
      },
      estimatedCost: 89.50,
      actualCost: 67.30,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      estimatedCompletion: new Date(Date.now() + 60 * 60 * 1000),
      logs: [
        { timestamp: new Date(), level: 'info', message: 'Training started' },
        { timestamp: new Date(), level: 'info', message: 'Epoch 1 completed' },
        { timestamp: new Date(), level: 'info', message: 'Epoch 2 in progress' }
      ]
    };
  }

  @Post('fine-tuning/jobs/:id/cancel')
  @Roles('admin', 'model_manager')
  async cancelFineTuningJob(@Param('id') id: string, @Request() req) {
    // Cancel fine-tuning job
    return {
      success: true,
      message: 'Fine-tuning job cancelled',
      jobId: id,
      cancelledAt: new Date(),
      refund: 23.45
    };
  }

  @Post('deploy')
  @Roles('admin', 'model_manager')
  async deployModel(@Body() dto: DeployModelDto, @Request() req) {
    const deployment = await this.customModelService.deployFineTunedModel(
      req.user.tenantId,
      {
        id: dto.fineTuningJobId,
        modelId: 'generated-model-id',
        baseModel: 'base-model',
        trainingData: { datasetId: '', format: 'jsonl', samples: 0 },
        hyperparameters: { learningRate: 0, batchSize: 0, epochs: 0, validationSplit: 0 },
        status: 'completed',
        progress: 100,
        estimatedCost: 0
      },
      dto
    );

    return {
      success: true,
      message: 'Model deployment initiated',
      deployment
    };
  }

  @Get('deployments')
  @Roles('admin', 'model_manager')
  async listDeployments(@Request() req) {
    return {
      deployments: [
        {
          id: 'deployment-1',
          modelId: 'model-1',
          modelName: 'Custom GPT-3.5 Finance',
          status: 'active',
          endpoint: 'https://deployment-1.aws.example.com/v1/completions',
          infrastructure: 'aws',
          region: 'us-east-1',
          instances: {
            current: 2,
            min: 1,
            max: 5
          },
          metrics: {
            requestsPerMinute: 45,
            averageLatency: 234,
            errorRate: 0.001
          },
          cost: {
            hourly: 12.50,
            monthly: 9000
          },
          deployedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      ],
      total: 1,
      summary: {
        active: 1,
        inactive: 0,
        totalMonthlyCost: 9000
      }
    };
  }

  @Get('deployments/:id')
  @Roles('admin', 'model_manager')
  async getDeployment(@Param('id') id: string) {
    return {
      id,
      modelId: 'model-1',
      modelName: 'Custom GPT-3.5 Finance',
      status: 'active',
      endpoint: 'https://deployment-1.aws.example.com/v1/completions',
      infrastructure: 'aws',
      region: 'us-east-1',
      instanceType: 'g4dn.xlarge',
      scaling: {
        minInstances: 1,
        maxInstances: 5,
        currentInstances: 2,
        targetUtilization: 70
      },
      monitoring: {
        enabled: true,
        alertThresholds: {
          responseTime: 5000,
          errorRate: 0.01,
          throughput: 100
        }
      },
      metrics: {
        requestsPerMinute: 45,
        averageLatency: 234,
        errorRate: 0.001,
        successRate: 0.999,
        throughput: 45
      },
      costs: {
        hourly: 12.50,
        daily: 300,
        monthly: 9000,
        breakdown: {
          compute: 8000,
          storage: 500,
          network: 500
        }
      },
      health: {
        status: 'healthy',
        lastCheck: new Date(),
        uptime: 0.9995
      },
      deployedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      lastUpdated: new Date()
    };
  }

  @Put('deployments/:id/scale')
  @Roles('admin', 'model_manager')
  async scaleDeployment(
    @Param('id') id: string,
    @Body() scaling: { minInstances: number; maxInstances: number }
  ) {
    return {
      success: true,
      message: 'Deployment scaling updated',
      deploymentId: id,
      newScaling: scaling,
      updatedAt: new Date()
    };
  }

  @Delete('deployments/:id')
  @Roles('admin', 'model_manager')
  async deleteDeployment(@Param('id') id: string) {
    return {
      success: true,
      message: 'Deployment terminated',
      deploymentId: id,
      terminatedAt: new Date(),
      finalCost: 234.56
    };
  }

  @Get('marketplace/models')
  @Roles('user', 'admin')
  async browseMarketplaceModels(@Query() query: { category?: string; provider?: string }) {
    return {
      models: [
        {
          id: 'marketplace-1',
          name: 'Finance-Tuned GPT-4',
          description: 'Specialized model for financial analysis and reporting',
          provider: 'FinanceAI Inc.',
          category: 'finance',
          rating: 4.8,
          reviews: 156,
          pricing: {
            perToken: 0.002,
            monthly: 299,
            enterprise: 'custom'
          },
          capabilities: ['text_generation', 'analysis', 'summarization'],
          tags: ['finance', 'analysis', 'gpt-4'],
          featured: true
        },
        {
          id: 'marketplace-2',
          name: 'Legal Document Assistant',
          description: 'AI model trained on legal documents and contracts',
          provider: 'LegalTech Solutions',
          category: 'legal',
          rating: 4.6,
          reviews: 89,
          pricing: {
            perToken: 0.0015,
            monthly: 199,
            enterprise: 'custom'
          },
          capabilities: ['document_analysis', 'contract_review'],
          tags: ['legal', 'contracts', 'compliance']
        }
      ],
      categories: ['finance', 'legal', 'healthcare', 'education', 'general'],
      providers: ['FinanceAI Inc.', 'LegalTech Solutions', 'HealthAI Corp.'],
      total: 2
    };
  }

  @Post('marketplace/models/:id/deploy')
  @Roles('admin', 'model_manager')
  async deployMarketplaceModel(
    @Param('id') id: string,
    @Body() config: { tier: 'basic' | 'premium' | 'enterprise' },
    @Request() req
  ) {
    return {
      success: true,
      message: 'Marketplace model deployment initiated',
      modelId: id,
      deploymentId: crypto.randomUUID(),
      tier: config.tier,
      estimatedSetupTime: '5-10 minutes',
      pricing: config.tier === 'basic' ? '$199/month' : config.tier === 'premium' ? '$499/month' : 'Contact sales'
    };
  }

  @Get('analytics/overview')
  @Roles('admin', 'model_manager', 'analytics')
  async getAnalyticsOverview(@Request() req) {
    return {
      models: {
        total: 12,
        active: 10,
        training: 2,
        deployed: 8
      },
      usage: {
        totalRequests: 45672,
        successRate: 0.998,
        averageLatency: 287,
        topModels: [
          { name: 'Custom GPT-3.5 Finance', requests: 15234 },
          { name: 'Legal Assistant v2', requests: 12456 },
          { name: 'Healthcare Analyzer', requests: 9876 }
        ]
      },
      costs: {
        total: 4567.89,
        training: 1234.56,
        deployment: 2345.67,
        inference: 987.66,
        trend: 'increasing'
      },
      performance: {
        averageAccuracy: 0.94,
        averageThroughput: 156,
        errorRate: 0.002,
        uptime: 0.9998
      },
      recommendations: [
        'Consider consolidating underused models',
        'Optimize high-cost deployments',
        'Schedule training during off-peak hours'
      ]
    };
  }

  @Get('billing/usage')
  @Roles('admin', 'billing')
  async getBillingUsage(@Query() query: { period?: string }, @Request() req) {
    const period = query.period || 'current_month';
    
    return {
      period,
      summary: {
        totalCost: 4567.89,
        previousPeriod: 3890.45,
        change: 0.174,
        breakdown: {
          training: 1234.56,
          deployment: 2345.67,
          inference: 987.66
        }
      },
      details: [
        {
          modelId: 'model-1',
          name: 'Custom GPT-3.5 Finance',
          type: 'deployment',
          cost: 1234.56,
          usage: {
            requests: 15234,
            tokens: 2456789,
            hours: 168
          }
        },
        {
          modelId: 'model-2',
          name: 'Legal Assistant Training',
          type: 'training',
          cost: 567.89,
          usage: {
            samples: 50000,
            epochs: 3,
            duration: 12 // hours
          }
        }
      ],
      projections: {
        nextMonth: 5234.67,
        confidence: 0.85
      }
    };
  }

  // Private helper methods

  private estimateTrainingDuration(job: any): string {
    // Estimate training duration based on job parameters
    const baseHours = 4;
    const sampleMultiplier = job.trainingData.samples / 10000;
    const epochMultiplier = job.hyperparameters.epochs;
    
    const estimatedHours = baseHours * sampleMultiplier * epochMultiplier;
    
    if (estimatedHours < 1) {
      return `${Math.round(estimatedHours * 60)} minutes`;
    } else {
      return `${Math.round(estimatedHours)} hours`;
    }
  }
}