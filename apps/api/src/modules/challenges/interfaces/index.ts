export interface Challenge {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  points: number;
  timeLimit?: number;
  requirements: string[];
  criteria: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChallengeAttempt {
  id: string;
  challengeId: string;
  userId: string;
  solution: string;
  explanation?: string;
  score: number;
  status: 'submitted' | 'graded' | 'passed' | 'failed';
  feedback?: string;
  timeSpent?: number;
  submittedAt: Date;
}

export interface ChallengeLeaderboard {
  userId: string;
  username: string;
  totalScore: number;
  challengesCompleted: number;
  rank: number;
}

export interface ChallengeWithDetails extends Challenge {
  attempts: number;
  successRate: number;
  averageScore: number;
  author: {
    id: string;
    username: string;
  };
}

export interface ChallengeSubmissionResult {
  id: string;
  score: number;
  passed: boolean;
  feedback: string;
  improvements: string[];
  rank?: number;
}

export interface ChallengeStats {
  totalChallenges: number;
  completedChallenges: number;
  averageScore: number;
  rank: number;
  badges: string[];
}

export interface ChallengeScoringResult {
  score: number;
  totalScore: number;
  maxScore: number;
  breakdown: Record<string, number>;
  feedback: string;
  improvements: string[];
}

export interface ChallengeRecommendation {
  challengeId: string;
  title: string;
  difficulty: string;
  reason: string;
  estimatedTime: number;
}