export type PointAction = 
  | 'prompt_created'
  | 'prompt_improved'
  | 'prompt_executed'
  | 'prompt_shared'
  | 'prompt_forked'
  | 'template_created'
  | 'template_used'
  | 'template_rated'
  | 'comment_posted'
  | 'comment_helpful'
  | 'prompt_liked'
  | 'user_followed'
  | 'lesson_completed'
  | 'quiz_passed'
  | 'skill_improved'
  | 'challenge_participated'
  | 'challenge_completed'
  | 'challenge_won'
  | 'first_prompt'
  | 'first_template'
  | 'first_challenge'
  | 'email_verified'
  | 'profile_completed';

export interface PointsAwarded {
  points: number;
  newLevel: LevelUpResult | null;
  newBadges: BadgeAwarded[];
}

export interface LevelUpResult {
  newLevel: number;
  rewards: {
    badges: string[];
    points: number;
  };
}

export interface BadgeAwarded {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  points: number;
  earnedAt: Date;
}

export interface StreakUpdate {
  streak: number;
  longestStreak: number;
  streakBroken: boolean;
  badgesAwarded: string[];
}

export interface UserStats {
  profile: {
    id: string;
    userId: string;
    totalPoints: number;
    weeklyPoints: number;
    monthlyPoints: number;
    level: number;
    experience: number;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: Date;
    promptsCreated: number;
    templatesCreated: number;
    challengesWon: number;
    lessonsCompleted: number;
    globalRank: number | null;
    weeklyRank: number | null;
    monthlyRank: number | null;
    createdAt: Date;
    updatedAt: Date;
  };
  badges: BadgeWithEarnedDate[];
  recentAchievements: Achievement[];
  nextLevel: {
    level: number;
    pointsRequired: number;
    pointsProgress: number;
  };
}

export interface BadgeWithEarnedDate {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  points: number;
  earnedAt: Date;
}

export interface Achievement {
  id: string;
  userId: string;
  type: string;
  category: string;
  title: string;
  description: string | null;
  points: number;
  metadata: any;
  completedAt: Date;
}

export interface LeaderboardEntry {
  userId: string;
  user: {
    id: string;
    username: string;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
  };
  points: number;
  level: number;
  rank: number;
  change?: number; // Position change from previous period
}

export interface CreateAchievementData {
  type: string;
  category: string;
  title: string;
  description?: string;
  points?: number;
  metadata?: any;
}

export interface BadgeRequirement {
  type: 'action_count' | 'point_threshold' | 'streak' | 'challenge' | 'special';
  target: number | string;
  comparison?: 'gte' | 'lte' | 'eq';
  timeframe?: 'daily' | 'weekly' | 'monthly' | 'all_time';
}

export interface BadgeDefinition {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  points: number;
  requirements: BadgeRequirement[];
  isSecret?: boolean;
}