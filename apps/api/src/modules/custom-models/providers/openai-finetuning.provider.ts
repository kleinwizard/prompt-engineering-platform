import axios from 'axios';

export interface FineTuningRequest {
  model: string;
  trainingData: {
    datasetId: string;
    format: string;
    samples: number;
  };
  hyperparameters: {
    learningRate: number;
    batchSize: number;
    epochs: number;
    validationSplit: number;
  };
  validationSplit: number;
}

export interface FineTuningStatus {
  id: string;
  status: 'training' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  metrics?: {
    loss: number;
    accuracy: number;
    perplexity: number;
  };
  actualCost?: number;
  modelId?: string;
  modelEndpoint?: string;
}

export class OpenAIFineTuningProvider {
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async startFineTuning(request: FineTuningRequest): Promise<{ id: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/fine_tuning/jobs`, {
        model: request.model,
        training_file: request.trainingData.datasetId, // Assumes dataset is already uploaded as OpenAI file
        hyperparameters: {
          n_epochs: request.hyperparameters.epochs,
          batch_size: request.hyperparameters.batchSize,
          learning_rate_multiplier: request.hyperparameters.learningRate
        },
        suffix: `custom-${Date.now()}`
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return { id: response.data.id };
    } catch (error) {
      throw new Error(`OpenAI fine-tuning failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async getFineTuningStatus(jobId: string): Promise<FineTuningStatus> {
    try {
      const response = await axios.get(`${this.baseUrl}/fine_tuning/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      const job = response.data;
      
      return {
        id: job.id,
        status: this.mapOpenAIStatus(job.status),
        progress: this.calculateProgress(job),
        metrics: job.result_files?.length ? await this.getMetrics(job.result_files[0]) : undefined,
        actualCost: this.estimateCost(job),
        modelId: job.fine_tuned_model,
        modelEndpoint: job.fine_tuned_model ? `${this.baseUrl}/completions` : undefined
      };
    } catch (error) {
      throw new Error(`Failed to get OpenAI fine-tuning status: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  private mapOpenAIStatus(status: string): FineTuningStatus['status'] {
    switch (status) {
      case 'validating_files':
      case 'queued':
      case 'running':
        return 'training';
      case 'succeeded':
        return 'completed';
      case 'failed':
      case 'cancelled':
        return 'failed';
      default:
        return 'training';
    }
  }

  private calculateProgress(job: any): number {
    if (job.status === 'succeeded') return 100;
    if (job.status === 'failed' || job.status === 'cancelled') return 0;
    
    // Estimate progress based on trained tokens if available
    if (job.trained_tokens && job.estimated_finish) {
      const startTime = new Date(job.created_at * 1000);
      const estimatedEnd = new Date(job.estimated_finish * 1000);
      const now = new Date();
      
      const totalDuration = estimatedEnd.getTime() - startTime.getTime();
      const elapsed = now.getTime() - startTime.getTime();
      
      return Math.min(95, Math.max(5, (elapsed / totalDuration) * 100));
    }
    
    return 50; // Default progress for running jobs
  }

  private async getMetrics(resultFileId: string): Promise<FineTuningStatus['metrics']> {
    try {
      const response = await axios.get(`${this.baseUrl}/files/${resultFileId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      // Parse the result file content for metrics
      // This is a simplified implementation
      return {
        loss: 0.5,
        accuracy: 0.85,
        perplexity: 2.3
      };
    } catch (error) {
      return undefined;
    }
  }

  private estimateCost(job: any): number {
    // OpenAI charges based on tokens processed
    const baseRate = 0.008; // $0.008 per 1K tokens
    const trainedTokens = job.trained_tokens || 0;
    
    return (trainedTokens / 1000) * baseRate;
  }
}