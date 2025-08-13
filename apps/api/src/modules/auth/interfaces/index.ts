export interface JwtPayload {
  sub: string; // user id
  email?: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserWithProfile {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  timezone: string;
  emailVerified: Date | null;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
  profile?: {
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
  } | null;
  preferences?: {
    id: string;
    userId: string;
    theme: string;
    language: string;
    timezone: string;
    emailNotifications: boolean;
    pushNotifications: boolean;
    weeklyDigest: boolean;
    communityUpdates: boolean;
    profileVisibility: string;
    showEmail: boolean;
    showLocation: boolean;
    defaultModel: string;
    aiCoachingEnabled: boolean;
    autoImprovement: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  skills?: {
    id: string;
    userId: string;
    specificity: number;
    constraints: number;
    structure: number;
    roleDefinition: number;
    outputFormat: number;
    verification: number;
    safety: number;
    overallScore: number;
    assessmentCount: number;
    lastAssessment: Date | null;
    skills: any;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

export interface RequestWithUser extends Request {
  user: UserWithProfile;
}