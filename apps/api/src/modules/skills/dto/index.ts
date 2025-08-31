export interface CreateSkillDto {
  name: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  prerequisites?: string[];
}

export interface UpdateSkillDto {
  name?: string;
  description?: string;
  category?: string;
  level?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  prerequisites?: string[];
}

export interface SkillAssessmentDto {
  skillId: string;
  answers: Record<string, any>;
}

export interface SkillProgressDto {
  skillId: string;
  progress: number;
  completedMilestones: string[];
}

export interface SkillRecommendationDto {
  userId: string;
  skillCategories?: string[];
  difficulty?: string;
  limit?: number;
}

export interface CertifySkillDto {
  skillId: string;
  assessmentResults: Record<string, any>;
}

export interface SkillSearchDto {
  query?: string;
  category?: string;
  level?: string;
  prerequisites?: string[];
  sortBy?: 'relevance' | 'difficulty' | 'popularity';
  page?: number;
  limit?: number;
}