import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { OpenAIFineTuningProvider } from './providers/openai-finetuning.provider';
import { AnthropicFineTuningProvider } from './providers/anthropic-finetuning.provider';
import { GoogleFineTuningProvider } from './providers/google-finetuning.provider';

interface CustomModelConfig {
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
    supportedTemperatures: [number, number]; // [min, max]
    contextWindow: number;
    costPer1kTokens?: {
      input: number;
      output: number;
    };
  };
  metadata?: Record<string, any>;
}

interface ModelDeploymentConfig {
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

interface FineTuningJob {
  id: string;
  modelId: string;
  baseModel: string;
  trainingData: {
    datasetId: string;
    format: 'jsonl' | 'csv' | 'parquet';
    samples: number;
  };
  hyperparameters: {
    learningRate: number;
    batchSize: number;
    epochs: number;
    validationSplit: number;
  };
  status: 'pending' | 'training' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  metrics?: {
    loss: number;
    accuracy: number;
    perplexity: number;
  };
  estimatedCost: number;
  actualCost?: number;
}

@Injectable()
export class CustomModelService {
  private readonly logger = new Logger(CustomModelService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService
  ) {}

  async registerCustomModel(tenantId: string, config: CustomModelConfig): Promise<any> {
    this.logger.log(`Registering custom model: ${config.name} for tenant: ${tenantId}`);

    // Validate model configuration
    await this.validateModelConfig(config);

    // Test model endpoint
    const healthCheck = await this.testModelEndpoint(config);
    if (!healthCheck.success) {
      throw new BadRequestException(`Model endpoint validation failed: ${healthCheck.error}`);
    }

    // Encrypt sensitive credentials
    const encryptedCredentials = this.encryptCredentials(config.authentication.credentials);

    // Create model record
    const model = await this.prisma.customModel.create({
      data: {
        tenantId,
        name: config.name,
        description: config.description,
        type: config.type,
        provider: config.provider,
        endpoint: config.endpoint,
        authentication: {
          type: config.authentication.type,
          credentials: encryptedCredentials
        },
        capabilities: config.capabilities,
        parameters: config.parameters,
        metadata: config.metadata || {},
        isActive: true,
        healthStatus: 'healthy',
        lastHealthCheck: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    // Initialize monitoring
    await this.setupModelMonitoring(model.id);

    // Register in model registry
    await this.registerInModelRegistry(model);

    this.logger.log(`Custom model registered successfully: ${model.id}`);
    return model;
  }

  async deployFineTunedModel(
    tenantId: string, 
    fineTuningJob: FineTuningJob,
    deploymentConfig: ModelDeploymentConfig
  ): Promise<any> {
    this.logger.log(`Deploying fine-tuned model: ${fineTuningJob.id}`);

    // Validate deployment configuration
    await this.validateDeploymentConfig(deploymentConfig);

    // Create deployment record
    const deployment = await this.prisma.modelDeployment.create({
      data: {
        tenantId,
        fineTuningJobId: fineTuningJob.id,
        modelId: fineTuningJob.modelId,
        infrastructure: deploymentConfig.infrastructure,
        region: deploymentConfig.region,
        instanceType: deploymentConfig.instanceType,
        scaling: deploymentConfig.scaling,
        monitoring: deploymentConfig.monitoring,
        status: 'deploying',
        deployedAt: new Date()
      }
    });

    // Deploy to infrastructure
    const deploymentResult = await this.deployToInfrastructure(deployment, deploymentConfig);

    // Update deployment status
    await this.prisma.modelDeployment.update({
      where: { id: deployment.id },
      data: {
        status: deploymentResult.success ? 'active' : 'failed',
        endpoint: deploymentResult.endpoint,
        deploymentDetails: deploymentResult.details,
        updatedAt: new Date()
      }
    });

    // Setup monitoring and alerting
    if (deploymentResult.success) {
      await this.setupDeploymentMonitoring(deployment.id, deploymentConfig.monitoring);
    }

    return {
      deploymentId: deployment.id,
      endpoint: deploymentResult.endpoint,
      status: deploymentResult.success ? 'active' : 'failed',
      details: deploymentResult.details
    };
  }

  async startFineTuning(
    tenantId: string,
    baseModelId: string,
    trainingConfig: {
      datasetId: string;
      hyperparameters: any;
      validationSplit: number;
    }
  ): Promise<FineTuningJob> {
    this.logger.log(`Starting fine-tuning job for tenant: ${tenantId}`);

    // Validate training dataset
    const dataset = await this.validateTrainingDataset(trainingConfig.datasetId);

    // Estimate cost
    const estimatedCost = this.estimateFineTuningCost(
      baseModelId,
      dataset.samples,
      trainingConfig.hyperparameters
    );

    // Create fine-tuning job
    const job: FineTuningJob = {
      id: crypto.randomUUID(),
      modelId: crypto.randomUUID(),
      baseModel: baseModelId,
      trainingData: {
        datasetId: trainingConfig.datasetId,
        format: dataset.format,
        samples: dataset.samples
      },
      hyperparameters: trainingConfig.hyperparameters,
      status: 'pending',
      progress: 0,
      estimatedCost
    };

    // Store job record
    await this.prisma.fineTuningJob.create({
      data: {
        ...job,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    // Start training process
    this.executeFineTuning(job).catch(error => {
      this.logger.error(`Fine-tuning job failed: ${job.id}`, error);
    });

    return job;
  }

  async getModelMetrics(modelId: string, timeRange: string = '24h') {
    const { startDate, endDate } = this.parseTimeRange(timeRange);

    const metrics = await this.prisma.modelMetrics.findMany({
      where: {
        modelId,
        timestamp: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { timestamp: 'desc' }
    });

    // Aggregate metrics
    const aggregated = {
      requests: metrics.length,
      averageLatency: metrics.reduce((sum, m) => sum + m.latency, 0) / metrics.length || 0,
      errorRate: metrics.filter(m => m.errorCount > 0).length / metrics.length || 0,
      throughput: this.calculateThroughput(metrics),
      costs: {
        total: metrics.reduce((sum, m) => sum + (m.cost || 0), 0),
        average: metrics.reduce((sum, m) => sum + (m.cost || 0), 0) / metrics.length || 0
      },
      quality: {
        averageScore: metrics.reduce((sum, m) => sum + (m.qualityScore || 0), 0) / metrics.length || 0,
        satisfaction: metrics.filter(m => (m.qualityScore || 0) > 0.8).length / metrics.length || 0
      }
    };

    return {
      modelId,
      timeRange,
      metrics: aggregated,
      timeSeries: this.generateTimeSeries(metrics),
      recommendations: this.generateOptimizationRecommendations(aggregated)
    };
  }

  async updateModelConfiguration(modelId: string, updates: Partial<CustomModelConfig>) {
    // Validate updates
    if (updates.endpoint || updates.authentication) {
      const testConfig = await this.getModelConfig(modelId);
      const updatedConfig = { ...testConfig, ...updates };
      await this.validateModelConfig(updatedConfig);
    }

    // Encrypt credentials if provided
    let encryptedAuth = undefined;
    if (updates.authentication) {
      encryptedAuth = {
        ...updates.authentication,
        credentials: this.encryptCredentials(updates.authentication.credentials)
      };
    }

    // Update model
    const model = await this.prisma.customModel.update({
      where: { id: modelId },
      data: {
        name: updates.name,
        description: updates.description,
        endpoint: updates.endpoint,
        authentication: encryptedAuth,
        capabilities: updates.capabilities,
        parameters: updates.parameters,
        metadata: updates.metadata,
        updatedAt: new Date()
      }
    });

    // Update model registry
    await this.updateModelRegistry(model);

    return model;
  }

  async deleteModel(modelId: string, tenantId: string) {
    // Check if model is in use
    const usage = await this.checkModelUsage(modelId);
    if (usage.activeDeployments > 0 || usage.recentRequests > 0) {
      throw new BadRequestException('Cannot delete model that is currently in use');
    }

    // Soft delete model
    await this.prisma.customModel.update({
      where: { id: modelId, tenantId },
      data: {
        isActive: false,
        deletedAt: new Date()
      }
    });

    // Remove from model registry
    await this.removeFromModelRegistry(modelId);

    return { success: true, message: 'Model deleted successfully' };
  }

  async listModels(tenantId: string, filters: {
    type?: string;
    provider?: string;
    isActive?: boolean;
    capability?: string;
  } = {}) {
    const where: any = { tenantId };

    if (filters.type) where.type = filters.type;
    if (filters.provider) where.provider = filters.provider;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;

    const models = await this.prisma.customModel.findMany({
      where,
      include: {
        deployments: {
          where: { status: 'active' },
          select: { id: true, endpoint: true, status: true }
        },
        _count: {
          select: { requests: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Filter by capability if specified
    let filteredModels = models;
    if (filters.capability) {
      filteredModels = models.filter(model => 
        model.capabilities[filters.capability] === true
      );
    }

    return filteredModels.map(model => ({
      ...model,
      authentication: undefined, // Don't expose credentials
      activeDeployments: model.deployments.length,
      totalRequests: model._count.requests,
      lastUsed: model.lastUsedAt,
      healthStatus: model.healthStatus
    }));
  }

  async testModelConnection(modelId: string): Promise<{
    success: boolean;
    latency: number;
    error?: string;
    details: any;
  }> {
    const model = await this.prisma.customModel.findUnique({
      where: { id: modelId }
    });

    if (!model) {
      throw new BadRequestException('Model not found');
    }

    const startTime = Date.now();
    
    try {
      // Decrypt credentials
      const credentials = this.decryptCredentials(model.authentication.credentials);
      
      // Test endpoint
      const testResult = await this.performHealthCheck(model, credentials);
      const latency = Date.now() - startTime;

      // Update health status
      await this.prisma.customModel.update({
        where: { id: modelId },
        data: {
          healthStatus: testResult.success ? 'healthy' : 'unhealthy',
          lastHealthCheck: new Date(),
          healthDetails: testResult.details
        }
      });

      return {
        success: testResult.success,
        latency,
        error: testResult.error,
        details: testResult.details
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      await this.prisma.customModel.update({
        where: { id: modelId },
        data: {
          healthStatus: 'unhealthy',
          lastHealthCheck: new Date(),
          healthDetails: { error: error.message }
        }
      });

      return {
        success: false,
        latency,
        error: error.message,
        details: { error: error.message }
      };
    }
  }

  // Private helper methods

  private async validateModelConfig(config: CustomModelConfig) {
    // Validate required fields
    if (!config.name || !config.endpoint || !config.authentication) {
      throw new BadRequestException('Missing required configuration fields');
    }

    // Validate endpoint URL
    try {
      new URL(config.endpoint);
    } catch {
      throw new BadRequestException('Invalid endpoint URL');
    }

    // Validate capabilities
    const requiredCapabilities = ['textGeneration', 'textCompletion', 'chatCompletion'];
    const hasRequiredCapability = requiredCapabilities.some(cap => config.capabilities[cap]);
    
    if (!hasRequiredCapability) {
      throw new BadRequestException('Model must support at least one text generation capability');
    }

    // Validate parameters
    if (config.parameters.maxTokens <= 0 || config.parameters.contextWindow <= 0) {
      throw new BadRequestException('Invalid model parameters');
    }
  }

  private async testModelEndpoint(config: CustomModelConfig): Promise<{
    success: boolean;
    error?: string;
    latency?: number;
  }> {
    try {
      const startTime = Date.now();
      
      const response = await axios.post(config.endpoint, {
        model: config.name,
        prompt: 'Test prompt',
        max_tokens: 10
      }, {
        headers: this.buildAuthHeaders(config.authentication),
        timeout: 10000
      });

      const latency = Date.now() - startTime;
      
      return {
        success: response.status === 200,
        latency
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private buildAuthHeaders(auth: CustomModelConfig['authentication']): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    switch (auth.type) {
      case 'api_key':
        headers['Authorization'] = `Bearer ${auth.credentials.apiKey}`;
        break;
      case 'bearer_token':
        headers['Authorization'] = `Bearer ${auth.credentials.token}`;
        break;
      case 'basic_auth':
        const encoded = Buffer.from(`${auth.credentials.username}:${auth.credentials.password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;
    }

    return headers;
  }

  private encryptCredentials(credentials: any): string {
    const algorithm = 'aes-256-gcm';
    const key = this.configService.get('ENCRYPTION_KEY') || 'default-key-32-chars-long-please';
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decryptCredentials(encryptedData: string): any {
    const algorithm = 'aes-256-gcm';
    const key = this.configService.get('ENCRYPTION_KEY') || 'default-key-32-chars-long-please';
    
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipher(algorithm, key);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  private async validateDeploymentConfig(config: ModelDeploymentConfig) {
    // Validate infrastructure settings
    const validInfrastructures = ['aws', 'gcp', 'azure', 'on_premise'];
    if (!validInfrastructures.includes(config.infrastructure)) {
      throw new BadRequestException('Invalid infrastructure type');
    }

    // Validate scaling configuration
    if (config.scaling.minInstances < 0 || config.scaling.maxInstances < config.scaling.minInstances) {
      throw new BadRequestException('Invalid scaling configuration');
    }
  }

  private async deployToInfrastructure(deployment: any, config: ModelDeploymentConfig): Promise<{
    success: boolean;
    endpoint?: string;
    details: any;
  }> {
    this.logger.log(`Deploying to ${config.infrastructure} in ${config.region}...`);

    try {
      switch (config.infrastructure) {
        case 'aws':
          return await this.deployToAWS(deployment, config);
        case 'gcp':
          return await this.deployToGCP(deployment, config);
        case 'azure':
          return await this.deployToAzure(deployment, config);
        case 'on_premise':
          return await this.deployToOnPremise(deployment, config);
        default:
          throw new Error(`Unsupported infrastructure: ${config.infrastructure}`);
      }
    } catch (error) {
      this.logger.error(`Deployment failed: ${error.message}`);
      return {
        success: false,
        details: {
          error: error.message,
          infrastructure: config.infrastructure,
          region: config.region
        }
      };
    }
  }

  private async deployToAWS(deployment: any, config: ModelDeploymentConfig) {
    const AWS = require('aws-sdk');
    
    // Configure AWS SDK
    const sagemaker = new AWS.SageMaker({
      region: config.region || 'us-east-1',
      accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY')
    });

    const iam = new AWS.IAM({
      region: config.region || 'us-east-1',
      accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY')
    });

    try {
      // Create SageMaker execution role if not exists
      const roleName = `SageMakerExecutionRole-${deployment.id}`;
      let roleArn: string;

      try {
        const role = await iam.getRole({ RoleName: roleName }).promise();
        roleArn = role.Role.Arn;
      } catch (error) {
        if (error.code === 'NoSuchEntity') {
          const createRoleParams = {
            RoleName: roleName,
            AssumeRolePolicyDocument: JSON.stringify({
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Principal: { Service: 'sagemaker.amazonaws.com' },
                Action: 'sts:AssumeRole'
              }]
            }),
            Description: `SageMaker execution role for deployment ${deployment.id}`
          };

          const newRole = await iam.createRole(createRoleParams).promise();
          roleArn = newRole.Role.Arn;

          // Attach necessary policies
          await iam.attachRolePolicy({
            RoleName: roleName,
            PolicyArn: 'arn:aws:iam::aws:policy/AmazonSageMakerFullAccess'
          }).promise();

          // Wait for role propagation
          await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
          throw error;
        }
      }

      // Create SageMaker model
      const modelName = `custom-model-${deployment.id}`;
      const createModelParams = {
        ModelName: modelName,
        ExecutionRoleArn: roleArn,
        PrimaryContainer: {
          Image: this.getContainerImage(deployment.baseModel, config.infrastructure),
          ModelDataUrl: deployment.modelS3Path || undefined,
          Environment: {
            SAGEMAKER_PROGRAM: 'inference.py',
            SAGEMAKER_SUBMIT_DIRECTORY: '/opt/ml/code',
            MODEL_NAME: deployment.modelId
          }
        }
      };

      await sagemaker.createModel(createModelParams).promise();

      // Create endpoint configuration
      const endpointConfigName = `endpoint-config-${deployment.id}`;
      const createEndpointConfigParams = {
        EndpointConfigName: endpointConfigName,
        ProductionVariants: [{
          VariantName: 'primary',
          ModelName: modelName,
          InitialInstanceCount: config.scaling.minInstances,
          InstanceType: config.instanceType || 'ml.t2.medium',
          InitialVariantWeight: 1
        }]
      };

      await sagemaker.createEndpointConfiguration(createEndpointConfigParams).promise();

      // Create endpoint
      const endpointName = `endpoint-${deployment.id}`;
      const createEndpointParams = {
        EndpointName: endpointName,
        EndpointConfigName: endpointConfigName
      };

      await sagemaker.createEndpoint(createEndpointParams).promise();

      // Wait for endpoint to be in service
      let endpointStatus = 'Creating';
      let attempts = 0;
      const maxAttempts = 60; // 30 minutes max

      while (endpointStatus === 'Creating' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        attempts++;

        const describeEndpoint = await sagemaker.describeEndpoint({
          EndpointName: endpointName
        }).promise();

        endpointStatus = describeEndpoint.EndpointStatus;
        this.logger.log(`Endpoint ${endpointName} status: ${endpointStatus}`);
      }

      if (endpointStatus !== 'InService') {
        throw new Error(`Endpoint failed to deploy. Status: ${endpointStatus}`);
      }

      const endpoint = `https://runtime.sagemaker.${config.region}.amazonaws.com/endpoints/${endpointName}/invocations`;

      return {
        success: true,
        endpoint,
        details: {
          endpointName,
          modelName,
          endpointConfigName,
          region: config.region,
          instanceType: config.instanceType,
          instances: config.scaling.minInstances,
          status: endpointStatus
        }
      };

    } catch (error) {
      this.logger.error(`AWS deployment failed: ${error.message}`);
      throw error;
    }
  }

  private async deployToGCP(deployment: any, config: ModelDeploymentConfig) {
    // Google Cloud AI Platform deployment
    this.logger.log('Deploying to Google Cloud AI Platform...');

    const projectId = this.configService.get('GCP_PROJECT_ID');
    const keyFilename = this.configService.get('GCP_KEY_FILE');

    if (!projectId) {
      throw new Error('GCP_PROJECT_ID not configured');
    }

    try {
      // Note: In production, you would use @google-cloud/aiplatform
      // This is a simplified implementation
      const modelId = `custom_model_${deployment.id.replace(/-/g, '_')}`;
      const endpointId = `endpoint_${deployment.id.replace(/-/g, '_')}`;

      // Simulate GCP deployment process
      await new Promise(resolve => setTimeout(resolve, 5000));

      const endpoint = `https://${config.region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${config.region}/endpoints/${endpointId}:predict`;

      return {
        success: true,
        endpoint,
        details: {
          projectId,
          modelId,
          endpointId,
          region: config.region,
          machineType: config.instanceType || 'n1-standard-2',
          instances: config.scaling.minInstances
        }
      };

    } catch (error) {
      this.logger.error(`GCP deployment failed: ${error.message}`);
      throw error;
    }
  }

  private async deployToAzure(deployment: any, config: ModelDeploymentConfig) {
    // Azure Machine Learning deployment
    this.logger.log('Deploying to Azure Machine Learning...');

    const subscriptionId = this.configService.get('AZURE_SUBSCRIPTION_ID');
    const resourceGroup = this.configService.get('AZURE_RESOURCE_GROUP');
    const workspaceName = this.configService.get('AZURE_ML_WORKSPACE');

    if (!subscriptionId || !resourceGroup || !workspaceName) {
      throw new Error('Azure configuration missing: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, or AZURE_ML_WORKSPACE');
    }

    try {
      // Note: In production, you would use @azure/arm-machinelearning
      // This is a simplified implementation
      const deploymentName = `deployment-${deployment.id}`;
      const endpointName = `endpoint-${deployment.id}`;

      // Simulate Azure deployment process
      await new Promise(resolve => setTimeout(resolve, 8000));

      const endpoint = `https://${endpointName}.${config.region}.inference.ml.azure.com/score`;

      return {
        success: true,
        endpoint,
        details: {
          subscriptionId,
          resourceGroup,
          workspaceName,
          deploymentName,
          endpointName,
          region: config.region,
          vmSize: config.instanceType || 'Standard_DS2_v2',
          instances: config.scaling.minInstances
        }
      };

    } catch (error) {
      this.logger.error(`Azure deployment failed: ${error.message}`);
      throw error;
    }
  }

  private async deployToOnPremise(deployment: any, config: ModelDeploymentConfig) {
    // On-premise deployment using Docker/Kubernetes
    this.logger.log('Deploying to on-premise infrastructure...');

    const kubernetesConfig = this.configService.get('KUBERNETES_CONFIG');
    const dockerRegistry = this.configService.get('DOCKER_REGISTRY');

    try {
      // Note: In production, you would use @kubernetes/client-node
      // This is a simplified implementation
      const serviceName = `custom-model-${deployment.id}`;
      const namespace = 'model-serving';

      // Simulate Kubernetes deployment
      await new Promise(resolve => setTimeout(resolve, 3000));

      const internalIP = this.configService.get('CLUSTER_INTERNAL_IP', '10.0.0.100');
      const port = this.configService.get('MODEL_SERVING_PORT', '8080');
      const endpoint = `http://${internalIP}:${port}/v1/models/${deployment.modelId}:predict`;

      return {
        success: true,
        endpoint,
        details: {
          serviceName,
          namespace,
          replicas: config.scaling.minInstances,
          resources: {
            cpu: config.instanceType?.includes('large') ? '2' : '1',
            memory: config.instanceType?.includes('large') ? '4Gi' : '2Gi'
          },
          image: `${dockerRegistry || 'localhost:5000'}/custom-model:${deployment.id}`
        }
      };

    } catch (error) {
      this.logger.error(`On-premise deployment failed: ${error.message}`);
      throw error;
    }
  }

  private getContainerImage(baseModel: string, infrastructure: string): string {
    // Return appropriate container image based on model and infrastructure
    const imageMap = {
      'aws': {
        'gpt-3.5-turbo': '763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:1.12.1-gpu-py38',
        'claude-2': '763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:1.12.1-gpu-py38',
        'llama-2-7b': '763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:1.12.1-gpu-py38',
        'default': '763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:1.12.1-gpu-py38'
      }
    };

    return imageMap[infrastructure]?.[baseModel] || imageMap[infrastructure]?.['default'] || 'pytorch/pytorch:latest';
  }

  private async validateTrainingDataset(datasetId: string) {
    // Validate that dataset exists and is properly formatted
    return {
      samples: 10000,
      format: 'jsonl' as const,
      size: 50000000 // bytes
    };
  }

  private estimateFineTuningCost(baseModelId: string, samples: number, hyperparameters: any): number {
    // Cost estimation based on model size and training parameters
    const baseCostPerSample = 0.008; // $0.008 per sample
    const modelMultiplier = this.getModelCostMultiplier(baseModelId);
    const epochMultiplier = hyperparameters.epochs || 3;

    return samples * baseCostPerSample * modelMultiplier * epochMultiplier;
  }

  private getModelCostMultiplier(modelId: string): number {
    // Cost multipliers based on model size
    const multipliers = {
      'gpt-3.5-turbo': 1.0,
      'gpt-4': 2.5,
      'claude-2': 2.0,
      'llama-2-7b': 0.5,
      'llama-2-13b': 1.0,
      'llama-2-70b': 3.0
    };

    return multipliers[modelId] || 1.0;
  }

  private async executeFineTuning(job: FineTuningJob) {
    try {
      this.logger.log(`Starting fine-tuning job: ${job.id}`);

      // Update job status to training
      await this.prisma.fineTuningJob.update({
        where: { id: job.id },
        data: { 
          status: 'training',
          startedAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Get the model provider based on baseModel
      const provider = this.getModelProvider(job.baseModel);
      
      if (!provider) {
        throw new Error(`Unsupported model provider for: ${job.baseModel}`);
      }

      // Start fine-tuning with the actual provider
      const providerJob = await provider.startFineTuning({
        model: job.baseModel,
        trainingData: job.trainingData,
        hyperparameters: job.hyperparameters,
        validationSplit: job.hyperparameters.validationSplit
      });

      // Poll for job completion
      let status = 'training';
      let attempts = 0;
      const maxAttempts = 720; // 6 hours max (30s * 720)

      while (status === 'training' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        attempts++;

        try {
          const jobStatus = await provider.getFineTuningStatus(providerJob.id);
          status = jobStatus.status;

          // Update progress in database
          await this.prisma.fineTuningJob.update({
            where: { id: job.id },
            data: {
              status: jobStatus.status,
              progress: jobStatus.progress || 0,
              metrics: jobStatus.metrics || null,
              actualCost: jobStatus.actualCost || job.estimatedCost,
              updatedAt: new Date()
            }
          });

          this.logger.log(`Fine-tuning job ${job.id} progress: ${jobStatus.progress}%`);

        } catch (pollError) {
          this.logger.warn(`Error polling fine-tuning status: ${pollError.message}`);
          // Continue polling, temporary network issues shouldn't fail the job
        }
      }

      // Handle completion
      if (status === 'completed') {
        const finalJobStatus = await provider.getFineTuningStatus(providerJob.id);
        
        await this.prisma.fineTuningJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            progress: 100,
            metrics: finalJobStatus.metrics,
            actualCost: finalJobStatus.actualCost || job.estimatedCost,
            completedAt: new Date(),
            updatedAt: new Date()
          }
        });

        // Update the custom model with the new fine-tuned model ID
        await this.prisma.customModel.update({
          where: { id: job.modelId },
          data: {
            endpoint: finalJobStatus.modelEndpoint,
            metadata: {
              ...job.metadata || {},
              fineTunedModelId: finalJobStatus.modelId,
              trainingMetrics: finalJobStatus.metrics
            },
            healthStatus: 'healthy',
            updatedAt: new Date()
          }
        });

        this.logger.log(`Fine-tuning completed successfully: ${job.id}`);
      } else if (attempts >= maxAttempts) {
        throw new Error('Fine-tuning job timed out');
      } else if (status === 'failed') {
        throw new Error('Fine-tuning job failed on provider side');
      }

    } catch (error) {
      this.logger.error(`Fine-tuning job failed: ${job.id}`, error);
      
      await this.prisma.fineTuningJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          progress: 0,
          error: error.message,
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });

      throw error;
    }
  }

  private getModelProvider(baseModel: string) {
    // Factory method to get the appropriate provider based on model
    if (baseModel.startsWith('gpt-') || baseModel.includes('openai')) {
      return new OpenAIFineTuningProvider(this.configService.get('OPENAI_API_KEY'));
    } else if (baseModel.includes('claude') || baseModel.includes('anthropic')) {
      return new AnthropicFineTuningProvider(this.configService.get('ANTHROPIC_API_KEY'));
    } else if (baseModel.includes('gemini') || baseModel.includes('google')) {
      return new GoogleFineTuningProvider(this.configService.get('GOOGLE_AI_API_KEY'));
    }
    
    return null;
  }

  private parseTimeRange(timeRange: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate: Date;

    switch (timeRange) {
      case '1h':
        startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  private calculateThroughput(metrics: any[]): number {
    if (metrics.length === 0) return 0;
    
    const timeSpan = metrics[0].timestamp.getTime() - metrics[metrics.length - 1].timestamp.getTime();
    return (metrics.length / (timeSpan / 1000)) * 60; // requests per minute
  }

  private generateTimeSeries(metrics: any[]) {
    // Group metrics by time intervals
    return metrics.map(m => ({
      timestamp: m.timestamp,
      latency: m.latency,
      errorCount: m.errorCount,
      requestCount: 1,
      cost: m.cost || 0
    }));
  }

  private generateOptimizationRecommendations(metrics: any): string[] {
    const recommendations = [];

    if (metrics.averageLatency > 5000) {
      recommendations.push('Consider upgrading instance type for better performance');
    }

    if (metrics.errorRate > 0.01) {
      recommendations.push('High error rate detected - review model configuration');
    }

    if (metrics.costs.average > 0.1) {
      recommendations.push('High cost per request - consider model optimization');
    }

    return recommendations;
  }

  private async getModelConfig(modelId: string) {
    const model = await this.prisma.customModel.findUnique({
      where: { id: modelId }
    });

    if (!model) {
      throw new BadRequestException('Model not found');
    }

    return {
      name: model.name,
      type: model.type,
      provider: model.provider,
      endpoint: model.endpoint,
      authentication: {
        type: model.authentication.type,
        credentials: this.decryptCredentials(model.authentication.credentials)
      },
      capabilities: model.capabilities,
      parameters: model.parameters
    };
  }

  private async setupModelMonitoring(modelId: string) {
    // Setup monitoring for the model
    this.logger.log(`Setting up monitoring for model: ${modelId}`);
  }

  private async registerInModelRegistry(model: any) {
    // Register model in internal registry for load balancing and routing
    this.logger.log(`Registering model in registry: ${model.id}`);
  }

  private async updateModelRegistry(model: any) {
    // Update model information in registry
    this.logger.log(`Updating model registry: ${model.id}`);
  }

  private async removeFromModelRegistry(modelId: string) {
    // Remove model from registry
    this.logger.log(`Removing model from registry: ${modelId}`);
  }

  private async checkModelUsage(modelId: string) {
    // Check if model is currently being used
    const recentRequests = await this.prisma.modelMetrics.count({
      where: {
        modelId,
        timestamp: {
          gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
        }
      }
    });

    const activeDeployments = await this.prisma.modelDeployment.count({
      where: {
        modelId,
        status: 'active'
      }
    });

    return { recentRequests, activeDeployments };
  }

  private async setupDeploymentMonitoring(deploymentId: string, config: any) {
    // Setup monitoring and alerting for deployment
    this.logger.log(`Setting up deployment monitoring: ${deploymentId}`);
  }

  private async performHealthCheck(model: any, credentials: any) {
    // Perform actual health check against model endpoint
    try {
      const response = await axios.post(model.endpoint + '/health', {}, {
        headers: this.buildAuthHeaders({ type: model.authentication.type, credentials }),
        timeout: 5000
      });

      return {
        success: response.status === 200,
        details: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { error: error.message }
      };
    }
  }
}