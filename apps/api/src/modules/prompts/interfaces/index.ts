export interface Prompt {
  id: string;
  title: string;
  content: string;
  description?: string;
  tags: string[];
  category: string;
  isPublic: boolean;
  authorId: string;
  version: number;
  likes: number;
  uses: number;
  rating: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  content: string;
  changeNotes?: string;
  createdAt: Date;
}

export interface PromptExecution {
  id: string;
  promptId: string;
  userId: string;
  variables: Record<string, any>;
  result: string;
  model: string;
  tokens: number;
  cost: number;
  duration: number;
  createdAt: Date;
}

export interface PromptWithMetadata extends Prompt {
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  forkCount: number;
  executionCount: number;
  averageRating: number;
  isOwner: boolean;
  isFavorited: boolean;
}

export interface PromptImprovementResult {
  originalPrompt: string;
  improvedPrompt: string;
  improvements: Array<{
    type: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
  }>;
  metrics: {
    clarityScore: number;
    specificityScore: number;
    completenessScore: number;
  };
}

export interface PromptAnalytics {
  promptId: string;
  totalExecutions: number;
  successRate: number;
  averageResponseTime: number;
  topModels: Array<{ model: string; count: number }>;
  usageByDay: Array<{ date: string; count: number }>;
  userFeedback: {
    averageRating: number;
    totalRatings: number;
    sentimentScore: number;
  };
}

export interface PromptRecommendation {
  promptId: string;
  title: string;
  category: string;
  reason: string;
  relevanceScore: number;
  estimatedUsage: number;
}

export interface ImprovementMetrics {
  clarityScore: number;
  specificityScore: number;
  completenessScore: number;
  structureScore: number;
  contextScore: number;
  overallScore: number;
  improvements: Array<{
    type: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    before: string;
    after: string;
  }>;
}

export interface ImprovementResult {
  improvedPrompt: string;
  metrics: ImprovementMetrics;
  suggestions: string[];
  reasoning: string;
  confidence: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
  responseTime: number;
  cost: number;
  metadata?: Record<string, any>;
}