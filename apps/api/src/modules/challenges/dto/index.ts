export interface CreateChallengeDto {
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  points: number;
  timeLimit?: number;
  requirements: string[];
  criteria: string[];
  type: 'coding' | 'prompt' | 'design' | 'analysis';
  prompt?: string;
  rubric?: Record<string, any>;
  startDate?: Date;
  endDate?: Date;
  badgeId?: string;
}

export interface UpdateChallengeDto {
  title?: string;
  description?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category?: string;
  points?: number;
  timeLimit?: number;
  requirements?: string[];
  criteria?: string[];
  startDate?: Date;
  endDate?: Date;
}

export interface SubmitSolutionDto {
  solution: string;
  explanation?: string;
  timeSpent?: number;
}

export interface JoinChallengeDto {
  challengeId: string;
}

export interface SubmitChallengeDto {
  challengeId: string;
  solution: string;
  explanation?: string;
  timeSpent?: number;
  prompt?: string;
  output?: string;
  model?: string;
  metadata?: Record<string, any>;
  isPublic?: boolean;
}

export interface ChallengeSearchDto {
  query?: string;
  type?: 'coding' | 'prompt' | 'design' | 'analysis';
  status?: 'active' | 'upcoming' | 'completed';
  difficulty?: string;
  category?: string;
  tags?: string[];
  sortBy?: 'relevance' | 'date' | 'popularity' | 'difficulty';
  page?: number;
  limit?: number;
}