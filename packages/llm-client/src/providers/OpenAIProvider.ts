import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider';
import { LLMRequest, LLMResponse, LLMStreamChunk, ModelInfo, LLMConfig } from '../types';

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  private models: ModelInfo[] = [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      contextLength: 8192,
      inputCostPer1k: 0.03,
      outputCostPer1k: 0.06,
      tier: 'premium',
      capabilities: {
        supportsStreaming: true,
        supportsFunctions: true,
        supportsVision: false,
        maxTokens: 4096,
        languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
      },
    },
    {
      id: 'gpt-4-turbo-preview',
      name: 'GPT-4 Turbo',
      provider: 'openai',
      contextLength: 128000,
      inputCostPer1k: 0.01,
      outputCostPer1k: 0.03,
      tier: 'premium',
      capabilities: {
        supportsStreaming: true,
        supportsFunctions: true,
        supportsVision: true,
        maxTokens: 4096,
        languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
      },
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: 'openai',
      contextLength: 16384,
      inputCostPer1k: 0.001,
      outputCostPer1k: 0.002,
      tier: 'basic',
      capabilities: {
        supportsStreaming: true,
        supportsFunctions: true,
        supportsVision: false,
        maxTokens: 4096,
        languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
      },
    },
  ];

  constructor(config: LLMConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
      timeout: config.timeout || 60000,
    });
  }

  getProviderName(): string {
    return 'openai';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Safety check
    const safetyCheck = await this.checkSafety(request.prompt);
    if (!safetyCheck.passed) {
      throw this.handleError({
        code: 'safety_violation',
        message: 'Prompt violates safety guidelines',
        details: safetyCheck.flags,
      });
    }

    // Rate limiting
    if (request.userId && !(await this.checkRateLimit(request.userId))) {
      throw this.handleError({
        code: 'rate_limit_exceeded',
        message: 'Rate limit exceeded',
      });
    }

    const startTime = Date.now();

    try {
      const response = await this.withRetry(async () => {
        return await this.client.chat.completions.create({
          model: request.model,
          messages: [{ role: 'user', content: request.prompt }],
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          top_p: request.topP,
          frequency_penalty: request.frequencyPenalty,
          presence_penalty: request.presencePenalty,
          stop: request.stop,
          stream: false,
        });
      });

      const latency = Date.now() - startTime;
      const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      return {
        id: response.id,
        model: response.model,
        content: response.choices[0]?.message?.content || '',
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        finishReason: response.choices[0]?.finish_reason as any || 'stop',
        provider: 'openai',
        cost: this.calculateCost(request.model, usage.prompt_tokens, usage.completion_tokens),
        latency,
        metadata: {
          requestId: response.id,
          systemFingerprint: (response as any).system_fingerprint,
        },
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      this.emit('error', { error, request, latency });
      throw this.handleError(error, this.isRetryableError(error));
    }
  }

  async* stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk, void, unknown> {
    // Safety check
    const safetyCheck = await this.checkSafety(request.prompt);
    if (!safetyCheck.passed) {
      throw this.handleError({
        code: 'safety_violation',
        message: 'Prompt violates safety guidelines',
        details: safetyCheck.flags,
      });
    }

    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: [{ role: 'user', content: request.prompt }],
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      frequency_penalty: request.frequencyPenalty,
      presence_penalty: request.presencePenalty,
      stop: request.stop,
      stream: true,
    });

    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        const finished = chunk.choices[0]?.finish_reason !== null;

        if (finished && (chunk as any).usage) {
          totalUsage = (chunk as any).usage;
        }

        yield {
          id: chunk.id,
          delta,
          finished,
          usage: finished ? {
            promptTokens: totalUsage.prompt_tokens,
            completionTokens: totalUsage.completion_tokens,
            totalTokens: totalUsage.total_tokens,
          } : undefined,
        };

        if (finished) {
          break;
        }
      }
    } catch (error: any) {
      this.emit('error', { error, request });
      throw this.handleError(error, this.isRetryableError(error));
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async estimateCost(request: LLMRequest): Promise<number> {
    const model = this.models.find(m => m.id === request.model);
    if (!model) {
      return 0;
    }

    const promptTokens = this.calculateTokens(request.prompt);
    const estimatedCompletionTokens = request.maxTokens || 500;

    return this.calculateCost(request.model, promptTokens, estimatedCompletionTokens);
  }

  private calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      return 0;
    }

    const inputCost = (promptTokens / 1000) * model.inputCostPer1k;
    const outputCost = (completionTokens / 1000) * model.outputCostPer1k;

    return inputCost + outputCost;
  }

  private isRetryableError(error: any): boolean {
    // Retry on rate limits, server errors, and timeouts
    return error?.status >= 500 || 
           error?.status === 429 || 
           error?.code === 'ECONNRESET' ||
           error?.code === 'ETIMEDOUT';
  }
}