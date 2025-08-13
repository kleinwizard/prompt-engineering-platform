import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { BadgeService } from './badge.service';
import { LeaderboardService } from './leaderboard.service';
import { AchievementService } from './achievement.service';
import { 
  PointAction, 
  PointsAwarded, 
  StreakUpdate, 
  LevelUpResult, 
  UserStats 
} from './interfaces';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  private readonly pointRules = {
    // Prompt actions
    prompt_created: 10,
    prompt_improved: 15,
    prompt_executed: 5,
    prompt_shared: 20,
    prompt_forked: 10,
    
    // Template actions
    template_created: 25,
    template_used: 5,
    template_rated: 5,
    
    // Community actions
    comment_posted: 5,
    comment_helpful: 10,
    prompt_liked: 2,
    user_followed: 5,
    
    // Learning actions
    lesson_completed: 15,
    quiz_passed: 20,
    skill_improved: 10,
    
    // Challenge actions
    challenge_participated: 20,
    challenge_completed: 50,
    challenge_won: 100,
    
    // Achievement milestones
    first_prompt: 50,
    first_template: 75,
    first_challenge: 100,
    email_verified: 25,
    profile_completed: 30,
  };

  private readonly levelRequirements = [
    0, 100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000, 17000,
    23000, 30000, 38000, 47000, 57000, 68000, 80000, 93000, 107000, 122000
  ];

  constructor(
    private prisma: PrismaService,
    private badgeService: BadgeService,
    private leaderboardService: LeaderboardService,
    private achievementService: AchievementService,
    private eventEmitter: EventEmitter2,
    @InjectQueue('points') private pointsQueue: Queue,
  ) {}

  async awardPoints(userId: string, action: PointAction, metadata?: any): Promise<PointsAwarded> {
    const points = this.pointRules[action] || 0;
    
    if (points === 0) {
      this.logger.warn(`No points defined for action: ${action}`);
      return { points: 0, newLevel: null, newBadges: [] };
    }

    // Add to queue for processing
    await this.pointsQueue.add('award-points', {
      userId,
      action,
      points,
      metadata,
      timestamp: new Date(),
    });

    // Process immediately for real-time response
    return this.processPointAward(userId, action, points, metadata);
  }

  private async processPointAward(
    userId: string,
    action: PointAction,
    points: number,
    metadata?: any,
  ): Promise<PointsAwarded> {
    return this.prisma.$transaction(async (tx) => {
      // Update user profile with points
      const profile = await tx.userProfile.update({
        where: { userId },
        data: {
          totalPoints: { increment: points },
          weeklyPoints: { increment: points },
          monthlyPoints: { increment: points },
          experience: { increment: points },
        },
      });

      // Check for level up
      const newLevel = this.calculateLevel(profile.totalPoints);
      let levelUpResult: LevelUpResult | null = null;

      if (newLevel > profile.level) {
        levelUpResult = await this.handleLevelUp(tx, userId, newLevel);
      }

      // Update leaderboards
      await this.leaderboardService.updateUserScore(userId, points);

      // Check for new badges
      const newBadges = await this.badgeService.checkAndAwardBadges(
        userId,
        action,
        profile,
        metadata,
      );

      // Check for achievements
      await this.achievementService.checkAchievements(userId, action, metadata);

      // Emit event for real-time updates
      this.eventEmitter.emit('points.awarded', {
        userId,
        points,
        action,
        newLevel: levelUpResult?.newLevel,
        newBadges,
        metadata,
      });

      return {
        points,
        newLevel: levelUpResult,
        newBadges,
      };
    });
  }

  async updateStreak(userId: string): Promise<StreakUpdate> {
    const today = new Date().toISOString().split('T')[0];
    
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.userProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        throw new Error('User profile not found');
      }

      const lastActivityDate = profile.lastActivityDate.toISOString().split('T')[0];
      const daysDiff = this.daysBetween(new Date(lastActivityDate), new Date(today));

      let newStreak = profile.currentStreak;
      let streakBroken = false;

      if (daysDiff === 1) {
        // Consecutive day
        newStreak += 1;
      } else if (daysDiff > 1) {
        // Streak broken
        newStreak = 1;
        streakBroken = true;
      }
      // If daysDiff === 0, same day - no change

      // Update profile
      const updatedProfile = await tx.userProfile.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          longestStreak: Math.max(profile.longestStreak, newStreak),
          lastActivityDate: new Date(),
        },
      });

      // Award streak badges
      const badges = [];
      if (newStreak === 3) badges.push('3-day-streak');
      if (newStreak === 7) badges.push('week-streak');
      if (newStreak === 30) badges.push('month-streak');
      if (newStreak === 100) badges.push('century-streak');
      if (newStreak === 365) badges.push('year-streak');

      for (const badgeSlug of badges) {
        await this.badgeService.awardBadge(userId, badgeSlug);
      }

      // Award streak milestone achievements
      if ([3, 7, 14, 30, 60, 100, 365].includes(newStreak)) {
        await this.achievementService.createAchievement(userId, {
          type: 'milestone',
          category: 'engagement',
          title: `${newStreak} Day Streak`,
          description: `Maintained a ${newStreak} day activity streak`,
          points: newStreak * 5,
          metadata: { streakDays: newStreak },
        });
      }

      return {
        streak: newStreak,
        longestStreak: updatedProfile.longestStreak,
        streakBroken,
        badgesAwarded: badges,
      };
    });
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: {
        user: {
          include: {
            badges: {
              include: { badge: true },
              orderBy: { earnedAt: 'desc' },
            },
            achievements: {
              orderBy: { completedAt: 'desc' },
              take: 10,
            },
          },
        },
      },
    });

    if (!profile) {
      throw new Error('User profile not found');
    }

    // Get leaderboard positions
    const [globalRank, weeklyRank, monthlyRank] = await Promise.all([
      this.leaderboardService.getUserRank(userId, 'global'),
      this.leaderboardService.getUserRank(userId, 'weekly'),
      this.leaderboardService.getUserRank(userId, 'monthly'),
    ]);

    return {
      profile: {
        ...profile,
        globalRank,
        weeklyRank,
        monthlyRank,
      },
      badges: profile.user.badges.map(ub => ({
        ...ub.badge,
        earnedAt: ub.earnedAt,
      })),
      recentAchievements: profile.user.achievements,
      nextLevel: {
        level: profile.level + 1,
        pointsRequired: this.levelRequirements[profile.level + 1] || 0,
        pointsProgress: profile.totalPoints - (this.levelRequirements[profile.level] || 0),
      },
    };
  }

  async getTopUsers(type: 'global' | 'weekly' | 'monthly' = 'global', limit = 10) {
    return this.leaderboardService.getTopUsers(type, limit);
  }

  async resetWeeklyPoints(): Promise<void> {
    await this.prisma.userProfile.updateMany({
      data: { weeklyPoints: 0 },
    });

    await this.leaderboardService.resetWeeklyLeaderboard();
    this.logger.log('Weekly points and leaderboard reset');
  }

  async resetMonthlyPoints(): Promise<void> {
    await this.prisma.userProfile.updateMany({
      data: { monthlyPoints: 0 },
    });

    await this.leaderboardService.resetMonthlyLeaderboard();
    this.logger.log('Monthly points and leaderboard reset');
  }

  private calculateLevel(totalPoints: number): number {
    for (let i = this.levelRequirements.length - 1; i >= 0; i--) {
      if (totalPoints >= this.levelRequirements[i]) {
        return i + 1;
      }
    }
    return 1;
  }

  private async handleLevelUp(tx: any, userId: string, newLevel: number): Promise<LevelUpResult> {
    await tx.userProfile.update({
      where: { userId },
      data: { level: newLevel },
    });

    // Award level-up achievement
    await this.achievementService.createAchievement(userId, {
      type: 'milestone',
      category: 'progression',
      title: `Level ${newLevel} Reached`,
      description: `Reached experience level ${newLevel}`,
      points: newLevel * 10,
      metadata: { level: newLevel },
    });

    // Award level-based badges
    const levelBadges = this.getLevelBadges(newLevel);
    for (const badgeSlug of levelBadges) {
      await this.badgeService.awardBadge(userId, badgeSlug);
    }

    this.logger.log(`User ${userId} leveled up to ${newLevel}`);

    return {
      newLevel,
      rewards: {
        badges: levelBadges,
        points: newLevel * 10,
      },
    };
  }

  private getLevelBadges(level: number): string[] {
    const badges = [];
    if (level === 5) badges.push('novice');
    if (level === 10) badges.push('apprentice');
    if (level === 15) badges.push('journeyman');
    if (level === 20) badges.push('expert');
    if (level === 25) badges.push('master');
    return badges;
  }

  private daysBetween(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}