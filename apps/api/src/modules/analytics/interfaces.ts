// Analytics interfaces - stub implementations for compilation

export interface RevenueAnalytics {
  totalRevenue: number;
  monthlyRevenue: number;
  averageRevenuePerUser: number;
}

export interface UsageAnalytics {
  totalRequests: number;
  activeUsers: number;
  averageSessionDuration: number;
}

export interface PerformanceMetrics {
  timestamp?: Date;
  tenantId?: string;
  userId?: string;
  averageResponseTime: number;
  errorRate: number;
  throughput: number;
  tokenEfficiency?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    efficiency: number;
    wastedTokens: number;
    optimizationScore: number;
  };
  context?: Record<string, any>;
}

export interface RetentionAnalytics {
  userRetentionRate: number;
  churnRate: number;
  averageLifetime: number;
}

export interface ComparisonMetrics {
  currentPeriod: any;
  previousPeriod: any;
  growthRate: number;
}

export interface TrendAnalysis {
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
  prediction: any[];
}

export interface UserSegment {
  segmentId: string;
  segmentName: string;
  userCount: number;
  characteristics: Record<string, any>;
}

export interface UserAnalytics {
  userId?: string;
  activityScore?: number;
  skillProgress?: Record<string, number>;
  timeframe?: string;
  period?: any;
  overview?: any;
  [key: string]: any;
}

export interface PlatformAnalytics {
  totalUsers?: number;
  activeUsers?: number;
  newRegistrations?: number;
  timeframe?: string;
  period?: any;
  overview?: any;
  [key: string]: any;
}

export interface EngagementMetrics {
  averageSessionDuration?: number;
  pagesPerSession?: number;
  bounceRate?: number;
  timeframe?: string;
  period?: any;
  sessions?: any;
  [key: string]: any;
}

export interface ContentPerformance {
  contentId?: string;
  views?: number;
  engagementRate?: number;
  conversions?: number;
  timeframe?: string;
  period?: any;
  contentType?: string;
  overview?: any;
  topPerforming?: any;
  categories?: any;
  creators?: any;
  engagement?: any;
  quality?: any;
  trends?: any;
}

export interface SkillAnalytics {
  skillId?: string;
  completionRate?: number;
  averageScore?: number;
  timeToComplete?: number;
  timeframe?: string;
  period?: any;
  overview?: any;
  distribution?: any;
  assessments?: any;
  improvement?: any;
  improvements?: any;
  competency?: any;
  recommendations?: any;
  [key: string]: any;
}

export interface LearningAnalytics {
  courseId?: string;
  enrollments?: number;
  completionRate?: number;
  satisfaction?: number;
  timeframe?: string;
  period?: any;
  overview?: any;
  paths?: any;
  lessons?: any;
  completion?: any;
  engagement?: any;
  effectiveness?: any;
  spacedRepetition?: any;
}

export interface CommunityAnalytics {
  timeframe?: string;
  period?: { startDate: Date; endDate: Date };
  overview?: {
    totalMembers: number;
    activeMembers: number;
    newMembers: number;
    retentionRate: number;
  };
  membership?: any;
  content?: any;
  engagement?: any;
  moderation?: any;
  activity?: any;
  interactions?: any;
  influencers?: any;
  health?: any;
  postsCount: number;
  commentsCount: number;
  activeDiscussions: number;
}

export interface AnalyticsFilter {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  category?: string;
}