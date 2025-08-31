export interface Template {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  variables: string[];
  isPublic: boolean;
  authorId: string;
  uses: number;
  rating: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  templateCount: number;
}

export interface TemplateUsage {
  id: string;
  templateId: string;
  userId: string;
  variables: Record<string, any>;
  result: string;
  createdAt: Date;
}

export interface TemplateWithMetadata extends Template {
  author: { id: string; username: string; avatar?: string };
  forkCount: number;
  usageCount: number;
  averageRating: number;
  isOwner: boolean;
  isFavorited: boolean;
  recentUsages: TemplateUsage[];
}

export interface TemplateRecommendation {
  templateId: string;
  name: string;
  category: string;
  reason: string;
  relevanceScore: number;
  estimatedUsage: number;
}

export interface TemplateValidation {
  isValid: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;
  suggestions: string[];
  variableAnalysis: {
    required: string[];
    optional: string[];
    unused: string[];
  };
}