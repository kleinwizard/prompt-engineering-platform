export interface CreatePromptDto {
  title: string;
  content: string;
  description?: string;
  tags?: string[];
  category: string;
  isPublic?: boolean;
  originalPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface UpdatePromptDto {
  title?: string;
  content?: string;
  description?: string;
  tags?: string[];
  category?: string;
  isPublic?: boolean;
}

export interface PromptExecutionDto {
  variables?: Record<string, any>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PromptVersionDto {
  content: string;
  changeNotes?: string;
}

export interface ImprovePromptDto {
  promptId: string;
  enhancementLevel?: 'low' | 'med' | 'high' | 'pro';
  focusAreas?: string[];
  targetModel?: string;
  additionalContext?: string;
  improvementGoals?: string[];
}

export interface ExecutePromptDto {
  promptId: string;
  variables?: Record<string, any>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ForkPromptDto {
  promptId: string;
  title?: string;
  description?: string;
}

export interface PromptSearchDto {
  query?: string;
  category?: string;
  tags?: string[];
  author?: string;
  difficulty?: string;
  sortBy?: 'relevance' | 'date' | 'popularity' | 'rating';
  page?: number;
  limit?: number;
}

export interface VersionPromptDto {
  content: string;
  changeNotes?: string;
  majorChange?: boolean;
}