export interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
  roles: string[];
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfile {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
  joinedAt: Date;
  stats: {
    promptsCreated: number;
    templatesCreated: number;
    challengesCompleted: number;
    points: number;
    rank: number;
  };
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  notifications: {
    email: boolean;
    push: boolean;
    inApp: boolean;
  };
  privacy: {
    profileVisible: boolean;
    activityVisible: boolean;
  };
}

export interface UserWithFullProfile extends User {
  profile: UserProfile;
  preferences: UserPreferences;
  stats: UserStatistics;
  recentActivity: UserActivity[];
}

export interface UserPublicProfile {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
  reputation: number;
  joinedAt: Date;
  publicStats: {
    promptsCreated: number;
    templatesCreated: number;
    challengesCompleted: number;
    points: number;
  };
}

export interface UserActivitySummary {
  userId: string;
  period: { start: Date; end: Date };
  promptsCreated: number;
  templatesUsed: number;
  challengesAttempted: number;
  skillsImproved: number;
  communityPosts: number;
  totalTimeSpent: number;
}

export interface UserStatistics {
  promptsCreated: number;
  templatesCreated: number;
  challengesCompleted: number;
  skillsAcquired: number;
  points: number;
  rank: number;
  streakDays: number;
  totalTimeSpent: number;
}

export interface UserSearchResult {
  users: UserPublicProfile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

export interface UserActivity {
  id: string;
  userId: string;
  type: 'prompt_created' | 'template_used' | 'challenge_completed' | 'skill_acquired';
  entityId: string;
  entityType: string;
  metadata: Record<string, any>;
  createdAt: Date;
}