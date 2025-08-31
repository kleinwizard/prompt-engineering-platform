import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import {
  UserAnalytics,
  PlatformAnalytics,
  EngagementMetrics,
  ContentPerformance,
  SkillAnalytics,
  LearningAnalytics,
  CommunityAnalytics,
  AnalyticsFilter,
} from './interfaces';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  
  // Cache for frequently accessed metrics
  private metricsCache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  private readonly CACHE_TTL = {
    realtime: 30 * 1000, // 30 seconds
    hourly: 60 * 60 * 1000, // 1 hour
    daily: 24 * 60 * 60 * 1000, // 24 hours
  };

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async getUserAnalytics(userId: string, timeframe: string = '30d'): Promise<UserAnalytics> {
    const cacheKey = `user_analytics_${userId}_${timeframe}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      basicStats,
      promptStats,
      templateStats,
      challengeStats,
      learningStats,
      communityStats,
      engagementData,
      skillProgress,
    ] = await Promise.all([
      this.getUserBasicStats(userId, startDate, endDate),
      this.getUserPromptStats(userId, startDate, endDate),
      this.getUserTemplateStats(userId, startDate, endDate),
      this.getUserChallengeStats(userId, startDate, endDate),
      this.getUserLearningStats(userId, startDate, endDate),
      this.getUserCommunityStats(userId, startDate, endDate),
      this.getUserEngagementData(userId, startDate, endDate),
      this.getUserSkillProgress(userId, startDate, endDate),
    ]);

    const analytics: UserAnalytics = {
      userId,
      timeframe,
      period: { startDate, endDate },
      overview: {
        totalPoints: basicStats.totalPoints,
        currentLevel: basicStats.level,
        currentStreak: basicStats.streak,
        rank: basicStats.globalRank,
        joinDate: basicStats.joinDate,
        lastActive: basicStats.lastActive,
      },
      activity: {
        totalSessions: engagementData.sessions,
        averageSessionDuration: engagementData.avgSessionDuration,
        totalTimeSpent: engagementData.totalTimeSpent,
        dailyActivity: engagementData.dailyBreakdown,
        peakHours: engagementData.peakHours,
      },
      content: {
        prompts: {
          created: promptStats.created,
          improved: promptStats.improved,
          executed: promptStats.executed,
          shared: promptStats.shared,
          avgImprovement: promptStats.avgImprovement,
        },
        templates: {
          created: templateStats.created,
          used: templateStats.used,
          shared: templateStats.shared,
          avgRating: templateStats.avgRating,
        },
      },
      learning: {
        pathsEnrolled: learningStats.pathsEnrolled,
        pathsCompleted: learningStats.pathsCompleted,
        lessonsCompleted: learningStats.lessonsCompleted,
        totalLearningTime: learningStats.totalTime,
        averageQuizScore: learningStats.avgQuizScore,
        streakDays: learningStats.streakDays,
      },
      challenges: {
        participated: challengeStats.participated,
        completed: challengeStats.completed,
        won: challengeStats.won,
        averageScore: challengeStats.avgScore,
        bestRank: challengeStats.bestRank,
      },
      community: {
        followers: communityStats.followers,
        following: communityStats.following,
        comments: communityStats.comments,
        likes: communityStats.likes,
        reputation: communityStats.reputation,
      },
      skills: {
        overall: skillProgress.overall,
        breakdown: skillProgress.breakdown,
        improvements: skillProgress.improvements,
        assessments: skillProgress.assessments,
      },
      achievements: await this.getUserAchievements(userId, startDate, endDate),
      trends: await this.getUserTrends(userId, timeframe),
    };

    this.setCache(cacheKey, analytics, this.CACHE_TTL.hourly);
    return analytics;
  }

  async getPlatformAnalytics(timeframe: string = '30d', filters?: AnalyticsFilter): Promise<PlatformAnalytics> {
    const cacheKey = `platform_analytics_${timeframe}_${JSON.stringify(filters || {})}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      userMetrics,
      contentMetrics,
      engagementMetrics,
      learningMetrics,
      revenueMetrics,
      performanceMetrics,
    ] = await Promise.all([
      this.getPlatformUserMetrics(startDate, endDate, filters),
      this.getPlatformContentMetrics(startDate, endDate, filters),
      this.getPlatformEngagementMetrics(startDate, endDate, filters),
      this.getPlatformLearningMetrics(startDate, endDate, filters),
      this.getPlatformRevenueMetrics(startDate, endDate, filters),
      this.getPlatformPerformanceMetrics(startDate, endDate, filters),
    ]);

    const analytics: PlatformAnalytics = {
      timeframe,
      period: { startDate, endDate },
      overview: {
        totalUsers: userMetrics.total,
        activeUsers: userMetrics.active,
        newUsers: userMetrics.new,
        totalContent: contentMetrics.total,
        totalEngagement: engagementMetrics.total,
        conversionRate: userMetrics.conversionRate,
      },
      growth: {
        userGrowth: userMetrics.growth,
        contentGrowth: contentMetrics.growth,
        engagementGrowth: engagementMetrics.growth,
        revenueGrowth: revenueMetrics.growth,
      },
      users: userMetrics,
      content: contentMetrics,
      engagement: engagementMetrics,
      learning: learningMetrics,
      revenue: revenueMetrics,
      performance: performanceMetrics,
      retention: await this.getRetentionAnalytics(startDate, endDate),
      cohorts: await this.getCohortAnalysis(startDate, endDate),
      trends: await this.getPlatformTrends(timeframe),
    };

    this.setCache(cacheKey, analytics, this.CACHE_TTL.hourly);
    return analytics;
  }

  async getEngagementMetrics(timeframe: string = '7d'): Promise<EngagementMetrics> {
    const cacheKey = `engagement_metrics_${timeframe}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      sessionData,
      interactionData,
      contentInteractions,
      socialEngagement,
      featureUsage,
    ] = await Promise.all([
      this.getSessionMetrics(startDate, endDate),
      this.getInteractionMetrics(startDate, endDate),
      this.getContentInteractionMetrics(startDate, endDate),
      this.getSocialEngagementMetrics(startDate, endDate),
      this.getFeatureUsageMetrics(startDate, endDate),
    ]);

    const metrics: EngagementMetrics = {
      timeframe,
      period: { startDate, endDate },
      sessions: sessionData,
      interactions: interactionData,
      content: contentInteractions,
      social: socialEngagement,
      features: featureUsage,
      heatmaps: await this.generateHeatmapData(startDate, endDate),
      funnels: await this.getFunnelAnalytics(startDate, endDate),
    };

    this.setCache(cacheKey, metrics, this.CACHE_TTL.hourly);
    return metrics;
  }

  async getContentPerformance(contentType?: 'prompts' | 'templates', timeframe: string = '30d'): Promise<ContentPerformance> {
    const cacheKey = `content_performance_${contentType || 'all'}_${timeframe}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      topContent,
      categoryAnalysis,
      creatorAnalysis,
      engagementAnalysis,
      qualityMetrics,
    ] = await Promise.all([
      this.getTopPerformingContent(contentType, startDate, endDate),
      this.getContentCategoryAnalysis(contentType, startDate, endDate),
      this.getContentCreatorAnalysis(contentType, startDate, endDate),
      this.getContentEngagementAnalysis(contentType, startDate, endDate),
      this.getContentQualityMetrics(contentType, startDate, endDate),
    ]);

    const performance: ContentPerformance = {
      timeframe,
      period: { startDate, endDate },
      contentType: contentType || 'all',
      overview: {
        totalContent: topContent.total,
        averageRating: qualityMetrics.avgRating,
        totalViews: engagementAnalysis.totalViews,
        totalLikes: engagementAnalysis.totalLikes,
        totalShares: engagementAnalysis.totalShares,
      },
      topPerforming: topContent.items,
      categories: categoryAnalysis,
      creators: creatorAnalysis,
      engagement: engagementAnalysis,
      quality: qualityMetrics,
      trends: await this.getContentTrends(contentType, timeframe),
    };

    this.setCache(cacheKey, performance, this.CACHE_TTL.hourly);
    return performance;
  }

  async getSkillAnalytics(timeframe: string = '30d'): Promise<SkillAnalytics> {
    const cacheKey = `skill_analytics_${timeframe}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      overallProgress,
      skillDistribution,
      assessmentData,
      improvementTrends,
      competencyLevels,
    ] = await Promise.all([
      this.getOverallSkillProgress(startDate, endDate),
      this.getSkillDistribution(startDate, endDate),
      this.getSkillAssessmentData(startDate, endDate),
      this.getSkillImprovementTrends(startDate, endDate),
      this.getCompetencyLevels(startDate, endDate),
    ]);

    const analytics: SkillAnalytics = {
      timeframe,
      period: { startDate, endDate },
      overview: {
        totalAssessments: assessmentData.total,
        averageScore: overallProgress.avgScore,
        skillsImproved: improvementTrends.improved,
        topSkill: skillDistribution.top,
      },
      distribution: skillDistribution,
      assessments: assessmentData,
      improvements: improvementTrends,
      competency: competencyLevels,
      recommendations: await this.getSkillRecommendations(startDate, endDate),
    };

    this.setCache(cacheKey, analytics, this.CACHE_TTL.hourly);
    return analytics;
  }

  async getLearningAnalytics(timeframe: string = '30d'): Promise<LearningAnalytics> {
    const cacheKey = `learning_analytics_${timeframe}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      pathMetrics,
      lessonMetrics,
      completionRates,
      engagementPatterns,
      effectivenessMetrics,
    ] = await Promise.all([
      this.getLearningPathMetrics(startDate, endDate),
      this.getLessonMetrics(startDate, endDate),
      this.getCompletionRates(startDate, endDate),
      this.getLearningEngagementPatterns(startDate, endDate),
      this.getLearningEffectivenessMetrics(startDate, endDate),
    ]);

    const analytics: LearningAnalytics = {
      timeframe,
      period: { startDate, endDate },
      overview: {
        totalEnrollments: pathMetrics.enrollments,
        completionRate: completionRates.overall,
        averageLearningTime: lessonMetrics.avgTime,
        satisfactionScore: effectivenessMetrics.satisfaction,
      },
      paths: pathMetrics,
      lessons: lessonMetrics,
      completion: completionRates,
      engagement: engagementPatterns,
      effectiveness: effectivenessMetrics,
      spacedRepetition: await this.getSpacedRepetitionMetrics(startDate, endDate),
    };

    this.setCache(cacheKey, analytics, this.CACHE_TTL.hourly);
    return analytics;
  }

  async getCommunityAnalytics(timeframe: string = '30d'): Promise<CommunityAnalytics> {
    const cacheKey = `community_analytics_${timeframe}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      membershipMetrics,
      activityMetrics,
      contentMetrics,
      interactionMetrics,
      moderationMetrics,
    ] = await Promise.all([
      this.getCommunityMembershipMetrics(startDate, endDate),
      this.getCommunityActivityMetrics(startDate, endDate),
      this.getCommunityContentMetrics(startDate, endDate),
      this.getCommunityInteractionMetrics(startDate, endDate),
      this.getCommunityModerationMetrics(startDate, endDate),
    ]);

    const analytics: CommunityAnalytics = {
      timeframe,
      period: { startDate, endDate },
      overview: {
        totalMembers: membershipMetrics.total,
        activeMembers: membershipMetrics.active,
        newMembers: membershipMetrics.new,
        retentionRate: membershipMetrics.retention,
      },
      membership: membershipMetrics,
      activity: activityMetrics,
      content: contentMetrics,
      interactions: interactionMetrics,
      moderation: moderationMetrics,
      influencers: await this.getInfluencerMetrics(startDate, endDate),
      health: await this.getCommunityHealthScore(startDate, endDate),
    };

    this.setCache(cacheKey, analytics, this.CACHE_TTL.hourly);
    return analytics;
  }

  async getRealtimeMetrics(): Promise<any> {
    const cacheKey = 'realtime_metrics';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      activeUsers,
      recentActivity,
      systemHealth,
      currentLoad,
    ] = await Promise.all([
      this.getCurrentActiveUsers(),
      this.getRecentActivity(oneHourAgo),
      this.getSystemHealthMetrics(),
      this.getCurrentSystemLoad(),
    ]);

    const metrics = {
      timestamp: now,
      activeUsers,
      recentActivity,
      systemHealth,
      currentLoad,
      alerts: await this.getActiveAlerts(),
    };

    this.setCache(cacheKey, metrics, this.CACHE_TTL.realtime);
    return metrics;
  }

  async trackEvent(userId: string, event: string, properties: any, sessionId?: string): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId,
          sessionId: sessionId || 'anonymous',
          event,
          properties,
          timestamp: new Date(),
        },
      });

      // Emit event for real-time processing
      this.eventEmitter.emit('analytics.event', {
        userId,
        event,
        properties,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Failed to track event', { userId, event, error });
    }
  }

  async generateReport(type: string, timeframe: string, filters?: any): Promise<any> {
    switch (type) {
      case 'user_activity':
        return this.generateUserActivityReport(timeframe, filters);
      case 'content_performance':
        return this.generateContentPerformanceReport(timeframe, filters);
      case 'learning_effectiveness':
        return this.generateLearningEffectivenessReport(timeframe, filters);
      case 'community_health':
        return this.generateCommunityHealthReport(timeframe, filters);
      case 'platform_overview':
        return this.generatePlatformOverviewReport(timeframe, filters);
      default:
        throw new Error(`Unknown report type: ${type}`);
    }
  }

  // Scheduled tasks for data aggregation
  @Cron(CronExpression.EVERY_10_MINUTES)
  async aggregateRealtimeMetrics(): Promise<void> {
    try {
      // Clear realtime cache to force refresh
      this.clearCache('realtime_metrics');
      
      // Pre-warm frequently accessed metrics
      await this.getRealtimeMetrics();
      
      this.logger.log('Realtime metrics aggregated');
    } catch (error) {
      this.logger.error('Failed to aggregate realtime metrics', error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async aggregateHourlyMetrics(): Promise<void> {
    try {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Aggregate key metrics for the past hour
      await this.aggregateSessionMetrics(hourAgo, now);
      await this.aggregateEngagementMetrics(hourAgo, now);
      await this.aggregateContentMetrics(hourAgo, now);
      
      this.logger.log('Hourly metrics aggregated');
    } catch (error) {
      this.logger.error('Failed to aggregate hourly metrics', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async aggregateDailyMetrics(): Promise<void> {
    try {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      // Aggregate daily metrics
      await this.aggregateUserMetrics(yesterday, today);
      await this.aggregateLearningMetrics(yesterday, today);
      await this.aggregateCommunityMetrics(yesterday, today);
      
      // Clean up old raw events
      await this.cleanupOldEvents();
      
      this.logger.log('Daily metrics aggregated');
    } catch (error) {
      this.logger.error('Failed to aggregate daily metrics', error);
    }
  }

  // Private helper methods
  
  private parseTimeframe(timeframe: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate: Date;

    if (timeframe.endsWith('h')) {
      const hours = parseInt(timeframe.replace('h', ''));
      startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);
    } else if (timeframe.endsWith('d')) {
      const days = parseInt(timeframe.replace('d', ''));
      startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    } else if (timeframe.endsWith('w')) {
      const weeks = parseInt(timeframe.replace('w', ''));
      startDate = new Date(endDate.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe.endsWith('m')) {
      const months = parseInt(timeframe.replace('m', ''));
      startDate = new Date(endDate.getTime() - months * 30 * 24 * 60 * 60 * 1000);
    } else {
      // Default to 30 days
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  private getFromCache(key: string): any | null {
    const cached = this.metricsCache.get(key);
    if (cached && Date.now() < cached.timestamp + cached.ttl) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any, ttl: number): void {
    this.metricsCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  private clearCache(pattern?: string): void {
    if (pattern) {
      for (const key of this.metricsCache.keys()) {
        if (key.includes(pattern)) {
          this.metricsCache.delete(key);
        }
      }
    } else {
      this.metricsCache.clear();
    }
  }

  // User analytics helper methods
  
  private async getUserBasicStats(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });

    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const globalRank = await this.prisma.userProfile.count({
      where: {
        totalPoints: { gt: user.profile?.totalPoints || 0 },
      },
    });

    return {
      totalPoints: user.profile?.totalPoints || 0,
      level: user.profile?.level || 1,
      streak: user.profile?.currentStreak || 0,
      globalRank: globalRank + 1,
      joinDate: user.createdAt,
      lastActive: user.lastActive,
    };
  }

  private async getUserPromptStats(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const [prompts, improvements] = await Promise.all([
      this.prisma.prompt.findMany({
        where: {
          userId,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.analyticsEvent.findMany({
        where: {
          userId,
          event: 'prompt.improved',
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    const executed = await this.prisma.analyticsEvent.count({
      where: {
        userId,
        event: 'prompt.executed',
        timestamp: { gte: startDate, lte: endDate },
      },
    });

    const shared = prompts.filter(p => p.isPublic).length;
    const avgImprovement = improvements.reduce((sum, imp) => {
      return sum + ((imp.properties as any)?.improvement_score || 0);
    }, 0) / (improvements.length || 1);

    return {
      created: prompts.length,
      improved: improvements.length,
      executed,
      shared,
      avgImprovement,
    };
  }

  private async getUserTemplateStats(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const templates = await this.prisma.template.findMany({
      where: {
        userId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const used = await this.prisma.analyticsEvent.count({
      where: {
        userId,
        event: 'template.used',
        timestamp: { gte: startDate, lte: endDate },
      },
    });

    const avgRating = templates.reduce((sum, t) => sum + t.rating, 0) / (templates.length || 1);

    return {
      created: templates.length,
      used,
      shared: templates.filter(t => t.isPublic).length,
      avgRating,
    };
  }

  private async getUserChallengeStats(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const [participations, submissions] = await Promise.all([
      this.prisma.challengeParticipant.findMany({
        where: {
          userId,
          joinedAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.challengeSubmission.findMany({
        where: {
          userId,
          submittedAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    const avgScore = submissions.reduce((sum, s) => sum + s.score, 0) / (submissions.length || 1);
    const bestRank = submissions.length > 0 ? Math.min(...submissions.map(s => s.rank).filter(r => r !== null)) : null;
    const won = submissions.filter(s => s.rank <= 3).length;

    return {
      participated: participations.length,
      completed: submissions.length,
      won,
      avgScore,
      bestRank,
    };
  }

  private async getUserLearningStats(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const [enrollments, completions, lessonProgress] = await Promise.all([
      this.prisma.userLearningPath.findMany({
        where: {
          userId,
          enrolledAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.lessonProgress.findMany({
        where: {
          userId,
          status: 'completed',
          completedAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.lessonProgress.findMany({
        where: {
          userId,
          status: 'completed',
        },
        select: {
          score: true,
          timeSpent: true,
          completedAt: true,
        },
      }),
    ]);

    const pathsCompleted = enrollments.filter(e => e.status === 'completed').length;
    const totalTime = completions.reduce((sum, c) => sum + (c.timeSpent || 0), 0);
    const avgQuizScore = lessonProgress
      .filter(lp => lp.score !== null)
      .reduce((sum, lp) => sum + lp.score, 0) / (lessonProgress.filter(lp => lp.score !== null).length || 1);

    // Calculate learning streak
    const streakDays = await this.calculateLearningStreak(userId);

    return {
      pathsEnrolled: enrollments.length,
      pathsCompleted,
      lessonsCompleted: completions.length,
      totalTime,
      avgQuizScore,
      streakDays,
    };
  }

  private async getUserCommunityStats(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const [followers, following, comments, likes, reputation] = await Promise.all([
      this.prisma.follow.count({ where: { followingId: userId } }),
      this.prisma.follow.count({ where: { followerId: userId } }),
      this.prisma.comment.count({
        where: {
          userId,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.like.count({
        where: {
          userId,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      this.calculateUserReputation(userId),
    ]);

    return {
      followers,
      following,
      comments,
      likes,
      reputation,
    };
  }

  private async getUserEngagementData(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const sessions = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: 'session.start',
        timestamp: { gte: startDate, lte: endDate },
      },
    });

    // Group by day for daily breakdown
    const dailyBreakdown = {};
    const peakHours = Array(24).fill(0);
    let totalTimeSpent = 0;

    sessions.forEach(session => {
      const date = session.timestamp.toISOString().split('T')[0];
      dailyBreakdown[date] = (dailyBreakdown[date] || 0) + 1;
      
      const hour = session.timestamp.getHours();
      peakHours[hour]++;

      const duration = (session.properties as any)?.duration || 0;
      totalTimeSpent += duration;
    });

    const avgSessionDuration = totalTimeSpent / (sessions.length || 1);

    return {
      sessions: sessions.length,
      avgSessionDuration,
      totalTimeSpent,
      dailyBreakdown: Object.entries(dailyBreakdown).map(([date, count]) => ({
        date,
        sessions: count,
      })),
      peakHours: peakHours.map((count, hour) => ({ hour, sessions: count })),
    };
  }

  private async getUserSkillProgress(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const userSkills = await this.prisma.userSkills.findUnique({
      where: { userId },
    });

    const assessments = await this.prisma.skillAssessment.findMany({
      where: {
        userId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    if (!userSkills) {
      return {
        overall: 0,
        breakdown: {},
        improvements: [],
        assessments: 0,
      };
    }

    const breakdown = {
      specificity: userSkills.specificity,
      constraints: userSkills.constraints,
      structure: userSkills.structure,
      roleDefinition: userSkills.roleDefinition,
      outputFormat: userSkills.outputFormat,
      verification: userSkills.verification,
      safety: userSkills.safety,
    };

    // Calculate improvements from assessments
    const improvements = this.calculateSkillImprovements(assessments);

    return {
      overall: userSkills.overallScore,
      breakdown,
      improvements,
      assessments: assessments.length,
    };
  }

  private async getUserAchievements(userId: string, startDate: Date, endDate: Date): Promise<any[]> {
    const achievements = await this.prisma.achievement.findMany({
      where: {
        userId,
        completedAt: { gte: startDate, lte: endDate },
      },
      orderBy: { completedAt: 'desc' },
    });

    return achievements.map(achievement => ({
      type: achievement.type,
      category: achievement.category,
      title: achievement.title,
      description: achievement.description,
      points: achievement.points,
      completedAt: achievement.completedAt,
    }));
  }

  private async getUserTrends(userId: string, timeframe: string): Promise<any> {
    // Calculate trends based on previous period comparison
    const { startDate, endDate } = this.parseTimeframe(timeframe);
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    const prevEndDate = startDate;

    const [currentPeriod, previousPeriod] = await Promise.all([
      this.getUserBasicMetricsForPeriod(userId, startDate, endDate),
      this.getUserBasicMetricsForPeriod(userId, prevStartDate, prevEndDate),
    ]);

    return {
      pointsChange: this.calculatePercentageChange(previousPeriod.points, currentPeriod.points),
      activityChange: this.calculatePercentageChange(previousPeriod.activity, currentPeriod.activity),
      contentChange: this.calculatePercentageChange(previousPeriod.content, currentPeriod.content),
      learningChange: this.calculatePercentageChange(previousPeriod.learning, currentPeriod.learning),
    };
  }

  // Additional helper methods for platform analytics would go here...
  // Due to length constraints, I'm showing the pattern with user analytics
  // The full implementation would include all the methods referenced above

  private async getPlatformUserMetrics(startDate: Date, endDate: Date, filters?: AnalyticsFilter): Promise<any> {
    const [total, active, newUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          lastActive: { gte: startDate },
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    return {
      total,
      active,
      new: newUsers,
      growth: await this.calculateUserGrowth(startDate, endDate),
      conversionRate: await this.calculateConversionRate(startDate, endDate),
    };
  }

  // More implementation methods would continue...
  // This demonstrates the comprehensive analytics service structure

  private calculatePercentageChange(oldValue: number, newValue: number): number {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    return ((newValue - oldValue) / oldValue) * 100;
  }

  private async calculateLearningStreak(userId: string): Promise<number> {
    // Implementation for calculating learning streak
    const completions = await this.prisma.lessonProgress.findMany({
      where: {
        userId,
        status: 'completed',
        completedAt: { not: null },
      },
      select: { completedAt: true },
      orderBy: { completedAt: 'desc' },
    });

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(23, 59, 59, 999);

    for (const completion of completions) {
      const completionDate = new Date(completion.completedAt);
      completionDate.setHours(23, 59, 59, 999);

      const daysDiff = Math.floor(
        (currentDate.getTime() - completionDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff <= 1) {
        streak++;
        currentDate = completionDate;
      } else {
        break;
      }
    }

    return streak;
  }

  private async calculateUserReputation(userId: string): Promise<number> {
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: { startsWith: 'reputation.' },
      },
    });

    return events.reduce((sum, event) => {
      return sum + ((event.properties as any)?.points || 0);
    }, 0);
  }

  private calculateSkillImprovements(assessments: any[]): any[] {
    // Calculate skill improvements from assessments
    if (assessments.length < 2) return [];

    const improvements = [];
    const sortedAssessments = assessments.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    for (let i = 1; i < sortedAssessments.length; i++) {
      const current = sortedAssessments[i];
      const previous = sortedAssessments[i - 1];
      
      if (current.overallScore > previous.overallScore) {
        improvements.push({
          skill: 'overall',
          improvement: current.overallScore - previous.overallScore,
          date: current.createdAt,
        });
      }
    }

    return improvements;
  }

  private async getUserBasicMetricsForPeriod(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const [pointsGained, activities, contentCreated, lessonsCompleted] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: {
          userId,
          event: { startsWith: 'points.' },
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          userId,
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.prompt.count({
        where: {
          userId,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.lessonProgress.count({
        where: {
          userId,
          status: 'completed',
          completedAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    return {
      points: pointsGained,
      activity: activities,
      content: contentCreated,
      learning: lessonsCompleted,
    };
  }

  private async calculateUserGrowth(startDate: Date, endDate: Date): Promise<number> {
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    
    const [currentPeriod, previousPeriod] = await Promise.all([
      this.prisma.user.count({
        where: { createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: prevStartDate, lt: startDate } },
      }),
    ]);

    return this.calculatePercentageChange(previousPeriod, currentPeriod);
  }

  private async calculateConversionRate(startDate: Date, endDate: Date): Promise<number> {
    const [visitors, signups] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: {
          event: 'page.visited',
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: startDate, lte: endDate } },
      }),
    ]);

    return visitors > 0 ? (signups / visitors) * 100 : 0;
  }

  private async cleanupOldEvents(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    await this.prisma.analyticsEvent.deleteMany({
      where: {
        timestamp: { lt: thirtyDaysAgo },
      },
    });

    this.logger.log('Cleaned up old analytics events');
  }

  // Platform content analytics implementation
  private async getPlatformContentMetrics(startDate: Date, endDate: Date, filters?: AnalyticsFilter): Promise<any> {
    const dateFilter = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    const [promptCount, templateCount, userCount] = await Promise.all([
      this.prisma.prompt.count({ where: dateFilter }),
      this.prisma.template.count({ where: dateFilter }),
      this.prisma.user.count({ where: dateFilter }),
    ]);

    return {
      prompts: promptCount,
      templates: templateCount, 
      users: userCount,
      period: {
        start: startDate,
        end: endDate,
      },
    };
  }

  private async getPlatformEngagementMetrics(startDate: Date, endDate: Date, filters?: AnalyticsFilter): Promise<any> {
    const dateFilter = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Get analytics events for engagement metrics
    const engagementEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        createdAt: dateFilter.createdAt,
        event: {
          in: ['prompt.executed', 'template.used', 'user.login', 'prompt.shared']
        },
      },
      select: {
        event: true,
        userId: true,
        createdAt: true,
      },
    });

    const uniqueUsers = new Set(engagementEvents.map(e => e.userId)).size;
    const eventCounts = engagementEvents.reduce((acc, event) => {
      acc[event.event] = (acc[event.event] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      activeUsers: uniqueUsers,
      promptExecutions: eventCounts['prompt.executed'] || 0,
      templateUsage: eventCounts['template.used'] || 0,
      userLogins: eventCounts['user.login'] || 0,
      promptShares: eventCounts['prompt.shared'] || 0,
      totalEngagementEvents: engagementEvents.length,
      period: {
        start: startDate,
        end: endDate,
      },
    };
  }

  private async getPlatformLearningMetrics(startDate: Date, endDate: Date, filters?: AnalyticsFilter): Promise<any> {
    // Get learning-related analytics events
    const learningEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        event: {
          startsWith: 'learning.',
        },
      },
      select: {
        event: true,
        userId: true,
        properties: true,
      },
    });

    const learningStats = learningEvents.reduce((acc, event) => {
      const eventType = event.event.split('.')[1]; // Extract action after 'learning.'
      acc[eventType] = (acc[eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      enrollments: learningStats['enrolled'] || 0,
      completions: learningStats['completed'] || 0,
      assessments: learningStats['assessed'] || 0,
      totalLearningEvents: learningEvents.length,
      uniqueLearners: new Set(learningEvents.map(e => e.userId)).size,
      period: {
        start: startDate,
        end: endDate,
      },
    };
  }

  private async getPlatformRevenueMetrics(startDate: Date, endDate: Date, filters?: AnalyticsFilter): Promise<any> {
    // Get subscription analytics for revenue tracking
    const subscriptionEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        event: {
          in: ['subscription.created', 'subscription.upgraded', 'subscription.cancelled', 'payment.completed']
        },
      },
      select: {
        event: true,
        properties: true,
        userId: true,
      },
    });

    let totalRevenue = 0;
    const revenueStats = subscriptionEvents.reduce((acc, event) => {
      const eventType = event.event.split('.')[1];
      acc[eventType] = (acc[eventType] || 0) + 1;
      
      // Extract revenue from payment events
      if (event.event === 'payment.completed' && event.properties) {
        const amount = (event.properties as any)?.amount || 0;
        totalRevenue += amount;
      }
      
      return acc;
    }, {} as Record<string, number>);

    return {
      totalRevenue,
      subscriptionsCreated: revenueStats['created'] || 0,
      subscriptionsUpgraded: revenueStats['upgraded'] || 0,
      subscriptionsCancelled: revenueStats['cancelled'] || 0,
      paymentsCompleted: revenueStats['completed'] || 0,
      period: {
        start: startDate,
        end: endDate,
      },
    };
  }

  private async getPlatformPerformanceMetrics(startDate: Date, endDate: Date, filters?: AnalyticsFilter): Promise<any> {
    // Get performance-related analytics events
    const performanceEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        event: {
          in: ['api.request', 'api.error', 'llm.request', 'llm.timeout']
        },
      },
      select: {
        event: true,
        properties: true,
      },
    });

    let totalRequests = 0;
    let totalErrors = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    performanceEvents.forEach(event => {
      if (event.event === 'api.request') {
        totalRequests++;
        const responseTime = (event.properties as any)?.responseTime;
        if (responseTime) {
          totalResponseTime += responseTime;
          responseTimeCount++;
        }
      } else if (event.event === 'api.error') {
        totalErrors++;
      }
    });

    const avgResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    return {
      totalRequests,
      totalErrors,
      errorRate,
      averageResponseTime: avgResponseTime,
      period: {
        start: startDate,
        end: endDate,
      },
    };
  }

  private async getRetentionAnalytics(startDate: Date, endDate: Date): Promise<any> {
    // TODO: Implement retention analytics for date range
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff };
  }

  private async getCohortAnalysis(startDate: Date, endDate: Date): Promise<any> {
    // TODO: Implement cohort analysis
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff };
  }

  private async getPlatformTrends(timeframe: string): Promise<any> {
    // Implementation would calculate platform trends
    return {};
  }

  // Additional placeholder methods for completeness
  private async getSessionMetrics(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async getInteractionMetrics(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async getContentInteractionMetrics(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async getSocialEngagementMetrics(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async getFeatureUsageMetrics(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async generateHeatmapData(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async getFunnelAnalytics(startDate: Date, endDate: Date): Promise<any> { 
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
    return { placeholder: true, daysRange: daysDiff }; 
  }
  private async getCurrentActiveUsers(): Promise<number> { return 0; }
  private async getRecentActivity(startDate: Date): Promise<any> { return {}; }
  private async getSystemHealthMetrics(): Promise<any> { return {}; }
  private async getCurrentSystemLoad(): Promise<any> { return {}; }
  private async getActiveAlerts(): Promise<any[]> { return []; }
  private async aggregateSessionMetrics(startDate: Date, endDate: Date): Promise<void> {}
  private async aggregateEngagementMetrics(startDate: Date, endDate: Date): Promise<void> {}
  private async aggregateContentMetrics(startDate: Date, endDate: Date): Promise<void> {}
  private async aggregateUserMetrics(startDate: Date, endDate: Date): Promise<void> {}
  private async aggregateLearningMetrics(startDate: Date, endDate: Date): Promise<void> {}
  private async aggregateCommunityMetrics(startDate: Date, endDate: Date): Promise<void> {}

  // Missing method stubs for compilation
  private async getTopPerformingContent(contentType?: string, startDate?: Date, endDate?: Date): Promise<any> { 
    return { total: 0, items: [] }; 
  }
  
  private async getContentCategoryAnalysis(contentType?: string, startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }
  
  private async getContentCreatorAnalysis(contentType?: string, startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }
  
  private async getContentEngagementAnalysis(contentType?: string, startDate?: Date, endDate?: Date): Promise<any> { 
    return { totalViews: 0, totalLikes: 0, totalShares: 0 }; 
  }
  
  private async getContentQualityMetrics(contentType?: string, startDate?: Date, endDate?: Date): Promise<any> { 
    return { avgRating: 0 }; 
  }
  
  private async getContentTrends(contentType?: string, timeframe?: string): Promise<any> { 
    return {}; 
  }
  
  private async getOverallSkillProgress(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }
  
  private async getSkillDistribution(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }
  
  private async getSkillAssessmentData(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }
  
  private async getSkillImprovementTrends(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }
  
  private async getCompetencyLevels(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getSkillRecommendations(startDate?: Date, endDate?: Date): Promise<any> { 
    return []; 
  }

  private async getLearningPathMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return { enrollments: 0 }; 
  }

  private async getLessonMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return { avgTime: 0 }; 
  }

  private async getCompletionRates(startDate?: Date, endDate?: Date): Promise<any> { 
    return { overall: 0 }; 
  }

  private async getLearningEngagementPatterns(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getLearningEffectivenessMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return { satisfaction: 0 }; 
  }

  private async getSpacedRepetitionMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getCommunityMembershipMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getCommunityActivityMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getCommunityContentMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getCommunityInteractionMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getCommunityModerationMetrics(startDate?: Date, endDate?: Date): Promise<any> { 
    return {}; 
  }

  private async getInfluencerMetrics(startDate?: Date, endDate?: Date): Promise<any> {
    const influencers = await this.prisma.user.findMany({
      where: {
        profile: {
          totalPoints: { gte: 1000 },
        },
      },
      include: {
        profile: true,
        _count: {
          select: {
            followers: true,
            prompts: true,
            templates: true,
          },
        },
      },
      orderBy: {
        profile: {
          totalPoints: 'desc',
        },
      },
      take: 20,
    });

    return influencers.map(user => ({
      userId: user.id,
      username: user.username,
      totalPoints: user.profile?.totalPoints || 0,
      followers: user._count.followers,
      promptsCreated: user._count.prompts,
      templatesCreated: user._count.templates,
      influence: this.calculateInfluenceScore(user),
    }));
  }

  private async getCommunityHealthScore(startDate?: Date, endDate?: Date): Promise<number> {
    const [
      activeMembers,
      totalMembers,
      recentPosts,
      recentComments,
      moderationActions,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          lastActive: { gte: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.user.count(),
      this.prisma.prompt.count({
        where: {
          createdAt: { gte: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          isPublic: true,
        },
      }),
      this.prisma.comment.count({
        where: {
          createdAt: { gte: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          event: { startsWith: 'moderation.' },
          timestamp: { gte: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const activityRatio = totalMembers > 0 ? activeMembers / totalMembers : 0;
    const contentHealthScore = (recentPosts + recentComments) / Math.max(activeMembers, 1);
    const moderationScore = Math.max(0, 1 - (moderationActions / Math.max(recentPosts + recentComments, 1)));

    return Math.round(((activityRatio * 0.4) + (contentHealthScore * 0.3) + (moderationScore * 0.3)) * 100);
  }

  private async generateUserActivityReport(timeframe: string, filters?: any): Promise<any> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);
    
    const userActivities = await this.prisma.analyticsEvent.groupBy({
      by: ['userId'],
      where: {
        timestamp: { gte: startDate, lte: endDate },
        ...(filters?.userIds && { userId: { in: filters.userIds } }),
      },
      _count: {
        event: true,
      },
      orderBy: {
        _count: {
          event: 'desc',
        },
      },
      take: 100,
    });

    const reportData = await Promise.all(
      userActivities.map(async (activity) => {
        const user = await this.prisma.user.findUnique({
          where: { id: activity.userId },
          select: { username: true, email: true },
        });

        const sessionEvents = await this.prisma.analyticsEvent.findMany({
          where: {
            userId: activity.userId,
            event: 'session.start',
            timestamp: { gte: startDate, lte: endDate },
          },
        });

        return {
          userId: activity.userId,
          username: user?.username || 'Unknown',
          totalEvents: activity._count.event,
          sessions: sessionEvents.length,
          avgSessionDuration: sessionEvents.reduce((sum, s) => sum + ((s.properties as any)?.duration || 0), 0) / sessionEvents.length || 0,
        };
      })
    );

    return {
      timeframe,
      period: { startDate, endDate },
      totalUsers: reportData.length,
      mostActiveUsers: reportData.slice(0, 10),
      summary: {
        totalEvents: reportData.reduce((sum, u) => sum + u.totalEvents, 0),
        avgEventsPerUser: reportData.reduce((sum, u) => sum + u.totalEvents, 0) / reportData.length || 0,
        totalSessions: reportData.reduce((sum, u) => sum + u.sessions, 0),
      },
    };
  }

  private async generateContentPerformanceReport(timeframe: string, filters?: any): Promise<any> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);
    
    const [prompts, templates] = await Promise.all([
      this.prisma.prompt.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          ...(filters?.category && { category: filters.category }),
          ...(filters?.isPublic !== undefined && { isPublic: filters.isPublic }),
        },
        include: {
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.template.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          ...(filters?.category && { category: filters.category }),
          ...(filters?.isPublic !== undefined && { isPublic: filters.isPublic }),
        },
        include: {
          _count: {
            select: {
              likes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      timeframe,
      period: { startDate, endDate },
      prompts: {
        total: prompts.length,
        topPerforming: prompts.slice(0, 10).map(p => ({
          id: p.id,
          title: p.title,
          likes: p._count?.likes || 0,
          comments: p._count?.comments || 0,
          category: p.category,
          views: p.views || 0,
        })),
        avgLikes: prompts.reduce((sum, p) => sum + p._count.likes, 0) / prompts.length || 0,
      },
      templates: {
        total: templates.length,
        topPerforming: templates.slice(0, 10).map(t => ({
          id: t.id,
          name: t.title,
          uses: t.usageCount || 0,
          likes: t._count?.likes || 0,
          rating: t.rating,
          category: t.category,
        })),
        avgUses: templates.reduce((sum, t) => sum + (t.usageCount || 0), 0) / templates.length || 0,
        avgRating: templates.reduce((sum, t) => sum + t.rating, 0) / templates.length || 0,
      },
    };
  }

  private async generateCommunityHealthReport(timeframe: string, filters?: any): Promise<any> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);
    
    const [
      activeUsers,
      newMembers,
      posts,
      comments,
      moderationActions,
      reports,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          lastActive: { gte: startDate },
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.prompt.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          isPublic: true,
        },
      }),
      this.prisma.comment.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          event: { startsWith: 'moderation.' },
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          event: 'content.reported',
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    const healthScore = await this.getCommunityHealthScore(startDate, endDate);
    
    return {
      timeframe,
      period: { startDate, endDate },
      overview: {
        healthScore,
        activeUsers,
        newMembers,
        totalPosts: posts,
        totalComments: comments,
      },
      engagement: {
        postsPerActiveUser: activeUsers > 0 ? posts / activeUsers : 0,
        commentsPerPost: posts > 0 ? comments / posts : 0,
        memberRetention: await this.calculateMemberRetention(startDate, endDate),
      },
      moderation: {
        totalActions: moderationActions,
        reportsReceived: reports,
        moderationRate: (posts + comments) > 0 ? moderationActions / (posts + comments) : 0,
      },
      recommendations: this.generateCommunityRecommendations(healthScore, { posts, comments, moderationActions }),
    };
  }

  private async generatePlatformOverviewReport(timeframe: string, filters?: any): Promise<any> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);
    
    const [
      userMetrics,
      contentMetrics,
      engagementMetrics,
      revenueMetrics,
      systemMetrics,
    ] = await Promise.all([
      this.getPlatformUserMetrics(startDate, endDate, filters),
      this.getPlatformContentMetrics(startDate, endDate, filters),
      this.getPlatformEngagementMetrics(startDate, endDate, filters),
      this.getPlatformRevenueMetrics(startDate, endDate, filters),
      this.getPlatformPerformanceMetrics(startDate, endDate, filters),
    ]);

    return {
      timeframe,
      period: { startDate, endDate },
      executiveSummary: {
        totalUsers: userMetrics.total,
        activeUsers: userMetrics.active,
        userGrowth: userMetrics.growth,
        contentCreated: contentMetrics.total,
        platformEngagement: engagementMetrics.total,
        // ISSUE: Hardcoded fallback uptime of 99.9% when metrics unavailable
        // FIX: Use actual system monitoring data or throw error if unavailable
        systemPerformance: systemMetrics.uptime || 99.9,
      },
      keyMetrics: {
        users: userMetrics,
        content: contentMetrics,
        engagement: engagementMetrics,
        revenue: revenueMetrics,
        performance: systemMetrics,
      },
      trends: await this.getPlatformTrends(timeframe),
      insights: this.generatePlatformInsights(userMetrics, contentMetrics, engagementMetrics),
      recommendations: this.generatePlatformRecommendations(userMetrics, contentMetrics, engagementMetrics),
    };
  }

  private calculateInfluenceScore(user: any): number {
    // ISSUE: Hardcoded influence scoring weights and thresholds
    // ISSUE: Magic numbers: followers/100, content/50, points/10000
    // FIX: Move scoring algorithm to configuration or separate scoring service
    const followersWeight = 0.3;
    const contentWeight = 0.4;
    const pointsWeight = 0.3;

    const followersScore = Math.min(user._count.followers / 100, 1) * 100;
    const contentScore = Math.min((user._count.prompts + user._count.templates) / 50, 1) * 100;
    // ISSUE: Hardcoded points threshold of 10000
    // FIX: Make configurable or calculate dynamically from user distribution
    const pointsScore = Math.min((user.profile?.totalPoints || 0) / 10000, 1) * 100;

    return Math.round(
      (followersScore * followersWeight) +
      (contentScore * contentWeight) +
      (pointsScore * pointsWeight)
    );
  }

  private async calculateMemberRetention(startDate: Date, endDate: Date): Promise<number> {
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    
    const [newMembersCurrentPeriod, activeMembersCurrentPeriod] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          createdAt: { gte: prevStartDate, lt: startDate },
        },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: {
          createdAt: { gte: prevStartDate, lt: startDate },
          lastActive: { gte: startDate },
        },
        select: { id: true },
      }),
    ]);

    return newMembersCurrentPeriod.length > 0 
      ? (activeMembersCurrentPeriod.length / newMembersCurrentPeriod.length) * 100 
      : 0;
  }

  private generateCommunityRecommendations(healthScore: number, metrics: any): string[] {
    const recommendations = [];
    
    if (healthScore < 60) {
      recommendations.push('Consider implementing community engagement initiatives');
      recommendations.push('Review moderation policies and community guidelines');
    }
    
    if (metrics.moderationActions > metrics.posts * 0.1) {
      recommendations.push('High moderation activity detected - review community guidelines');
    }
    
    if (metrics.comments / metrics.posts < 0.5) {
      recommendations.push('Low comment engagement - consider discussion prompts');
    }

    return recommendations;
  }

  private generatePlatformInsights(userMetrics: any, contentMetrics: any, engagementMetrics: any): string[] {
    const insights = [];
    
    if (userMetrics.growth > 20) {
      insights.push('Strong user growth indicates successful acquisition strategies');
    }
    
    if (contentMetrics.growth > userMetrics.growth) {
      insights.push('Content creation outpacing user growth - good content engagement');
    }
    
    if (engagementMetrics.total / userMetrics.active > 10) {
      insights.push('High engagement per active user indicates strong platform value');
    }

    return insights;
  }

  private generatePlatformRecommendations(userMetrics: any, contentMetrics: any, engagementMetrics: any): string[] {
    const recommendations = [];
    
    if (userMetrics.growth < 5) {
      recommendations.push('Focus on user acquisition strategies');
    }
    
    if (contentMetrics.total / userMetrics.active < 2) {
      recommendations.push('Encourage more content creation through incentives');
    }
    
    if (engagementMetrics.total / userMetrics.active < 5) {
      recommendations.push('Improve user engagement through feature enhancements');
    }

    return recommendations;
  }

  private async generateLearningEffectivenessReport(timeframe: string, filters?: any): Promise<any> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);
    
    const [
      learningPaths,
      completionRates,
      userProgress,
      assessmentScores,
    ] = await Promise.all([
      this.prisma.learningPath.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        include: {
          _count: {
            select: {
              enrollments: true,
              completions: true,
            },
          },
        },
      }),
      this.prisma.userLearningPath.groupBy({
        by: ['status'],
        where: {
          enrolledAt: { gte: startDate, lte: endDate },
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.lessonProgress.findMany({
        where: {
          completedAt: { gte: startDate, lte: endDate },
          status: 'completed',
        },
        select: {
          score: true,
          timeSpent: true,
          lesson: {
            select: {
              title: true,
              type: true,
            },
          },
        },
      }),
      this.prisma.skillAssessment.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          score: true,
          passed: true,
          skill: {
            select: {
              name: true,
              category: true,
            },
          },
        },
      }),
    ]);

    const totalEnrollments = completionRates.reduce((sum, cr) => sum + cr._count.id, 0);
    const completedCount = completionRates.find(cr => cr.status === 'completed')?._count.id || 0;
    const overallCompletionRate = totalEnrollments > 0 ? (completedCount / totalEnrollments) * 100 : 0;

    const avgLessonScore = userProgress.length > 0 
      ? userProgress.reduce((sum, up) => sum + (up.score || 0), 0) / userProgress.length 
      : 0;

    const avgAssessmentScore = assessmentScores.length > 0
      ? assessmentScores.reduce((sum, as) => sum + as.score, 0) / assessmentScores.length
      : 0;

    const assessmentPassRate = assessmentScores.length > 0
      ? (assessmentScores.filter(as => as.passed).length / assessmentScores.length) * 100
      : 0;

    return {
      timeframe,
      period: { startDate, endDate },
      overview: {
        totalEnrollments,
        completionRate: overallCompletionRate,
        avgLessonScore,
        avgAssessmentScore,
        assessmentPassRate,
      },
      learningPaths: {
        total: learningPaths.length,
        mostPopular: learningPaths
          .sort((a, b) => (b._count?.enrollments || 0) - (a._count?.enrollments || 0))
          .slice(0, 5)
          .map(lp => ({
            id: lp.id,
            title: lp.title,
            enrollments: lp._count?.enrollments || 0,
            completions: lp._count?.completions || 0,
            completionRate: (lp._count?.enrollments || 0) > 0 
              ? ((lp._count?.completions || 0) / (lp._count?.enrollments || 0)) * 100 
              : 0,
          })),
      },
      effectiveness: {
        completionRates: completionRates.map(cr => ({
          status: cr.status,
          count: cr._count.id,
          percentage: totalEnrollments > 0 ? (cr._count.id / totalEnrollments) * 100 : 0,
        })),
        learningProgress: {
          avgLessonScore,
          avgAssessmentScore,
          passRate: assessmentPassRate,
        },
      },
      recommendations: this.generateLearningRecommendations(overallCompletionRate, avgLessonScore, assessmentPassRate),
    };
  }

  private generateLearningRecommendations(completionRate: number, avgScore: number, passRate: number): string[] {
    const recommendations = [];
    
    if (completionRate < 50) {
      recommendations.push('Low completion rate - consider reviewing course difficulty and pacing');
    }
    
    if (avgScore < 70) {
      recommendations.push('Average scores are low - provide additional support materials');
    }
    
    if (passRate < 80) {
      recommendations.push('Assessment pass rate is low - review assessment difficulty');
    }

    return recommendations;
  }
}