import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { LLMRequest, LLMResponse, LLMConfig } from './types';

@Injectable()
export class LLMClientService {
  private readonly logger = new Logger(LLMClientService.name);
  private providers: Map<string, any> = new Map();

  constructor(private configService: ConfigService) {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Initialize OpenAI provider if API key is available
    const openaiApiKey = this.configService.get('llm.openai.apiKey');
    if (openaiApiKey) {
      const openaiConfig: LLMConfig = {
        provider: 'openai',
        apiKey: openaiApiKey,
        organization: this.configService.get('llm.openai.organization'),
        timeout: 60000,
        retryAttempts: 3,
        retryDelay: 1000,
      };
      this.providers.set('openai', new OpenAIProvider(openaiConfig));
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const provider = this.getProvider(request.model);
    if (!provider) {
      throw new Error(`Provider not found for model: ${request.model}`);
    }

    try {
      return await provider.complete(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`LLM completion failed: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  async stream(request: LLMRequest) {
    const provider = this.getProvider(request.model);
    if (!provider) {
      throw new Error(`Provider not found for model: ${request.model}`);
    }

    return provider.stream(request);
  }

  async getAvailableModels() {
    const allModels = [];
    for (const provider of this.providers.values()) {
      const models = await provider.getAvailableModels();
      allModels.push(...models);
    }
    return allModels;
  }

  async estimateCost(request: LLMRequest): Promise<number> {
    const provider = this.getProvider(request.model);
    if (!provider) {
      return 0;
    }
    return provider.estimateCost(request);
  }

  private getProvider(model: string) {
    // Determine provider based on model name
    if (model.startsWith('gpt-')) {
      return this.providers.get('openai');
    }
    if (model.startsWith('claude-')) {
      return this.providers.get('anthropic');
    }
    if (model.startsWith('gemini-')) {
      return this.providers.get('google');
    }
    
    // Default to OpenAI if available
    return this.providers.get('openai');
  }
}