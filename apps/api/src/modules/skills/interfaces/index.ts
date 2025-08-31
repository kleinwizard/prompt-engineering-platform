export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  prerequisites: string[];
  learners: number;
  averageRating: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillProgress {
  id: string;
  userId: string;
  skillId: string;
  progress: number;
  score: number;
  completedMilestones: string[];
  startedAt: Date;
  completedAt?: Date;
}

export interface SkillAssessment {
  id: string;
  skillId: string;
  userId: string;
  questions: any[];
  answers: Record<string, any>;
  score: number;
  passed: boolean;
  completedAt: Date;
}

export interface SkillWithProgress extends Skill {
  userProgress?: SkillProgress;
  isUnlocked: boolean;
  nextMilestone?: string;
}

export interface SkillTree {
  skills: SkillWithProgress[];
  connections: Array<{
    from: string;
    to: string;
    type: 'prerequisite' | 'related';
  }>;
}

export interface SkillMilestone {
  id: string;
  skillId: string;
  title: string;
  description: string;
  requirements: string[];
  points: number;
  order: number;
}

export interface SkillRecommendation {
  skillId: string;
  title: string;
  reason: string;
  difficulty: string;
  estimatedTime: number;
  relevanceScore: number;
}

export interface SkillCertification {
  id: string;
  skillId: string;
  userId: string;
  issueDate: Date;
  expiryDate?: Date;
  credentialId: string;
  verificationUrl: string;
}

export interface SkillEvaluation {
  skillId: string;
  userId: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  evaluatedAt: Date;
}

export interface SkillReport {
  userId: string;
  period: { start: Date; end: Date };
  skillsAcquired: string[];
  skillsImproved: Array<{ skillId: string; improvement: number }>;
  totalTimeSpent: number;
  averageScore: number;
  achievements: string[];
}

export interface UserSkillProfile {
  userId: string;
  totalSkills: number;
  completedSkills: number;
  inProgressSkills: number;
  skillsByCategory: Record<string, number>;
  overallLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  strengths: string[];
  recommendations: SkillRecommendation[];
}