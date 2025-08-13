import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { PromptImprovementEngine } from '@prompt-platform/prompt-engine';
import { LLMClientService } from '../integrations/llm-client.service';
import { SearchService } from '../search/search.service';
import {
  CreatePromptDto,
  UpdatePromptDto,
  ImprovePromptDto,
  ExecutePromptDto,
  ForkPromptDto,
  VersionPromptDto,
  PromptSearchDto,
} from './dto';
import {
  PromptWithMetadata,
  PromptImprovementResult,
  PromptExecutionResult,
  PromptAnalytics,
  PromptRecommendation,
  PromptVersion,
} from './interfaces';

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private promptEngine: PromptImprovementEngine,
    private llmClient: LLMClientService,
    private searchService: SearchService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createPrompt(userId: string, createPromptDto: CreatePromptDto): Promise<PromptWithMetadata> {
    const {
      title,
      originalPrompt,
      category,
      tags,
      isPublic = false,
      model = 'gpt-4',
      temperature = 0.7,
      maxTokens = 2000,
    } = createPromptDto;

    // Analyze prompt for initial metrics
    const analysis = await this.promptEngine.analyzePrompt({
      rawUserPrompt: originalPrompt,
      userId,
      model,
    });

    const prompt = await this.prisma.prompt.create({
      data: {
        userId,
        title,
        originalPrompt,
        category,
        tags: tags || [],
        isPublic,
        model,
        temperature,
        maxTokens,
        language: 'en',
        improvementScore: analysis.overallScore,
        tokenCount: this.estimateTokenCount(originalPrompt),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        likes: { where: { userId } },
        comments: {
          include: {
            user: {
              select: { username: true, avatar: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            forks: true,
          },
        },
      },
    });

    // Index for search
    await this.searchService.indexPrompt(prompt);

    // Award points for first prompt
    const userPromptCount = await this.prisma.prompt.count({
      where: { userId },
    });

    if (userPromptCount === 1) {
      await this.gamificationService.awardPoints(userId, 'first_prompt');
    }

    await this.gamificationService.awardPoints(userId, 'prompt_created', {
      promptId: prompt.id,
      category,
      improvementScore: analysis.overallScore,
    });

    // Emit prompt created event
    this.eventEmitter.emit('prompt.created', {
      promptId: prompt.id,
      userId,
      title,
      category,
      isPublic,
    });

    this.logger.log(`Prompt created: ${prompt.id} by user ${userId}`);

    return this.enrichPromptWithMetadata(prompt);
  }

  async improvePrompt(userId: string, promptId: string, improveDto: ImprovePromptDto): Promise<PromptImprovementResult> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    if (prompt.userId !== userId && !prompt.isPublic) {
      throw new ForbiddenException('Cannot improve private prompt');
    }

    const { targetModel, additionalContext, improvementGoals } = improveDto;

    // Run improvement engine
    const improvementResult = await this.promptEngine.improvePrompt({
      rawUserPrompt: prompt.originalPrompt,
      userId,
      model: targetModel || prompt.model,
      domainKnowledge: additionalContext,
      improvementGoals,
    });

    // Update prompt with improved version
    const updatedPrompt = await this.prisma.prompt.update({
      where: { id: promptId },
      data: {
        improvedPrompt: improvementResult.improvedPrompt,
        improvementScore: improvementResult.metrics.overallScore,
      },
    });

    // Award points for improvement
    await this.gamificationService.awardPoints(userId, 'prompt_improved', {
      promptId,
      improvementScore: improvementResult.metrics.overallScore,
      previousScore: prompt.improvementScore,
    });

    // Track improvement analytics
    await this.trackAnalyticsEvent(userId, 'prompt.improved', {
      promptId,
      improvementScore: improvementResult.metrics.overallScore,
      improvement: improvementResult.metrics.overallScore - (prompt.improvementScore || 0),
    });

    // Emit improvement event
    this.eventEmitter.emit('prompt.improved', {
      promptId,
      userId,
      improvementResult,
    });

    this.logger.log(`Prompt ${promptId} improved by user ${userId}, score: ${improvementResult.metrics.overallScore}`);

    return {
      promptId,
      originalPrompt: prompt.originalPrompt,
      improvedPrompt: improvementResult.improvedPrompt,
      improvementScore: improvementResult.metrics.overallScore,
      previousScore: prompt.improvementScore,
      metrics: improvementResult.metrics,
      suggestions: improvementResult.suggestions,
      explanation: improvementResult.explanation,
    };
  }

  async executePrompt(userId: string, promptId: string, executeDto: ExecutePromptDto): Promise<PromptExecutionResult> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    if (prompt.userId !== userId && !prompt.isPublic) {
      throw new ForbiddenException('Cannot execute private prompt');
    }

    const { model, temperature, maxTokens, variables } = executeDto;
    const promptText = prompt.improvedPrompt || prompt.originalPrompt;

    // Replace variables in prompt
    let finalPrompt = promptText;
    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        finalPrompt = finalPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      });
    }

    const startTime = Date.now();

    try {
      // Execute with LLM
      const llmResult = await this.llmClient.complete({
        prompt: finalPrompt,
        model: model || prompt.model,
        temperature: temperature ?? prompt.temperature,
        maxTokens: maxTokens ?? prompt.maxTokens,
      });

      const executionTime = Date.now() - startTime;

      // Update prompt with execution stats
      await this.prisma.prompt.update({
        where: { id: promptId },
        data: {
          output: llmResult.content,
          executionTime,
          tokenCount: llmResult.tokensUsed,
          cost: llmResult.cost,
        },
      });

      // Award points for execution
      await this.gamificationService.awardPoints(userId, 'prompt_executed', {
        promptId,
        model: llmResult.model,
        executionTime,
        tokensUsed: llmResult.tokensUsed,
      });

      // Track execution analytics
      await this.trackAnalyticsEvent(userId, 'prompt.executed', {
        promptId,
        model: llmResult.model,
        executionTime,
        tokensUsed: llmResult.tokensUsed,
        cost: llmResult.cost,
      });

      // Emit execution event
      this.eventEmitter.emit('prompt.executed', {
        promptId,
        userId,
        model: llmResult.model,
        executionTime,
        tokensUsed: llmResult.tokensUsed,
      });

      this.logger.log(`Prompt ${promptId} executed by user ${userId} in ${executionTime}ms`);

      return {
        promptId,
        output: llmResult.content,
        model: llmResult.model,
        executionTime,
        tokensUsed: llmResult.tokensUsed,
        cost: llmResult.cost,
        metadata: {
          finishReason: llmResult.finishReason,
          safety: llmResult.safety,
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      this.logger.error(`Prompt execution failed: ${promptId}`, error);

      // Track failed execution
      await this.trackAnalyticsEvent(userId, 'prompt.execution_failed', {
        promptId,
        model: model || prompt.model,
        executionTime,
        error: error.message,
      });

      throw new BadRequestException(`Prompt execution failed: ${error.message}`);
    }
  }

  async forkPrompt(userId: string, promptId: string, forkDto: ForkPromptDto): Promise<PromptWithMetadata> {
    const originalPrompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
      include: { user: true },
    });

    if (!originalPrompt) {
      throw new NotFoundException('Prompt not found');
    }

    if (!originalPrompt.isPublic && originalPrompt.userId !== userId) {
      throw new ForbiddenException('Cannot fork private prompt');
    }

    const { title, modifications, keepPublic } = forkDto;

    // Apply modifications to the original prompt
    let modifiedPrompt = originalPrompt.improvedPrompt || originalPrompt.originalPrompt;
    if (modifications) {
      modifiedPrompt = this.applyPromptModifications(modifiedPrompt, modifications);
    }

    const forkedPrompt = await this.prisma.prompt.create({
      data: {
        userId,
        title: title || `${originalPrompt.title} (Fork)`,
        originalPrompt: modifiedPrompt,
        category: originalPrompt.category,
        tags: originalPrompt.tags,
        isPublic: keepPublic !== false,
        model: originalPrompt.model,
        temperature: originalPrompt.temperature,
        maxTokens: originalPrompt.maxTokens,
        forkedFromId: promptId,
        language: originalPrompt.language,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        forkedFrom: {
          include: {
            user: {
              select: { username: true },
            },
          },
        },
        likes: { where: { userId } },
        comments: {
          include: {
            user: {
              select: { username: true, avatar: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            forks: true,
          },
        },
      },
    });

    // Award points to forker and original author
    await this.gamificationService.awardPoints(userId, 'prompt_forked', {
      promptId: forkedPrompt.id,
      originalPromptId: promptId,
      originalAuthor: originalPrompt.user.username,
    });

    await this.gamificationService.awardPoints(originalPrompt.userId, 'prompt_shared', {
      promptId,
      forkedBy: userId,
      forkId: forkedPrompt.id,
    });

    // Index forked prompt
    await this.searchService.indexPrompt(forkedPrompt);

    // Create notification for original author
    if (originalPrompt.userId !== userId) {
      await this.createNotification(originalPrompt.userId, {
        type: 'prompt_forked',
        title: 'Prompt Forked',
        message: `Your prompt "${originalPrompt.title}" was forked`,
        data: {
          promptId,
          forkId: forkedPrompt.id,
          forkedBy: userId,
        },
      });
    }

    // Emit fork event
    this.eventEmitter.emit('prompt.forked', {
      originalPromptId: promptId,
      forkedPromptId: forkedPrompt.id,
      userId,
      originalUserId: originalPrompt.userId,
    });

    this.logger.log(`Prompt ${promptId} forked by user ${userId} as ${forkedPrompt.id}`);

    return this.enrichPromptWithMetadata(forkedPrompt);
  }

  async createVersion(userId: string, promptId: string, versionDto: VersionPromptDto): Promise<PromptVersion> {
    const originalPrompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
    });

    if (!originalPrompt) {
      throw new NotFoundException('Prompt not found');
    }

    if (originalPrompt.userId !== userId) {
      throw new ForbiddenException('Can only version your own prompts');
    }

    const { content, changelog } = versionDto;

    // Create new version
    const newVersion = await this.prisma.prompt.create({
      data: {
        userId,
        title: originalPrompt.title,
        originalPrompt: content,
        category: originalPrompt.category,
        tags: originalPrompt.tags,
        isPublic: originalPrompt.isPublic,
        model: originalPrompt.model,
        temperature: originalPrompt.temperature,
        maxTokens: originalPrompt.maxTokens,
        version: originalPrompt.version + 1,
        parentVersionId: promptId,
        language: originalPrompt.language,
      },
    });

    this.logger.log(`Created version ${newVersion.version} of prompt ${promptId}`);

    return {
      id: newVersion.id,
      version: newVersion.version,
      content,
      changelog,
      createdAt: newVersion.createdAt,
      parentId: promptId,
    };
  }

  async getPrompt(promptId: string, userId?: string): Promise<PromptWithMetadata> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        forkedFrom: {
          include: {
            user: {
              select: { username: true },
            },
          },
        },
        forks: {
          include: {
            user: {
              select: { username: true, avatar: true },
            },
          },
          take: 5,
        },
        likes: userId ? { where: { userId } } : false,
        comments: {
          include: {
            user: {
              select: { username: true, avatar: true },
            },
            replies: {
              include: {
                user: {
                  select: { username: true, avatar: true },
                },
              },
              take: 3,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            forks: true,
          },
        },
      },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    // Check access permissions
    if (!prompt.isPublic && (!userId || prompt.userId !== userId)) {
      throw new ForbiddenException('Prompt is private');
    }

    // Increment view count (async)
    this.incrementViewCount(promptId).catch(error => {
      this.logger.warn(`Failed to increment view count for prompt ${promptId}`, error);
    });

    return this.enrichPromptWithMetadata(prompt);
  }

  async searchPrompts(searchDto: PromptSearchDto, userId?: string): Promise<{
    prompts: PromptWithMetadata[];
    total: number;
    facets: any;
  }> {
    const {
      query,
      category,
      tags,
      userId: authorId,
      model,
      minScore,
      maxScore,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = searchDto;

    const skip = (page - 1) * limit;

    // Build search filters
    const where: any = {
      AND: [
        // Access control
        userId ? 
          { OR: [{ isPublic: true }, { userId }] } : 
          { isPublic: true },

        // Text search
        query ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { originalPrompt: { contains: query, mode: 'insensitive' } },
            { improvedPrompt: { contains: query, mode: 'insensitive' } },
            { tags: { has: query } },
          ],
        } : {},

        // Filters
        category ? { category } : {},
        tags?.length ? { tags: { hasSome: tags } } : {},
        authorId ? { userId: authorId } : {},
        model ? { model } : {},
        minScore ? { improvementScore: { gte: minScore } } : {},
        maxScore ? { improvementScore: { lte: maxScore } } : {},
      ].filter(Boolean),
    };

    // Build sort options
    const orderBy = this.buildSortOptions(sortBy);

    const [prompts, total] = await Promise.all([
      this.prisma.prompt.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
              forks: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.prompt.count({ where }),
    ]);

    // Get facets for filtering
    const facets = await this.getSearchFacets(where);

    const enrichedPrompts = prompts.map(prompt => this.enrichPromptWithMetadata(prompt));

    return {
      prompts: enrichedPrompts,
      total,
      facets,
    };
  }

  async getPromptAnalytics(promptId: string, userId: string): Promise<PromptAnalytics> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    if (prompt.userId !== userId) {
      throw new ForbiddenException('Can only view analytics for your own prompts');
    }

    const [
      engagementStats,
      performanceStats,
      forkStats,
      timeSeriesData,
    ] = await Promise.all([
      this.getEngagementStats(promptId),
      this.getPerformanceStats(promptId),
      this.getForkStats(promptId),
      this.getTimeSeriesData(promptId),
    ]);

    return {
      promptId,
      engagement: engagementStats,
      performance: performanceStats,
      forks: forkStats,
      timeSeries: timeSeriesData,
    };
  }

  async getRecommendations(userId: string, limit = 10): Promise<PromptRecommendation[]> {
    // Get user's interaction history
    const userInteractions = await this.getUserInteractionHistory(userId);
    
    // Get user's skill profile
    const userSkills = await this.prisma.userSkills.findUnique({
      where: { userId },
    });

    // Find similar users
    const similarUsers = await this.findSimilarUsers(userId, userInteractions);

    // Get recommended prompts based on collaborative filtering
    const recommendations = await this.prisma.prompt.findMany({
      where: {
        isPublic: true,
        userId: { 
          in: similarUsers.map(u => u.userId),
          not: userId,
        },
        // Recommend prompts that match user's skill level
        improvementScore: userSkills ? {
          gte: Math.max(0, userSkills.overallScore - 20),
          lte: userSkills.overallScore + 30,
        } : undefined,
      },
      include: {
        user: {
          select: { username: true, avatar: true },
        },
        _count: {
          select: { likes: true, forks: true },
        },
      },
      orderBy: [
        { views: 'desc' },
        { likes: { _count: 'desc' } },
      ],
      take: limit,
    });

    return recommendations.map(prompt => ({
      prompt: this.enrichPromptWithMetadata(prompt),
      reason: 'Popular among similar users',
      score: this.calculateRecommendationScore(prompt, userInteractions),
    }));
  }

  async deletePrompt(userId: string, promptId: string): Promise<void> {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id: promptId },
      include: {
        forks: true,
        childVersions: true,
      },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    if (prompt.userId !== userId) {
      throw new ForbiddenException('Can only delete your own prompts');
    }

    // Check if prompt has forks or versions
    if (prompt.forks.length > 0) {
      throw new BadRequestException('Cannot delete prompt that has been forked');
    }

    if (prompt.childVersions.length > 0) {
      throw new BadRequestException('Cannot delete prompt that has versions');
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete related data
      await tx.like.deleteMany({ where: { promptId } });
      await tx.comment.deleteMany({ where: { promptId } });
      
      // Delete the prompt
      await tx.prompt.delete({ where: { id: promptId } });
    });

    // Remove from search index
    await this.searchService.removeFromIndex('prompt', promptId);

    this.logger.log(`Prompt ${promptId} deleted by user ${userId}`);
  }

  // Private helper methods

  private enrichPromptWithMetadata(prompt: any): PromptWithMetadata {
    return {
      ...prompt,
      isLikedByUser: prompt.likes?.length > 0,
      likeCount: prompt._count?.likes || 0,
      commentCount: prompt._count?.comments || 0,
      forkCount: prompt._count?.forks || 0,
      authorName: `${prompt.user.firstName || ''} ${prompt.user.lastName || ''}`.trim() || prompt.user.username,
      readingTime: this.calculateReadingTime(prompt.originalPrompt),
      difficulty: this.calculateDifficulty(prompt.improvementScore),
      effectiveness: this.calculateEffectiveness(prompt),
    };
  }

  private buildSortOptions(sortBy: string): any {
    switch (sortBy) {
      case 'recent':
        return { createdAt: 'desc' };
      case 'popular':
        return [{ likes: { _count: 'desc' } }, { views: 'desc' }];
      case 'score':
        return { improvementScore: 'desc' };
      case 'forks':
        return { forks: { _count: 'desc' } };
      case 'updated':
        return { updatedAt: 'desc' };
      default: // relevance
        return [{ views: 'desc' }, { likes: { _count: 'desc' } }];
    }
  }

  private async getSearchFacets(baseWhere: any): Promise<any> {
    const [categories, models, tags] = await Promise.all([
      this.prisma.prompt.groupBy({
        by: ['category'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.prompt.groupBy({
        by: ['model'],
        where: baseWhere,
        _count: { id: true },
      }),
      this.prisma.prompt.findMany({
        where: baseWhere,
        select: { tags: true },
        take: 1000,
      }),
    ]);

    // Process tags
    const tagCounts = {};
    tags.forEach(prompt => {
      if (Array.isArray(prompt.tags)) {
        prompt.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    return {
      categories: categories.map(c => ({ name: c.category, count: c._count.id })),
      models: models.map(m => ({ name: m.model, count: m._count.id })),
      tags: topTags,
    };
  }

  private applyPromptModifications(originalPrompt: string, modifications: any): string {
    let modifiedPrompt = originalPrompt;

    if (modifications.replacements) {
      modifications.replacements.forEach(({ find, replace }) => {
        modifiedPrompt = modifiedPrompt.replace(new RegExp(find, 'g'), replace);
      });
    }

    if (modifications.additions) {
      modifications.additions.forEach(({ position, content }) => {
        if (position === 'beginning') {
          modifiedPrompt = content + '\n\n' + modifiedPrompt;
        } else if (position === 'end') {
          modifiedPrompt = modifiedPrompt + '\n\n' + content;
        }
      });
    }

    return modifiedPrompt;
  }

  private calculateReadingTime(text: string): number {
    const wordsPerMinute = 200;
    const wordCount = text.split(/\s+/).length;
    return Math.ceil(wordCount / wordsPerMinute);
  }

  private calculateDifficulty(improvementScore?: number): string {
    if (!improvementScore) return 'Unknown';
    if (improvementScore >= 80) return 'Advanced';
    if (improvementScore >= 60) return 'Intermediate';
    return 'Beginner';
  }

  private calculateEffectiveness(prompt: any): number {
    // Calculate effectiveness based on engagement and performance metrics
    const viewWeight = 0.2;
    const likeWeight = 0.3;
    const forkWeight = 0.4;
    const scoreWeight = 0.1;

    const views = prompt.views || 0;
    const likes = prompt._count?.likes || 0;
    const forks = prompt._count?.forks || 0;
    const score = prompt.improvementScore || 0;

    return Math.round(
      (views * viewWeight) + 
      (likes * likeWeight * 10) + 
      (forks * forkWeight * 20) + 
      (score * scoreWeight)
    );
  }

  private estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private async incrementViewCount(promptId: string): Promise<void> {
    try {
      await this.prisma.prompt.update({
        where: { id: promptId },
        data: { views: { increment: 1 } },
      });
    } catch (error) {
      // Ignore errors for view count updates
    }
  }

  private async trackAnalyticsEvent(userId: string, event: string, properties: any): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId,
          sessionId: 'prompt-service',
          event,
          properties,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to track analytics event', { event, error });
    }
  }

  private async createNotification(userId: string, notification: any): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data || {},
        },
      });
    } catch (error) {
      this.logger.warn('Failed to create notification', { userId, error });
    }
  }

  private async getEngagementStats(promptId: string): Promise<any> {
    const [likes, comments, forks, views] = await Promise.all([
      this.prisma.like.count({ where: { promptId } }),
      this.prisma.comment.count({ where: { promptId } }),
      this.prisma.prompt.count({ where: { forkedFromId: promptId } }),
      this.prisma.prompt.findUnique({ where: { id: promptId }, select: { views: true } }),
    ]);

    return {
      likes,
      comments,
      forks,
      views: views?.views || 0,
      engagementRate: this.calculateEngagementRate(likes, comments, forks, views?.views || 0),
    };
  }

  private async getPerformanceStats(promptId: string): Promise<any> {
    const executions = await this.prisma.analyticsEvent.findMany({
      where: {
        event: 'prompt.executed',
        properties: {
          path: ['promptId'],
          equals: promptId,
        },
      },
    });

    const avgExecutionTime = executions.reduce((sum, exec) => {
      return sum + (exec.properties?.executionTime || 0);
    }, 0) / (executions.length || 1);

    const avgTokens = executions.reduce((sum, exec) => {
      return sum + (exec.properties?.tokensUsed || 0);
    }, 0) / (executions.length || 1);

    const totalCost = executions.reduce((sum, exec) => {
      return sum + (exec.properties?.cost || 0);
    }, 0);

    return {
      totalExecutions: executions.length,
      avgExecutionTime,
      avgTokensUsed: avgTokens,
      totalCost,
      successRate: this.calculateSuccessRate(promptId),
    };
  }

  private async getForkStats(promptId: string): Promise<any> {
    const forks = await this.prisma.prompt.findMany({
      where: { forkedFromId: promptId },
      include: {
        user: { select: { username: true } },
        _count: { select: { likes: true } },
      },
    });

    return {
      totalForks: forks.length,
      forks: forks.map(fork => ({
        id: fork.id,
        title: fork.title,
        author: fork.user.username,
        likes: fork._count.likes,
        createdAt: fork.createdAt,
      })),
    };
  }

  private async getTimeSeriesData(promptId: string): Promise<any> {
    // Get time series data for views, likes, etc.
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        properties: {
          path: ['promptId'],
          equals: promptId,
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    const timeSeriesData = {};
    events.forEach(event => {
      const date = event.timestamp.toISOString().split('T')[0];
      if (!timeSeriesData[date]) {
        timeSeriesData[date] = { views: 0, executions: 0, improvements: 0 };
      }
      
      if (event.event.includes('view')) timeSeriesData[date].views++;
      if (event.event.includes('executed')) timeSeriesData[date].executions++;
      if (event.event.includes('improved')) timeSeriesData[date].improvements++;
    });

    return Object.entries(timeSeriesData).map(([date, metrics]) => ({
      date,
      ...metrics,
    }));
  }

  private calculateEngagementRate(likes: number, comments: number, forks: number, views: number): number {
    if (views === 0) return 0;
    const totalEngagements = likes + comments + forks;
    return (totalEngagements / views) * 100;
  }

  private async calculateSuccessRate(promptId: string): Promise<number> {
    const [successful, failed] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: {
          event: 'prompt.executed',
          properties: { path: ['promptId'], equals: promptId },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          event: 'prompt.execution_failed',
          properties: { path: ['promptId'], equals: promptId },
        },
      }),
    ]);

    const total = successful + failed;
    return total > 0 ? (successful / total) * 100 : 100;
  }

  private async getUserInteractionHistory(userId: string): Promise<any> {
    const interactions = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: { in: ['prompt.viewed', 'prompt.liked', 'prompt.forked', 'prompt.executed'] },
      },
      take: 100,
      orderBy: { timestamp: 'desc' },
    });

    return interactions;
  }

  private async findSimilarUsers(userId: string, userInteractions: any[]): Promise<any[]> {
    // Simple collaborative filtering based on shared prompt interactions
    const interactedPromptIds = userInteractions.map(i => i.properties?.promptId).filter(Boolean);
    
    if (interactedPromptIds.length === 0) return [];

    const similarUsers = await this.prisma.analyticsEvent.findMany({
      where: {
        userId: { not: userId },
        event: { in: ['prompt.viewed', 'prompt.liked', 'prompt.forked'] },
        properties: {
          path: ['promptId'],
          in: interactedPromptIds,
        },
      },
      select: { userId: true },
      distinct: ['userId'],
      take: 20,
    });

    return similarUsers;
  }

  private calculateRecommendationScore(prompt: any, userInteractions: any[]): number {
    let score = 0;

    // Base popularity score
    score += Math.min((prompt._count?.likes || 0) * 5, 50);
    score += Math.min((prompt._count?.forks || 0) * 10, 30);
    score += Math.min((prompt.views || 0) * 0.1, 20);

    // Category/tag matching with user history
    const userCategories = userInteractions
      .map(i => i.properties?.category)
      .filter(Boolean);
    
    if (userCategories.includes(prompt.category)) {
      score += 25;
    }

    return Math.round(score);
  }
}