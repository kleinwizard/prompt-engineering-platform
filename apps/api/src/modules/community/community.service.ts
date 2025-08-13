import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { SearchService } from '../search/search.service';
import {
  CreateCommentDto,
  UpdateCommentDto,
  FollowUserDto,
  ReportContentDto,
  CommunitySearchDto,
  CreatePostDto,
} from './dto';
import {
  CommunityFeed,
  UserProfile,
  UserFollowing,
  CommentWithReplies,
  CommunityStats,
  ReputationScore,
  ContentRecommendation,
  TrendingContent,
} from './interfaces';

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);

  private readonly reputationActions = {
    prompt_liked: 5,
    template_liked: 5,
    comment_liked: 3,
    helpful_comment: 10,
    content_shared: 8,
    followed: 5,
    prompt_featured: 25,
    template_featured: 30,
    challenge_won: 50,
    mentor_badge: 100,
  };

  private readonly moderationThresholds = {
    auto_hide: 3, // Reports needed to auto-hide content
    manual_review: 5, // Reports that trigger manual review
    account_restriction: 10, // Reports that can restrict an account
  };

  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private searchService: SearchService,
    private eventEmitter: EventEmitter2,
  ) {}

  async getCommunityFeed(userId: string, filters?: {
    type?: 'following' | 'popular' | 'recent' | 'recommended';
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<CommunityFeed> {
    const {
      type = 'recommended',
      category,
      limit = 20,
      offset = 0,
    } = filters || {};

    let feedItems = [];

    switch (type) {
      case 'following':
        feedItems = await this.getFollowingFeed(userId, category, limit, offset);
        break;
      case 'popular':
        feedItems = await this.getPopularFeed(userId, category, limit, offset);
        break;
      case 'recent':
        feedItems = await this.getRecentFeed(userId, category, limit, offset);
        break;
      default:
        feedItems = await this.getRecommendedFeed(userId, category, limit, offset);
    }

    // Get community stats
    const stats = await this.getCommunityStats();

    return {
      items: feedItems,
      hasMore: feedItems.length === limit,
      nextOffset: offset + limit,
      stats,
      trendingTopics: await this.getTrendingTopics(),
    };
  }

  async getUserProfile(userId: string, viewerId?: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        preferences: true,
        skills: true,
        badges: {
          include: { badge: true },
          orderBy: { earnedAt: 'desc' },
          take: 10,
        },
        followers: viewerId ? { where: { followerId: viewerId } } : false,
        following: { include: { following: { select: { username: true, avatar: true } } } },
        _count: {
          select: {
            followers: true,
            following: true,
            prompts: true,
            templates: true,
            comments: true,
            likes: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check privacy settings
    if (user.preferences?.profileVisibility === 'private' && viewerId !== userId) {
      throw new ForbiddenException('Profile is private');
    }

    if (user.preferences?.profileVisibility === 'followers' && viewerId !== userId) {
      const isFollowing = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: viewerId, followingId: userId },
        },
      });

      if (!isFollowing) {
        throw new ForbiddenException('Profile is only visible to followers');
      }
    }

    // Get user's reputation score
    const reputation = await this.calculateReputationScore(userId);

    // Get recent activity
    const recentActivity = await this.getUserRecentActivity(userId, 10);

    // Get user's achievements
    const achievements = await this.prisma.achievement.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      take: 5,
    });

    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      bio: user.bio,
      website: user.website,
      location: user.location,
      joinedAt: user.createdAt,
      lastActive: user.lastActive,
      isFollowing: viewerId ? user.followers.length > 0 : false,
      stats: {
        followers: user._count.followers,
        following: user._count.following,
        prompts: user._count.prompts,
        templates: user._count.templates,
        comments: user._count.comments,
        likes: user._count.likes,
        level: user.profile?.level || 1,
        totalPoints: user.profile?.totalPoints || 0,
        currentStreak: user.profile?.currentStreak || 0,
        reputation,
      },
      skills: {
        overall: user.skills?.overallScore || 0,
        breakdown: {
          specificity: user.skills?.specificity || 0,
          constraints: user.skills?.constraints || 0,
          structure: user.skills?.structure || 0,
          roleDefinition: user.skills?.roleDefinition || 0,
          outputFormat: user.skills?.outputFormat || 0,
          verification: user.skills?.verification || 0,
          safety: user.skills?.safety || 0,
        },
      },
      badges: user.badges.map(ub => ({
        id: ub.badge.id,
        name: ub.badge.name,
        description: ub.badge.description,
        icon: ub.badge.icon,
        rarity: ub.badge.rarity,
        earnedAt: ub.earnedAt,
      })),
      recentActivity,
      achievements,
    };
  }

  async followUser(followerId: string, followingId: string): Promise<void> {
    if (followerId === followingId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    // Check if user exists
    const userToFollow = await this.prisma.user.findUnique({
      where: { id: followingId },
    });

    if (!userToFollow) {
      throw new NotFoundException('User not found');
    }

    // Check if already following
    const existingFollow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    if (existingFollow) {
      throw new BadRequestException('Already following this user');
    }

    await this.prisma.$transaction(async (tx) => {
      // Create follow relationship
      await tx.follow.create({
        data: { followerId, followingId },
      });

      // Award points to both users
      await this.gamificationService.awardPoints(followerId, 'user_followed', {
        followedUserId: followingId,
        followedUsername: userToFollow.username,
      });

      // Award reputation to followed user
      await this.updateReputationScore(followingId, 'followed', 5);
    });

    // Create notification for followed user
    await this.createNotification(followingId, {
      type: 'follow',
      title: 'New Follower',
      message: `${userToFollow.username} started following you`,
      data: { followerId, followerUsername: userToFollow.username },
    });

    // Emit follow event
    this.eventEmitter.emit('user.followed', {
      followerId,
      followingId,
      followerUsername: userToFollow.username,
    });

    this.logger.log(`User ${followerId} followed user ${followingId}`);
  }

  async unfollowUser(followerId: string, followingId: string): Promise<void> {
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    if (!follow) {
      throw new BadRequestException('Not following this user');
    }

    await this.prisma.follow.delete({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    // Emit unfollow event
    this.eventEmitter.emit('user.unfollowed', {
      followerId,
      followingId,
    });

    this.logger.log(`User ${followerId} unfollowed user ${followingId}`);
  }

  async getUserFollowing(userId: string, type: 'followers' | 'following'): Promise<UserFollowing[]> {
    const relationships = await this.prisma.follow.findMany({
      where: type === 'followers' 
        ? { followingId: userId }
        : { followerId: userId },
      include: {
        follower: type === 'followers' ? {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            bio: true,
            profile: { select: { level: true, totalPoints: true } },
          },
        } : false,
        following: type === 'following' ? {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            bio: true,
            profile: { select: { level: true, totalPoints: true } },
          },
        } : false,
      },
      orderBy: { createdAt: 'desc' },
    });

    return relationships.map(rel => {
      const user = type === 'followers' ? rel.follower : rel.following;
      return {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
        avatar: user.avatar,
        bio: user.bio,
        level: user.profile?.level || 1,
        totalPoints: user.profile?.totalPoints || 0,
        followedAt: rel.createdAt,
        isFollowingBack: type === 'followers' 
          ? await this.isFollowing(userId, user.id)
          : await this.isFollowing(user.id, userId),
      };
    });
  }

  async createComment(userId: string, commentDto: CreateCommentDto): Promise<CommentWithReplies> {
    const { content, promptId, templateId, parentId } = commentDto;

    // Validate content exists
    if (promptId) {
      const prompt = await this.prisma.prompt.findUnique({ where: { id: promptId } });
      if (!prompt) throw new NotFoundException('Prompt not found');
      if (!prompt.isPublic && prompt.userId !== userId) {
        throw new ForbiddenException('Cannot comment on private content');
      }
    }

    if (templateId) {
      const template = await this.prisma.template.findUnique({ where: { id: templateId } });
      if (!template) throw new NotFoundException('Template not found');
      if (!template.isPublic && template.userId !== userId) {
        throw new ForbiddenException('Cannot comment on private content');
      }
    }

    // Validate parent comment if replying
    if (parentId) {
      const parentComment = await this.prisma.comment.findUnique({
        where: { id: parentId },
      });
      if (!parentComment) throw new NotFoundException('Parent comment not found');
    }

    const comment = await this.prisma.comment.create({
      data: {
        userId,
        content,
        promptId,
        templateId,
        parentId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            profile: { select: { level: true } },
          },
        },
        likes: { where: { userId } },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true,
                profile: { select: { level: true } },
              },
            },
            likes: { where: { userId } },
            _count: { select: { likes: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 3,
        },
        _count: {
          select: { likes: true, replies: true },
        },
      },
    });

    // Award points for commenting
    await this.gamificationService.awardPoints(userId, 'comment_posted', {
      commentId: comment.id,
      contentType: promptId ? 'prompt' : 'template',
      contentId: promptId || templateId,
    });

    // Create notification for content owner
    const contentOwnerId = promptId 
      ? (await this.prisma.prompt.findUnique({ where: { id: promptId } }))?.userId
      : (await this.prisma.template.findUnique({ where: { id: templateId } }))?.userId;

    if (contentOwnerId && contentOwnerId !== userId) {
      await this.createNotification(contentOwnerId, {
        type: 'comment',
        title: 'New Comment',
        message: `${comment.user.username} commented on your ${promptId ? 'prompt' : 'template'}`,
        data: { commentId: comment.id, commenterId: userId },
      });
    }

    // Emit comment created event
    this.eventEmitter.emit('comment.created', {
      commentId: comment.id,
      userId,
      contentType: promptId ? 'prompt' : 'template',
      contentId: promptId || templateId,
    });

    this.logger.log(`Comment created by user ${userId} on ${promptId ? 'prompt' : 'template'} ${promptId || templateId}`);

    return this.formatCommentWithReplies(comment, userId);
  }

  async updateComment(userId: string, commentId: string, updateDto: UpdateCommentDto): Promise<CommentWithReplies> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('Can only edit your own comments');
    }

    const updatedComment = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        content: updateDto.content,
        isEdited: true,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            profile: { select: { level: true } },
          },
        },
        likes: { where: { userId } },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true,
                profile: { select: { level: true } },
              },
            },
            likes: { where: { userId } },
            _count: { select: { likes: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 3,
        },
        _count: {
          select: { likes: true, replies: true },
        },
      },
    });

    return this.formatCommentWithReplies(updatedComment, userId);
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { replies: true },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('Can only delete your own comments');
    }

    if (comment.replies.length > 0) {
      // Soft delete if it has replies
      await this.prisma.comment.update({
        where: { id: commentId },
        data: {
          content: '[deleted]',
          isDeleted: true,
        },
      });
    } else {
      // Hard delete if no replies
      await this.prisma.comment.delete({
        where: { id: commentId },
      });
    }

    this.logger.log(`Comment ${commentId} deleted by user ${userId}`);
  }

  async likeContent(userId: string, contentType: 'prompt' | 'template' | 'comment', contentId: string): Promise<void> {
    // Check if content exists and is accessible
    await this.validateContentAccess(userId, contentType, contentId);

    // Check if already liked
    const existingLike = await this.prisma.like.findFirst({
      where: {
        userId,
        [`${contentType}Id`]: contentId,
      },
    });

    if (existingLike) {
      throw new BadRequestException('Already liked this content');
    }

    const likeData: any = { userId };
    likeData[`${contentType}Id`] = contentId;

    await this.prisma.$transaction(async (tx) => {
      // Create like
      await tx.like.create({ data: likeData });

      // Award points to liker
      await this.gamificationService.awardPoints(userId, `${contentType}_liked`, {
        contentId,
        contentType,
      });

      // Award reputation to content owner
      const content = await this.getContentById(contentType, contentId);
      if (content && content.userId !== userId) {
        await this.updateReputationScore(content.userId, `${contentType}_liked`, this.reputationActions[`${contentType}_liked`]);
      }
    });

    // Create notification for content owner
    const content = await this.getContentById(contentType, contentId);
    if (content && content.userId !== userId) {
      await this.createNotification(content.userId, {
        type: 'like',
        title: 'Content Liked',
        message: `Someone liked your ${contentType}`,
        data: { contentType, contentId, likerId: userId },
      });
    }

    // Emit like event
    this.eventEmitter.emit('content.liked', {
      userId,
      contentType,
      contentId,
      contentOwnerId: content?.userId,
    });

    this.logger.log(`User ${userId} liked ${contentType} ${contentId}`);
  }

  async unlikeContent(userId: string, contentType: 'prompt' | 'template' | 'comment', contentId: string): Promise<void> {
    const like = await this.prisma.like.findFirst({
      where: {
        userId,
        [`${contentType}Id`]: contentId,
      },
    });

    if (!like) {
      throw new BadRequestException('Content not liked');
    }

    await this.prisma.like.delete({
      where: { id: like.id },
    });

    // Emit unlike event
    this.eventEmitter.emit('content.unliked', {
      userId,
      contentType,
      contentId,
    });

    this.logger.log(`User ${userId} unliked ${contentType} ${contentId}`);
  }

  async reportContent(userId: string, reportDto: ReportContentDto): Promise<void> {
    const { reason, description, reportedUserId, promptId, templateId, commentId } = reportDto;

    // Validate that something is being reported
    if (!reportedUserId && !promptId && !templateId && !commentId) {
      throw new BadRequestException('Must specify what to report');
    }

    // Check if already reported by this user
    const existingReport = await this.prisma.report.findFirst({
      where: {
        reporterId: userId,
        reportedUserId,
        promptId,
        templateId,
        commentId,
      },
    });

    if (existingReport) {
      throw new BadRequestException('Already reported this content');
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId: userId,
        reportedUserId,
        promptId,
        templateId,
        commentId,
        reason,
        description,
      },
    });

    // Check if content should be auto-moderated
    const reportCount = await this.prisma.report.count({
      where: {
        reportedUserId,
        promptId,
        templateId,
        commentId,
        status: 'pending',
      },
    });

    if (reportCount >= this.moderationThresholds.auto_hide) {
      await this.autoModerateContent(reportedUserId, promptId, templateId, commentId);
    }

    this.logger.log(`Content reported: ${reason} by user ${userId}`);

    // Emit report event for admin notification
    this.eventEmitter.emit('content.reported', {
      reportId: report.id,
      reporterId: userId,
      reason,
      reportCount,
    });
  }

  async searchCommunity(searchDto: CommunitySearchDto, userId?: string): Promise<any> {
    const {
      query,
      type = 'all',
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = searchDto;

    const results = {
      users: [],
      prompts: [],
      templates: [],
      comments: [],
    };

    if (type === 'all' || type === 'users') {
      results.users = await this.searchUsers(query, userId, { sortBy, page, limit: Math.min(limit, 10) });
    }

    if (type === 'all' || type === 'prompts') {
      results.prompts = await this.searchPrompts(query, userId, { sortBy, page, limit: Math.min(limit, 10) });
    }

    if (type === 'all' || type === 'templates') {
      results.templates = await this.searchTemplates(query, userId, { sortBy, page, limit: Math.min(limit, 10) });
    }

    if (type === 'all' || type === 'comments') {
      results.comments = await this.searchComments(query, userId, { sortBy, page, limit: Math.min(limit, 10) });
    }

    return results;
  }

  async getTrendingContent(): Promise<TrendingContent[]> {
    const timeframe = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    const [trendingPrompts, trendingTemplates] = await Promise.all([
      this.prisma.prompt.findMany({
        where: {
          isPublic: true,
          createdAt: { gte: timeframe },
        },
        include: {
          user: {
            select: {
              username: true,
              avatar: true,
            },
          },
          _count: {
            select: { likes: true, comments: true },
          },
        },
        orderBy: [
          { views: 'desc' },
          { likes: { _count: 'desc' } },
        ],
        take: 10,
      }),
      this.prisma.template.findMany({
        where: {
          isPublic: true,
          createdAt: { gte: timeframe },
        },
        include: {
          user: {
            select: {
              username: true,
              avatar: true,
            },
          },
          _count: {
            select: { likes: true, comments: true },
          },
        },
        orderBy: [
          { usageCount: 'desc' },
          { rating: 'desc' },
        ],
        take: 10,
      }),
    ]);

    const trending = [
      ...trendingPrompts.map(prompt => ({
        id: prompt.id,
        type: 'prompt' as const,
        title: prompt.title || 'Untitled Prompt',
        content: prompt.originalPrompt.substring(0, 200) + '...',
        author: {
          username: prompt.user.username,
          avatar: prompt.user.avatar,
        },
        stats: {
          likes: prompt._count.likes,
          comments: prompt._count.comments,
          views: prompt.views,
        },
        createdAt: prompt.createdAt,
        trendingScore: this.calculateTrendingScore(prompt._count.likes, prompt._count.comments, prompt.views, prompt.createdAt),
      })),
      ...trendingTemplates.map(template => ({
        id: template.id,
        type: 'template' as const,
        title: template.title,
        content: template.description?.substring(0, 200) + '...' || '',
        author: {
          username: template.user.username,
          avatar: template.user.avatar,
        },
        stats: {
          likes: template._count.likes,
          comments: template._count.comments,
          usage: template.usageCount,
          rating: template.rating,
        },
        createdAt: template.createdAt,
        trendingScore: this.calculateTrendingScore(template._count.likes, template._count.comments, template.usageCount, template.createdAt),
      })),
    ];

    return trending
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, 20);
  }

  async getContentRecommendations(userId: string): Promise<ContentRecommendation[]> {
    // Get user's interests from their activity
    const [userLikes, userComments, userFollows] = await Promise.all([
      this.prisma.like.findMany({
        where: { userId },
        include: {
          prompt: { select: { category: true, tags: true } },
          template: { select: { category: true, tags: true } },
        },
        take: 50,
      }),
      this.prisma.comment.findMany({
        where: { userId },
        include: {
          prompt: { select: { category: true, tags: true } },
          template: { select: { category: true, tags: true } },
        },
        take: 30,
      }),
      this.prisma.follow.findMany({
        where: { followerId: userId },
        include: {
          following: {
            select: {
              prompts: { select: { category: true, tags: true }, take: 10 },
              templates: { select: { category: true, tags: true }, take: 10 },
            },
          },
        },
      }),
    ]);

    // Extract user interests
    const interests = this.extractUserInterests(userLikes, userComments, userFollows);

    // Find recommended content
    const [recommendedPrompts, recommendedTemplates] = await Promise.all([
      this.prisma.prompt.findMany({
        where: {
          isPublic: true,
          userId: { not: userId },
          OR: [
            { category: { in: interests.categories } },
            { tags: { hasSome: interests.tags } },
          ],
        },
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: [
          { views: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 10,
      }),
      this.prisma.template.findMany({
        where: {
          isPublic: true,
          userId: { not: userId },
          OR: [
            { category: { in: interests.categories } },
            { tags: { hasSome: interests.tags } },
          ],
        },
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: [
          { rating: 'desc' },
          { usageCount: 'desc' },
        ],
        take: 10,
      }),
    ]);

    const recommendations = [
      ...recommendedPrompts.map(prompt => ({
        id: prompt.id,
        type: 'prompt' as const,
        title: prompt.title || 'Untitled Prompt',
        reason: 'Based on your interests',
        author: prompt.user,
        stats: prompt._count,
        score: this.calculateRecommendationScore(prompt, interests),
      })),
      ...recommendedTemplates.map(template => ({
        id: template.id,
        type: 'template' as const,
        title: template.title,
        reason: 'Popular in your interest areas',
        author: template.user,
        stats: template._count,
        score: this.calculateRecommendationScore(template, interests),
      })),
    ];

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }

  // Private helper methods

  private async getFollowingFeed(userId: string, category?: string, limit = 20, offset = 0): Promise<any[]> {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map(f => f.followingId);

    if (followingIds.length === 0) {
      return [];
    }

    const whereClause: any = {
      userId: { in: followingIds },
      isPublic: true,
    };

    if (category) {
      whereClause.category = category;
    }

    const [prompts, templates] = await Promise.all([
      this.prisma.prompt.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.ceil(limit / 2),
        skip: offset,
      }),
      this.prisma.template.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.ceil(limit / 2),
        skip: offset,
      }),
    ]);

    return this.combineFeedItems(prompts, templates).slice(0, limit);
  }

  private async getPopularFeed(userId: string, category?: string, limit = 20, offset = 0): Promise<any[]> {
    const timeframe = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const whereClause: any = {
      isPublic: true,
      createdAt: { gte: timeframe },
    };

    if (category) {
      whereClause.category = category;
    }

    const [prompts, templates] = await Promise.all([
      this.prisma.prompt.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: [
          { likes: { _count: 'desc' } },
          { views: 'desc' },
        ],
        take: Math.ceil(limit / 2),
        skip: offset,
      }),
      this.prisma.template.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: [
          { rating: 'desc' },
          { usageCount: 'desc' },
        ],
        take: Math.ceil(limit / 2),
        skip: offset,
      }),
    ]);

    return this.combineFeedItems(prompts, templates).slice(0, limit);
  }

  private async getRecentFeed(userId: string, category?: string, limit = 20, offset = 0): Promise<any[]> {
    const whereClause: any = { isPublic: true };

    if (category) {
      whereClause.category = category;
    }

    const [prompts, templates] = await Promise.all([
      this.prisma.prompt.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.ceil(limit / 2),
        skip: offset,
      }),
      this.prisma.template.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.ceil(limit / 2),
        skip: offset,
      }),
    ]);

    return this.combineFeedItems(prompts, templates).slice(0, limit);
  }

  private async getRecommendedFeed(userId: string, category?: string, limit = 20, offset = 0): Promise<any[]> {
    // For now, return a mix of popular and recent content
    // In a full implementation, this would use ML recommendations
    const popular = await this.getPopularFeed(userId, category, limit / 2, offset);
    const recent = await this.getRecentFeed(userId, category, limit / 2, offset);
    
    return [...popular, ...recent].slice(0, limit);
  }

  private combineFeedItems(prompts: any[], templates: any[]): any[] {
    const items = [
      ...prompts.map(prompt => ({
        id: prompt.id,
        type: 'prompt',
        title: prompt.title || 'Untitled Prompt',
        content: prompt.originalPrompt,
        author: prompt.user,
        stats: prompt._count,
        createdAt: prompt.createdAt,
        category: prompt.category,
        tags: prompt.tags,
      })),
      ...templates.map(template => ({
        id: template.id,
        type: 'template',
        title: template.title,
        content: template.description,
        author: template.user,
        stats: template._count,
        createdAt: template.createdAt,
        category: template.category,
        tags: template.tags,
      })),
    ];

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private async getCommunityStats(): Promise<CommunityStats> {
    const [userCount, promptCount, templateCount, commentCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.prompt.count({ where: { isPublic: true } }),
      this.prisma.template.count({ where: { isPublic: true } }),
      this.prisma.comment.count(),
    ]);

    return {
      totalUsers: userCount,
      totalPrompts: promptCount,
      totalTemplates: templateCount,
      totalComments: commentCount,
      activeToday: await this.getActiveUsersToday(),
    };
  }

  private async getTrendingTopics(): Promise<string[]> {
    // Get most used tags in recent content
    const recentContent = await this.prisma.prompt.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        isPublic: true,
      },
      select: { tags: true },
      take: 1000,
    });

    const tagCounts = {};
    recentContent.forEach(content => {
      if (Array.isArray(content.tags)) {
        content.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    return Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag]) => tag);
  }

  private async calculateReputationScore(userId: string): Promise<ReputationScore> {
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: { startsWith: 'reputation.' },
      },
      select: { properties: true },
    });

    const totalPoints = events.reduce((sum, event) => {
      return sum + (event.properties?.points || 0);
    }, 0);

    // Determine reputation level
    let level = 'Newcomer';
    if (totalPoints >= 1000) level = 'Expert';
    else if (totalPoints >= 500) level = 'Advanced';
    else if (totalPoints >= 100) level = 'Intermediate';
    else if (totalPoints >= 25) level = 'Beginner';

    return {
      total: totalPoints,
      level,
      breakdown: {
        content: events.filter(e => e.properties?.source === 'content').reduce((sum, e) => sum + (e.properties?.points || 0), 0),
        community: events.filter(e => e.properties?.source === 'community').reduce((sum, e) => sum + (e.properties?.points || 0), 0),
        achievements: events.filter(e => e.properties?.source === 'achievements').reduce((sum, e) => sum + (e.properties?.points || 0), 0),
      },
    };
  }

  private async getUserRecentActivity(userId: string, limit: number): Promise<any[]> {
    // Get recent activity from various sources
    const [recentPrompts, recentTemplates, recentComments] = await Promise.all([
      this.prisma.prompt.findMany({
        where: { userId, isPublic: true },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.template.findMany({
        where: { userId, isPublic: true },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.comment.findMany({
        where: { userId },
        select: { id: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const activities = [
      ...recentPrompts.map(p => ({ type: 'prompt', ...p })),
      ...recentTemplates.map(t => ({ type: 'template', ...t })),
      ...recentComments.map(c => ({ type: 'comment', ...c })),
    ];

    return activities
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  private async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    return !!follow;
  }

  private formatCommentWithReplies(comment: any, userId?: string): CommentWithReplies {
    return {
      id: comment.id,
      content: comment.content,
      author: {
        id: comment.user.id,
        username: comment.user.username,
        displayName: `${comment.user.firstName || ''} ${comment.user.lastName || ''}`.trim() || comment.user.username,
        avatar: comment.user.avatar,
        level: comment.user.profile?.level || 1,
      },
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      isEdited: comment.isEdited,
      isDeleted: comment.isDeleted,
      stats: {
        likes: comment._count.likes,
        replies: comment._count.replies,
      },
      isLikedByUser: userId ? comment.likes.length > 0 : false,
      replies: comment.replies?.map(reply => this.formatCommentWithReplies(reply, userId)) || [],
      hasMoreReplies: (comment._count?.replies || 0) > 3,
    };
  }

  private async validateContentAccess(userId: string, contentType: string, contentId: string): Promise<void> {
    const content = await this.getContentById(contentType, contentId);
    
    if (!content) {
      throw new NotFoundException(`${contentType} not found`);
    }

    if (contentType !== 'comment' && !content.isPublic && content.userId !== userId) {
      throw new ForbiddenException('Cannot access private content');
    }
  }

  private async getContentById(contentType: string, contentId: string): Promise<any> {
    switch (contentType) {
      case 'prompt':
        return this.prisma.prompt.findUnique({ where: { id: contentId } });
      case 'template':
        return this.prisma.template.findUnique({ where: { id: contentId } });
      case 'comment':
        return this.prisma.comment.findUnique({ where: { id: contentId } });
      default:
        return null;
    }
  }

  private async updateReputationScore(userId: string, action: string, points: number): Promise<void> {
    await this.prisma.analyticsEvent.create({
      data: {
        userId,
        sessionId: 'reputation-update',
        event: `reputation.${action}`,
        properties: {
          points,
          action,
          source: this.getReputationSource(action),
        },
      },
    });
  }

  private getReputationSource(action: string): string {
    if (['prompt_liked', 'template_liked', 'content_shared'].includes(action)) {
      return 'content';
    }
    if (['comment_liked', 'helpful_comment', 'followed'].includes(action)) {
      return 'community';
    }
    return 'achievements';
  }

  private async createNotification(userId: string, notification: {
    type: string;
    title: string;
    message: string;
    data?: any;
  }): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data || {},
      },
    });
  }

  private async autoModerateContent(userId?: string, promptId?: string, templateId?: string, commentId?: string): Promise<void> {
    // Auto-hide content that has been reported multiple times
    if (promptId) {
      await this.prisma.prompt.update({
        where: { id: promptId },
        data: { isPublic: false }, // Hide from public view
      });
    } else if (templateId) {
      await this.prisma.template.update({
        where: { id: templateId },
        data: { isPublic: false },
      });
    } else if (commentId) {
      await this.prisma.comment.update({
        where: { id: commentId },
        data: { isDeleted: true },
      });
    }

    this.logger.warn(`Auto-moderated content: user=${userId}, prompt=${promptId}, template=${templateId}, comment=${commentId}`);
  }

  private async searchUsers(query: string, userId?: string, options?: any): Promise<any[]> {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { bio: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        profile: { select: { level: true, totalPoints: true } },
      },
      take: options?.limit || 10,
    });
  }

  private async searchPrompts(query: string, userId?: string, options?: any): Promise<any[]> {
    return this.prisma.prompt.findMany({
      where: {
        isPublic: true,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { originalPrompt: { contains: query, mode: 'insensitive' } },
          { tags: { has: query } },
        ],
      },
      include: {
        user: { select: { username: true, avatar: true } },
        _count: { select: { likes: true, comments: true } },
      },
      take: options?.limit || 10,
    });
  }

  private async searchTemplates(query: string, userId?: string, options?: any): Promise<any[]> {
    return this.prisma.template.findMany({
      where: {
        isPublic: true,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { has: query } },
        ],
      },
      include: {
        user: { select: { username: true, avatar: true } },
        _count: { select: { likes: true, comments: true } },
      },
      take: options?.limit || 10,
    });
  }

  private async searchComments(query: string, userId?: string, options?: any): Promise<any[]> {
    return this.prisma.comment.findMany({
      where: {
        content: { contains: query, mode: 'insensitive' },
        isDeleted: false,
      },
      include: {
        user: { select: { username: true, avatar: true } },
        _count: { select: { likes: true } },
      },
      take: options?.limit || 10,
    });
  }

  private calculateTrendingScore(likes: number, comments: number, views: number, createdAt: Date): number {
    const hoursAgo = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    const decay = Math.pow(0.9, hoursAgo / 24); // Decay over time
    
    return (likes * 3 + comments * 5 + views * 0.1) * decay;
  }

  private extractUserInterests(likes: any[], comments: any[], follows: any[]): { categories: string[], tags: string[] } {
    const categories = new Set<string>();
    const tags = new Set<string>();

    // From likes
    likes.forEach(like => {
      if (like.prompt?.category) categories.add(like.prompt.category);
      if (like.template?.category) categories.add(like.template.category);
      if (like.prompt?.tags) like.prompt.tags.forEach(tag => tags.add(tag));
      if (like.template?.tags) like.template.tags.forEach(tag => tags.add(tag));
    });

    // From comments  
    comments.forEach(comment => {
      if (comment.prompt?.category) categories.add(comment.prompt.category);
      if (comment.template?.category) categories.add(comment.template.category);
      if (comment.prompt?.tags) comment.prompt.tags.forEach(tag => tags.add(tag));
      if (comment.template?.tags) comment.template.tags.forEach(tag => tags.add(tag));
    });

    // From follows
    follows.forEach(follow => {
      follow.following.prompts.forEach(prompt => {
        if (prompt.category) categories.add(prompt.category);
        if (prompt.tags) prompt.tags.forEach(tag => tags.add(tag));
      });
      follow.following.templates.forEach(template => {
        if (template.category) categories.add(template.category);
        if (template.tags) template.tags.forEach(tag => tags.add(tag));
      });
    });

    return {
      categories: Array.from(categories),
      tags: Array.from(tags),
    };
  }

  private calculateRecommendationScore(content: any, interests: { categories: string[], tags: string[] }): number {
    let score = 0;

    // Category match
    if (interests.categories.includes(content.category)) {
      score += 30;
    }

    // Tag matches
    if (content.tags) {
      const tagMatches = content.tags.filter(tag => interests.tags.includes(tag)).length;
      score += tagMatches * 10;
    }

    // Popularity bonus
    score += Math.min(content._count.likes * 2, 20);
    score += Math.min(content._count.comments * 3, 20);

    return score;
  }

  private async getActiveUsersToday(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.user.count({
      where: {
        lastActive: { gte: today },
      },
    });
  }
}