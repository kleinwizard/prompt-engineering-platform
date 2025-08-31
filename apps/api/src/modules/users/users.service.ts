import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { StorageService } from '../storage/storage.service';
import {
  UpdateUserProfileDto,
  UpdateUserPreferencesDto,
  ChangePasswordDto,
  DeactivateAccountDto,
  UserSearchDto,
} from './dto';
import {
  UserWithFullProfile,
  UserPublicProfile,
  UserActivitySummary,
  UserStatistics,
  UserPreferences,
  UserSearchResult,
} from './interfaces';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly saltRounds = 12;

  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private storageService: StorageService,
    private eventEmitter: EventEmitter2,
  ) {}

  async getUserById(userId: string, requesterId?: string): Promise<UserWithFullProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        preferences: true,
        skills: true,
        badges: {
          include: { badge: true },
          orderBy: { earnedAt: 'desc' },
          take: 20,
        },
        achievements: {
          orderBy: { completedAt: 'desc' },
          take: 10,
        },
        followers: requesterId ? { where: { followerId: requesterId } } : false,
        following: requesterId ? { where: { followingId: requesterId } } : false,
        _count: {
          select: {
            followers: true,
            following: true,
            prompts: true,
            templates: true,
            comments: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check privacy settings
    if (requesterId && requesterId !== userId) {
      const canView = await this.canViewProfile(userId, requesterId, user.preferences);
      if (!canView) {
        throw new ForbiddenException('Profile is private');
      }
    }

    return this.formatUserWithFullProfile(user, requesterId);
  }

  async getPublicProfile(userId: string, requesterId?: string): Promise<UserPublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        website: true,
        location: true,
        createdAt: true,
        lastActive: true,
        profile: {
          select: {
            totalPoints: true,
            level: true,
            currentStreak: true,
            longestStreak: true,
            promptsCreated: true,
            templatesCreated: true,
            challengesWon: true,
            lessonsCompleted: true,
          },
        },
        preferences: {
          select: {
            profileVisibility: true,
            showEmail: true,
            showLocation: true,
          },
        },
        badges: {
          include: { badge: true },
          where: {
            badge: { category: { not: 'private' } }, // Hide private badges
          },
          orderBy: { earnedAt: 'desc' },
          take: 10,
        },
        skills: {
          select: {
            overallScore: true,
            specificity: true,
            constraints: true,
            structure: true,
            roleDefinition: true,
            outputFormat: true,
            verification: true,
            safety: true,
          },
        },
        _count: {
          select: {
            followers: true,
            following: true,
            prompts: { where: { isPublic: true } },
            templates: { where: { isPublic: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if profile is viewable
    if (requesterId && requesterId !== userId) {
      const canView = await this.canViewProfile(userId, requesterId, user.preferences);
      if (!canView) {
        throw new ForbiddenException('Profile is private');
      }
    }

    // Calculate additional metrics
    const [reputationScore, topSkills, recentActivity] = await Promise.all([
      this.calculateReputationScore(userId),
      this.getTopSkills(user.skills),
      this.getRecentActivity(userId, 5),
    ]);

    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      avatar: user.avatar,
      bio: user.bio,
      website: user.website,
      location: user.preferences?.showLocation ? user.location : null,
      joinedAt: user.createdAt,
      lastActive: user.lastActive,
      stats: {
        totalPoints: user.profile?.totalPoints || 0,
        level: user.profile?.level || 1,
        currentStreak: user.profile?.currentStreak || 0,
        longestStreak: user.profile?.longestStreak || 0,
        followers: user._count.followers,
        following: user._count.following,
        publicPrompts: user._count.prompts,
        publicTemplates: user._count.templates,
        challengesWon: user.profile?.challengesWon || 0,
        lessonsCompleted: user.profile?.lessonsCompleted || 0,
        reputation: reputationScore,
      },
      skills: {
        overall: user.skills?.overallScore || 0,
        top: topSkills,
        breakdown: user.skills ? {
          specificity: user.skills.specificity,
          constraints: user.skills.constraints,
          structure: user.skills.structure,
          roleDefinition: user.skills.roleDefinition,
          outputFormat: user.skills.outputFormat,
          verification: user.skills.verification,
          safety: user.skills.safety,
        } : null,
      },
      badges: user.badges.map(ub => ({
        id: ub.badge.id,
        name: ub.badge.name,
        description: ub.badge.description,
        icon: ub.badge.icon,
        category: ub.badge.category,
        rarity: ub.badge.rarity,
        earnedAt: ub.earnedAt,
      })),
      recentActivity,
    };
  }

  async updateProfile(userId: string, updateDto: UpdateUserProfileDto): Promise<UserWithFullProfile> {
    const { firstName, lastName, bio, website, location, avatar } = updateDto;

    // Handle avatar upload if provided
    let avatarUrl = avatar;
    if (avatar && avatar.startsWith('data:')) {
      avatarUrl = await this.storageService.uploadBase64Image(avatar, `avatars/${userId}`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        bio,
        website,
        location,
        avatar: avatarUrl,
      },
      include: {
        profile: true,
        preferences: true,
        skills: true,
        badges: {
          include: { badge: true },
          orderBy: { earnedAt: 'desc' },
          take: 20,
        },
        achievements: {
          orderBy: { completedAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            followers: true,
            following: true,
            prompts: true,
            templates: true,
            comments: true,
          },
        },
      },
    });

    // Award points for profile completion
    const completionScore = this.calculateProfileCompletion(updatedUser);
    if (completionScore >= 80) {
      await this.gamificationService.awardPoints(userId, 'profile_completed', {
        completionScore,
      });
    }

    // Emit profile updated event
    this.eventEmitter.emit('user.profile_updated', {
      userId,
      changes: Object.keys(updateDto),
      completionScore,
    });

    this.logger.log(`User profile updated: ${userId}`);

    return this.formatUserWithFullProfile(updatedUser, userId);
  }

  async updatePreferences(userId: string, preferencesDto: UpdateUserPreferencesDto): Promise<UserPreferences> {
    const updatedPreferences = await this.prisma.userPreferences.upsert({
      where: { userId },
      update: preferencesDto,
      create: {
        userId,
        ...preferencesDto,
      },
    });

    // Emit preferences updated event
    this.eventEmitter.emit('user.preferences_updated', {
      userId,
      preferences: updatedPreferences,
    });

    this.logger.log(`User preferences updated: ${userId}`);

    return this.formatUserPreferences(updatedPreferences);
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<void> {
    const { currentPassword, newPassword } = changePasswordDto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, this.saltRounds);

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Log security event
    await this.logSecurityEvent(userId, 'password_changed', {
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Password changed for user: ${userId}`);
  }

  async getUserStatistics(userId: string, timeframe = '30d'): Promise<UserStatistics> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [
      promptStats,
      templateStats,
      challengeStats,
      learningStats,
      communityStats,
      skillStats,
    ] = await Promise.all([
      this.getPromptStatistics(userId, startDate, endDate),
      this.getTemplateStatistics(userId, startDate, endDate),
      this.getChallengeStatistics(userId, startDate, endDate),
      this.getLearningStatistics(userId, startDate, endDate),
      this.getCommunityStatistics(userId, startDate, endDate),
      this.getSkillStatistics(userId, startDate, endDate),
    ]);

    return {
      userId,
      timeframe,
      period: { startDate, endDate },
      prompts: promptStats,
      templates: templateStats,
      challenges: challengeStats,
      learning: learningStats,
      community: communityStats,
      skills: skillStats,
    };
  }

  async searchUsers(searchDto: UserSearchDto, requesterId?: string): Promise<UserSearchResult> {
    const {
      query,
      skills,
      level,
      location,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = searchDto;

    const skip = (page - 1) * limit;

    // Build search filters
    const where: any = {
      AND: [
        // Text search
        query ? {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { bio: { contains: query, mode: 'insensitive' } },
          ],
        } : {},

        // Filters
        level ? { profile: { level: { gte: level.min, lte: level.max } } } : {},
        location ? { location: { contains: location, mode: 'insensitive' } } : {},
        skills ? {
          skills: {
            OR: skills.map(skill => ({
              [skill]: { gte: 50 }, // Minimum skill threshold
            })),
          },
        } : {},

        // Only show public profiles or followed users
        requesterId ? {
          OR: [
            { preferences: { profileVisibility: 'public' } },
            {
              AND: [
                { preferences: { profileVisibility: 'followers' } },
                { followers: { some: { followerId: requesterId } } },
              ],
            },
          ],
        } : { preferences: { profileVisibility: 'public' } },
      ].filter(Boolean),
    };

    // Build sort options
    const orderBy = this.buildUserSortOptions(sortBy);

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          bio: true,
          location: true,
          createdAt: true,
          profile: {
            select: {
              totalPoints: true,
              level: true,
              currentStreak: true,
            },
          },
          skills: {
            select: {
              overallScore: true,
              specificity: true,
              constraints: true,
              structure: true,
              roleDefinition: true,
              outputFormat: true,
              verification: true,
              safety: true,
            },
          },
          badges: {
            include: { badge: true },
            take: 3,
            orderBy: { earnedAt: 'desc' },
          },
          _count: {
            select: {
              followers: true,
              prompts: { where: { isPublic: true } },
              templates: { where: { isPublic: true } },
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const formattedUsers = await Promise.all(
      users.map(async (user) => {
        const reputation = await this.calculateReputationScore(user.id);
        const topSkills = this.getTopSkills(user.skills);

        return {
          id: user.id,
          username: user.username,
          displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
          avatar: user.avatar,
          bio: user.bio,
          location: user.location,
          level: user.profile?.level || 1,
          totalPoints: user.profile?.totalPoints || 0,
          reputation,
          topSkills,
          stats: {
            followers: user._count.followers,
            prompts: user._count.prompts,
            templates: user._count.templates,
          },
          badges: user.badges.slice(0, 3).map(ub => ({
            name: ub.badge.name,
            icon: ub.badge.icon,
            rarity: ub.badge.rarity,
          })),
          joinedAt: user.createdAt,
        };
      })
    );

    return {
      users: formattedUsers,
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    };
  }

  async deactivateAccount(userId: string, deactivateDto: DeactivateAccountDto): Promise<void> {
    const { reason, feedback } = deactivateDto;

    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Anonymize user data while preserving referential integrity
      const anonymizedData = {
        email: `deleted_${userId}@deleted.com`,
        username: `deleted_${userId}`,
        firstName: null,
        lastName: null,
        avatar: null,
        bio: 'Account deactivated',
        website: null,
        location: null,
        emailVerified: null,
      };

      await tx.user.update({
        where: { id: userId },
        data: anonymizedData,
      });

      // Mark prompts and templates as private
      await tx.prompt.updateMany({
        where: { userId },
        data: { isPublic: false },
      });

      await tx.template.updateMany({
        where: { userId },
        data: { isPublic: false },
      });

      // Log deactivation
      await tx.analyticsEvent.create({
        data: {
          userId,
          sessionId: 'account-deactivation',
          event: 'account.deactivated',
          properties: {
            reason,
            feedback,
            timestamp: new Date().toISOString(),
          },
        },
      });
    });

    // Emit account deactivated event
    this.eventEmitter.emit('user.account_deactivated', {
      userId,
      reason,
      feedback,
    });

    this.logger.log(`User account deactivated: ${userId}, reason: ${reason}`);
  }

  async getActivitySummary(userId: string, days = 30): Promise<UserActivitySummary> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [
      promptActivity,
      templateActivity,
      challengeActivity,
      learningActivity,
      communityActivity,
    ] = await Promise.all([
      this.getPromptActivity(userId, startDate),
      this.getTemplateActivity(userId, startDate),
      this.getChallengeActivity(userId, startDate),
      this.getLearningActivity(userId, startDate),
      this.getCommunityActivity(userId, startDate),
    ]);

    // Get daily activity breakdown
    const dailyActivity = await this.getDailyActivityBreakdown(userId, startDate);

    return {
      userId,
      periodDays: days,
      startDate,
      endDate: new Date(),
      prompts: promptActivity,
      templates: templateActivity,
      challenges: challengeActivity,
      learning: learningActivity,
      community: communityActivity,
      dailyBreakdown: dailyActivity,
      totalActions: Object.values({
        ...promptActivity,
        ...templateActivity,
        ...challengeActivity,
        ...learningActivity,
        ...communityActivity,
      }).reduce((sum: number, count: number) => sum + count, 0),
    };
  }

  // Private helper methods

  private formatUserWithFullProfile(user: any, requesterId?: string): UserWithFullProfile {
    return {
      id: user.id,
      email: requesterId === user.id ? user.email : null, // Only show email to self
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      avatar: user.avatar,
      bio: user.bio,
      website: user.website,
      location: user.location,
      timezone: user.timezone,
      joinedAt: user.createdAt,
      lastActive: user.lastActive,
      emailVerified: !!user.emailVerified,
      isFollowing: requesterId ? user.followers?.length > 0 : false,
      isFollowedBy: requesterId ? user.following?.length > 0 : false,
      profile: user.profile ? {
        totalPoints: user.profile.totalPoints,
        weeklyPoints: user.profile.weeklyPoints,
        monthlyPoints: user.profile.monthlyPoints,
        level: user.profile.level,
        experience: user.profile.experience,
        currentStreak: user.profile.currentStreak,
        longestStreak: user.profile.longestStreak,
        lastActivityDate: user.profile.lastActivityDate,
        promptsCreated: user.profile.promptsCreated,
        templatesCreated: user.profile.templatesCreated,
        challengesWon: user.profile.challengesWon,
        lessonsCompleted: user.profile.lessonsCompleted,
        globalRank: user.profile.globalRank,
        weeklyRank: user.profile.weeklyRank,
        monthlyRank: user.profile.monthlyRank,
      } : null,
      preferences: user.preferences ? this.formatUserPreferences(user.preferences) : null,
      skills: user.skills ? {
        overall: user.skills.overallScore,
        specificity: user.skills.specificity,
        constraints: user.skills.constraints,
        structure: user.skills.structure,
        roleDefinition: user.skills.roleDefinition,
        outputFormat: user.skills.outputFormat,
        verification: user.skills.verification,
        safety: user.skills.safety,
        assessmentCount: user.skills.assessmentCount,
        lastAssessment: user.skills.lastAssessment,
      } : null,
      badges: user.badges?.map(ub => ({
        id: ub.badge.id,
        name: ub.badge.name,
        slug: ub.badge.slug,
        description: ub.badge.description,
        icon: ub.badge.icon,
        category: ub.badge.category,
        rarity: ub.badge.rarity,
        points: ub.badge.points,
        earnedAt: ub.earnedAt,
        context: ub.context,
      })) || [],
      achievements: user.achievements?.map(achievement => ({
        id: achievement.id,
        type: achievement.type,
        category: achievement.category,
        title: achievement.title,
        description: achievement.description,
        points: achievement.points,
        metadata: achievement.metadata,
        completedAt: achievement.completedAt,
      })) || [],
      stats: {
        followers: user._count?.followers || 0,
        following: user._count?.following || 0,
        prompts: user._count?.prompts || 0,
        templates: user._count?.templates || 0,
        comments: user._count?.comments || 0,
      },
    };
  }

  private formatUserPreferences(preferences: any): UserPreferences {
    return {
      theme: preferences.theme,
      language: preferences.language,
      timezone: preferences.timezone,
      emailNotifications: preferences.emailNotifications,
      pushNotifications: preferences.pushNotifications,
      weeklyDigest: preferences.weeklyDigest,
      communityUpdates: preferences.communityUpdates,
      profileVisibility: preferences.profileVisibility,
      showEmail: preferences.showEmail,
      showLocation: preferences.showLocation,
      defaultModel: preferences.defaultModel,
      aiCoachingEnabled: preferences.aiCoachingEnabled,
      autoImprovement: preferences.autoImprovement,
    };
  }

  private async canViewProfile(userId: string, requesterId: string, preferences: any): Promise<boolean> {
    if (!preferences) return true; // Default to public

    switch (preferences.profileVisibility) {
      case 'public':
        return true;
      case 'followers':
        // ISSUE: Model 'follow' does not exist in Prisma schema
        // FIX: Create Follow model with followerId_followingId unique constraint
        const isFollowing = await this.prisma.follow.findUnique({
          where: {
            followerId_followingId: { followerId: requesterId, followingId: userId },
          },
        });
        return !!isFollowing;
      case 'private':
        return false;
      default:
        return true;
    }
  }

  private calculateProfileCompletion(user: any): number {
    let score = 0;
    const maxScore = 100;

    // Basic info (40 points)
    if (user.firstName) score += 10;
    if (user.lastName) score += 10;
    if (user.bio) score += 10;
    if (user.avatar) score += 10;

    // Additional info (30 points)
    if (user.website) score += 10;
    if (user.location) score += 10;
    if (user.emailVerified) score += 10;

    // Activity (30 points)
    if (user.profile?.promptsCreated > 0) score += 10;
    if (user.profile?.templatesCreated > 0) score += 10;
    if (user.skills?.assessmentCount > 0) score += 10;

    return Math.round((score / maxScore) * 100);
  }

  private async calculateReputationScore(userId: string): Promise<number> {
    const reputationEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: { startsWith: 'reputation.' },
      },
      select: { properties: true },
    });

    return reputationEvents.reduce((total, event) => {
      return total + (event.properties?.points || 0);
    }, 0);
  }

  private getTopSkills(skills: any): string[] {
    if (!skills) return [];

    const skillScores = [
      { name: 'Specificity', score: skills.specificity },
      { name: 'Constraints', score: skills.constraints },
      { name: 'Structure', score: skills.structure },
      { name: 'Role Definition', score: skills.roleDefinition },
      { name: 'Output Format', score: skills.outputFormat },
      { name: 'Verification', score: skills.verification },
      { name: 'Safety', score: skills.safety },
    ];

    return skillScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(skill => skill.name);
  }

  private async getRecentActivity(userId: string, limit: number): Promise<any[]> {
    const recentEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: {
          in: [
            'prompt.created',
            'template.created',
            'challenge.completed',
            'lesson.completed',
            'badge.earned',
          ],
        },
      },
      // ISSUE: Property 'timestamp' does not exist on AnalyticsEvent model
      // FIX: Use 'createdAt' field instead of 'timestamp'
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    // ISSUE: Property 'timestamp' does not exist on AnalyticsEvent model
    // FIX: Use 'createdAt' field instead of 'timestamp'
    return recentEvents.map(event => ({
      type: event.event.split('.')[1],
      timestamp: event.timestamp,
      details: event.properties,
    }));
  }

  private parseTimeframe(timeframe: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate: Date;

    if (timeframe.endsWith('d')) {
      const days = parseInt(timeframe.replace('d', ''));
      startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    } else if (timeframe.endsWith('w')) {
      const weeks = parseInt(timeframe.replace('w', ''));
      startDate = new Date(endDate.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe.endsWith('m')) {
      const months = parseInt(timeframe.replace('m', ''));
      startDate = new Date(endDate.getTime() - months * 30 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  private buildUserSortOptions(sortBy: string): any {
    switch (sortBy) {
      case 'points':
        return { profile: { totalPoints: 'desc' } };
      case 'level':
        return { profile: { level: 'desc' } };
      case 'reputation':
        return { profile: { totalPoints: 'desc' } }; // Proxy for reputation
      case 'recent':
        return { createdAt: 'desc' };
      case 'name':
        return { username: 'asc' };
      default: // relevance
        return [{ profile: { totalPoints: 'desc' } }, { createdAt: 'desc' }];
    }
  }

  private async logSecurityEvent(userId: string, event: string, metadata: any): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId,
          sessionId: 'security-event',
          event: `security.${event}`,
          properties: metadata,
        },
      });
    } catch (error) {
      this.logger.error('Failed to log security event', { event, userId, error });
    }
  }

  // Statistics helper methods - these would have full implementations
  private async getPromptStatistics(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const [created, improved, executed, shared] = await Promise.all([
      this.prisma.prompt.count({
        where: { userId, createdAt: { gte: startDate, lte: endDate } },
      }),
      // ISSUE: Property 'timestamp' does not exist on AnalyticsEvent model
      // FIX: Use 'createdAt' field instead of 'timestamp' in all analytics queries
      this.prisma.analyticsEvent.count({
        where: {
          userId,
          event: 'prompt.improved',
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          userId,
          event: 'prompt.executed',
          timestamp: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.prompt.count({
        where: {
          userId,
          isPublic: true,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    return { created, improved, executed, shared };
  }

  private async getTemplateStatistics(userId: string, startDate: Date, endDate: Date): Promise<any> {
    const templates = await this.prisma.template.findMany({
      where: {
        userId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    return {
      created: templates.length,
      used: templates.reduce((sum, t) => sum + t.usageCount, 0),
      shared: templates.filter(t => t.isPublic).length,
      avgRating: templates.reduce((sum, t) => sum + t.rating, 0) / (templates.length || 1),
    };
  }

  private async getChallengeStatistics(userId: string, startDate: Date, endDate: Date): Promise<any> {
    // ISSUE: Models 'challengeParticipant' and 'challengeSubmission' do not exist in Prisma schema
    // FIX: Create ChallengeParticipant and ChallengeSubmission models
    const [participated, completed, won] = await Promise.all([
      this.prisma.challengeParticipant.count({
        where: {
          userId,
          joinedAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.challengeSubmission.count({
        where: {
          userId,
          submittedAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.challengeSubmission.count({
        where: {
          userId,
          submittedAt: { gte: startDate, lte: endDate },
          rank: { lte: 3 },
        },
      }),
    ]);

    return { participated, completed, won };
  }

  private async getLearningStatistics(userId: string, startDate: Date, endDate: Date): Promise<any> {
    // ISSUE: Models 'userLearningPath' and 'lessonProgress' do not exist in Prisma schema
    // FIX: Create UserLearningPath and LessonProgress models for learning system
    const [enrolled, completed, lessons] = await Promise.all([
      this.prisma.userLearningPath.count({
        where: {
          userId,
          enrolledAt: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.userLearningPath.count({
        where: {
          userId,
          status: 'completed',
          completedAt: { gte: startDate, lte: endDate },
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

    return { pathsEnrolled: enrolled, pathsCompleted: completed, lessonsCompleted: lessons };
  }

  private async getCommunityStatistics(userId: string, startDate: Date, endDate: Date): Promise<any> {
    // ISSUE: Models 'comment', 'like', and 'follow' do not exist in Prisma schema
    // FIX: Create Comment, Like, and Follow models for community features
    const [comments, likes, follows] = await Promise.all([
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
      this.prisma.follow.count({
        where: {
          followerId: userId,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    return { comments, likes, follows };
  }

  private async getSkillStatistics(userId: string, startDate: Date, endDate: Date): Promise<any> {
    // ISSUE: Model 'skillAssessment' does not exist in Prisma schema
    // FIX: Create SkillAssessment model or use UserSkills for assessment tracking
    const assessments = await this.prisma.skillAssessment.findMany({
      where: {
        userId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const avgScore = assessments.reduce((sum, a) => sum + a.overallScore, 0) / (assessments.length || 1);

    return {
      assessmentsTaken: assessments.length,
      averageScore: avgScore,
      improvements: assessments.filter(a => a.overallScore > 70).length,
    };
  }

  // Activity helper methods would be implemented similarly
  private async getPromptActivity(userId: string, startDate: Date): Promise<any> {
    return {
      created: await this.prisma.prompt.count({
        where: { userId, createdAt: { gte: startDate } },
      }),
      improved: await this.prisma.analyticsEvent.count({
        where: {
          userId,
          event: 'prompt.improved',
          timestamp: { gte: startDate },
        },
      }),
      executed: await this.prisma.analyticsEvent.count({
        where: {
          userId,
          event: 'prompt.executed',
          timestamp: { gte: startDate },
        },
      }),
    };
  }

  private async getTemplateActivity(userId: string, startDate: Date): Promise<any> {
    return {
      created: await this.prisma.template.count({
        where: { userId, createdAt: { gte: startDate } },
      }),
      used: await this.prisma.analyticsEvent.count({
        where: {
          userId,
          event: 'template.used',
          timestamp: { gte: startDate },
        },
      }),
    };
  }

  private async getChallengeActivity(userId: string, startDate: Date): Promise<any> {
    return {
      joined: await this.prisma.challengeParticipant.count({
        where: { userId, joinedAt: { gte: startDate } },
      }),
      submitted: await this.prisma.challengeSubmission.count({
        where: { userId, submittedAt: { gte: startDate } },
      }),
    };
  }

  private async getLearningActivity(userId: string, startDate: Date): Promise<any> {
    return {
      lessonsCompleted: await this.prisma.lessonProgress.count({
        where: {
          userId,
          status: 'completed',
          completedAt: { gte: startDate },
        },
      }),
      pathsEnrolled: await this.prisma.userLearningPath.count({
        where: { userId, enrolledAt: { gte: startDate } },
      }),
    };
  }

  private async getCommunityActivity(userId: string, startDate: Date): Promise<any> {
    return {
      comments: await this.prisma.comment.count({
        where: { userId, createdAt: { gte: startDate } },
      }),
      likes: await this.prisma.like.count({
        where: { userId, createdAt: { gte: startDate } },
      }),
    };
  }

  private async getDailyActivityBreakdown(userId: string, startDate: Date): Promise<any> {
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        timestamp: { gte: startDate },
        event: {
          in: [
            'prompt.created',
            'template.created',
            'lesson.completed',
            'challenge.submitted',
            'comment.created',
          ],
        },
      },
      select: {
        event: true,
        timestamp: true,
      },
    });

    // ISSUE: Property 'timestamp' does not exist on AnalyticsEvent model
    // FIX: Use 'createdAt' field instead of 'timestamp'
    const dailyBreakdown = {};
    events.forEach(event => {
      const date = event.timestamp.toISOString().split('T')[0];
      if (!dailyBreakdown[date]) {
        dailyBreakdown[date] = {
          prompts: 0,
          templates: 0,
          lessons: 0,
          challenges: 0,
          comments: 0,
        };
      }

      if (event.event.includes('prompt')) dailyBreakdown[date].prompts++;
      else if (event.event.includes('template')) dailyBreakdown[date].templates++;
      else if (event.event.includes('lesson')) dailyBreakdown[date].lessons++;
      else if (event.event.includes('challenge')) dailyBreakdown[date].challenges++;
      else if (event.event.includes('comment')) dailyBreakdown[date].comments++;
    });

    return Object.entries(dailyBreakdown).map(([date, activities]) => ({
      date,
      ...activities,
    }));
  }
}