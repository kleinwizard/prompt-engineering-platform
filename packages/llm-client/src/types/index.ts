export interface LLMRequest {
  prompt: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'content_filter' | 'function_call' | 'null';
  metadata?: Record<string, any>;
  provider: LLMProvider;
  cost?: number;
  latency: number;
}

export interface LLMStreamChunk {
  id: string;
  delta: string;
  finished: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'azure' | 'ollama';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProvider;
  contextLength: number;
  inputCostPer1k: number; // USD
  outputCostPer1k: number; // USD
  capabilities: ModelCapabilities;
  tier: 'free' | 'basic' | 'premium' | 'enterprise';
}

export interface ModelCapabilities {
  supportsStreaming: boolean;
  supportsFunctions: boolean;
  supportsVision: boolean;
  maxTokens: number;
  languages: string[];
}

export interface LLMError {
  code: string;
  message: string;
  provider: LLMProvider;
  retryable: boolean;
  details?: any;
}

export interface UsageQuota {
  userId: string;
  provider: LLMProvider;
  tokensUsed: number;
  requestsUsed: number;
  monthlyLimit: number;
  resetDate: Date;
}

export interface SafetyCheck {
  passed: boolean;
  flags: SafetyFlag[];
  confidence: number;
}

export interface SafetyFlag {
  category: 'hate' | 'self-harm' | 'sexual' | 'violence' | 'harassment' | 'illegal';
  severity: 'low' | 'medium' | 'high';
  description: string;
}