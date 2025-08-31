import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class BadgeService {
  constructor(private prisma: PrismaService) {}

  async awardBadge(userId: string, badgeType: string) {
    // Check if badge exists
    const badge = await this.prisma.badge.findUnique({
      where: { slug: badgeType }
    });

    if (!badge) {
      throw new Error(`Badge type '${badgeType}' not found`);
    }

    // Check if user already has this badge
    const existingBadge = await this.prisma.userBadge.findUnique({
      where: {
        userId_badgeId: {
          userId,
          badgeId: badge.id
        }
      }
    });

    if (existingBadge) {
      return { success: false, reason: 'Badge already awarded', badgeType };
    }

    // Award the badge
    await this.prisma.userBadge.create({
      data: {
        userId,
        badgeId: badge.id,
        context: { awardedAt: new Date() }
      }
    });

    return { success: true, badgeType, badgeName: badge.name };
  }

  async getUserBadges(userId: string) {
    const userBadges = await this.prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: {
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            color: true,
            rarity: true
          }
        }
      },
      orderBy: { earnedAt: 'desc' }
    });

    return userBadges.map(ub => ({
      id: ub.badge.id,
      name: ub.badge.name,
      description: ub.badge.description,
      icon: ub.badge.icon,
      color: ub.badge.color,
      rarity: ub.badge.rarity,
      earnedAt: ub.earnedAt,
      context: ub.context
    }));
  }

  async checkBadgeEligibility(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        prompts: { select: { id: true } },
        templates: { select: { id: true } }
      }
    });

    if (!user) {
      return [];
    }

    const eligibleBadges = [];
    const profile = user.profile;

    // Check various badge criteria
    if (user.prompts.length >= 10) {
      eligibleBadges.push('prompt-creator');
    }
    if (user.prompts.length >= 100) {
      eligibleBadges.push('prompt-master');
    }
    if (user.templates.length >= 5) {
      eligibleBadges.push('template-author');
    }
    if (profile?.totalPoints && profile.totalPoints >= 1000) {
      eligibleBadges.push('point-collector');
    }
    if (profile?.currentStreak && profile.currentStreak >= 7) {
      eligibleBadges.push('streak-warrior');
    }

    return eligibleBadges;
  }
}