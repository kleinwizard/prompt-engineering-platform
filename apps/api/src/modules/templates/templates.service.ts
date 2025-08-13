import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { SearchService } from '../search/search.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateSearchDto,
  TemplateVariableDto,
  TemplateVersionDto,
  RateTemplateDto,
} from './dto';
import {
  TemplateWithMetadata,
  TemplateUsageStats,
  TemplateRecommendation,
  TemplateValidation,
  TemplateCategory,
} from './interfaces';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  private readonly difficultyScoring = {
    beginner: { minVariables: 0, maxVariables: 2, complexityScore: 1 },
    intermediate: { minVariables: 3, maxVariables: 6, complexityScore: 2 },
    advanced: { minVariables: 7, maxVariables: 12, complexityScore: 3 },
  };

  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private searchService: SearchService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createTemplate(userId: string, createTemplateDto: CreateTemplateDto): Promise<TemplateWithMetadata> {
    const { title, description, content, variables, category, subcategory, tags, difficulty, isPublic } = createTemplateDto;

    // Validate template content
    const validation = await this.validateTemplate(content, variables);
    if (!validation.isValid) {
      throw new BadRequestException(`Invalid template: ${validation.errors.join(', ')}`);
    }

    // Determine difficulty if not provided
    const templateDifficulty = difficulty || this.calculateDifficulty(variables);

    const template = await this.prisma.$transaction(async (tx) => {
      // Create the template
      const newTemplate = await tx.template.create({
        data: {
          userId,
          title,
          description,
          content,
          variables: variables || [],
          category,
          subcategory,
          tags: tags || [],
          difficulty: templateDifficulty,
          isPublic: isPublic || false,
          version: 1,
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
          likes: true,
          ratings: {
            include: {
              user: {
                select: { username: true, avatar: true },
              },
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
              ratings: true,
            },
          },
        },
      });

      // Index template for search
      await this.searchService.indexTemplate(newTemplate);

      // Update user stats
      await tx.userProfile.update({
        where: { userId },
        data: {
          templatesCreated: { increment: 1 },
        },
      });

      return newTemplate;
    });

    // Award points for creating template
    await this.gamificationService.awardPoints(userId, 'template_created', {
      templateId: template.id,
      category,
      difficulty: templateDifficulty,
    });

    // Check for first template achievement
    const userTemplateCount = await this.prisma.template.count({
      where: { userId },
    });

    if (userTemplateCount === 1) {
      await this.gamificationService.awardPoints(userId, 'first_template');
    }

    // Emit template created event
    this.eventEmitter.emit('template.created', {
      userId,
      templateId: template.id,
      category,
      isPublic,
    });

    this.logger.log(`Template ${template.id} created by user ${userId}`);

    return this.enrichTemplateMetadata(template);
  }

  async updateTemplate(
    userId: string,
    templateId: string,
    updateTemplateDto: UpdateTemplateDto,
  ): Promise<TemplateWithMetadata> {
    // Check if user owns the template
    const existingTemplate = await this.prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!existingTemplate) {
      throw new NotFoundException('Template not found');
    }

    if (existingTemplate.userId !== userId) {
      throw new ForbiddenException('You can only update your own templates');
    }

    // Validate updated template if content or variables changed
    if (updateTemplateDto.content || updateTemplateDto.variables) {
      const validation = await this.validateTemplate(
        updateTemplateDto.content || existingTemplate.content,
        updateTemplateDto.variables || (existingTemplate.variables as any[]),
      );

      if (!validation.isValid) {
        throw new BadRequestException(`Invalid template update: ${validation.errors.join(', ')}`);
      }
    }

    // Create new version if major changes
    const shouldCreateVersion = this.shouldCreateNewVersion(existingTemplate, updateTemplateDto);
    
    const template = await this.prisma.$transaction(async (tx) => {
      let updatedTemplate;

      if (shouldCreateVersion) {
        // Create new version
        updatedTemplate = await tx.template.create({
          data: {
            ...existingTemplate,
            ...updateTemplateDto,
            id: undefined, // Let Prisma generate new ID
            version: existingTemplate.version + 1,
            usageCount: 0,
            rating: 0,
            ratingCount: 0,
            createdAt: new Date(),
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
            likes: true,
            ratings: {
              include: {
                user: {
                  select: { username: true, avatar: true },
                },
              },
            },
            _count: {
              select: {
                likes: true,
                comments: true,
                ratings: true,
              },
            },
          },
        });
      } else {
        // Update existing template
        updatedTemplate = await tx.template.update({
          where: { id: templateId },
          data: {
            ...updateTemplateDto,
            updatedAt: new Date(),
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
            likes: true,
            ratings: {
              include: {
                user: {
                  select: { username: true, avatar: true },
                },
              },
            },
            _count: {
              select: {
                likes: true,
                comments: true,
                ratings: true,
              },
            },
          },
        });
      }

      // Update search index
      await this.searchService.updateTemplateIndex(updatedTemplate);

      return updatedTemplate;
    });

    // Emit template updated event
    this.eventEmitter.emit('template.updated', {
      userId,
      templateId: template.id,
      isNewVersion: shouldCreateVersion,
      changes: Object.keys(updateTemplateDto),
    });

    this.logger.log(`Template ${template.id} updated by user ${userId}`);

    return this.enrichTemplateMetadata(template);
  }

  async getTemplate(templateId: string, userId?: string): Promise<TemplateWithMetadata> {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
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
        likes: userId ? { where: { userId } } : false,
        ratings: {
          include: {
            user: {
              select: { username: true, avatar: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        comments: {
          include: {
            user: {
              select: { username: true, avatar: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            ratings: true,
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check if user can access template
    if (!template.isPublic && (!userId || template.userId !== userId)) {
      throw new ForbiddenException('Template is private');
    }

    // Increment view count (async, don't wait)
    this.incrementViewCount(templateId).catch(error => {
      this.logger.warn(`Failed to increment view count for template ${templateId}`, error);
    });

    return this.enrichTemplateMetadata(template);
  }

  async searchTemplates(searchDto: TemplateSearchDto, userId?: string): Promise<{
    templates: TemplateWithMetadata[];
    total: number;
    facets: any;
  }> {
    const {
      query,
      category,
      subcategory,
      difficulty,
      tags,
      userId: authorId,
      isPublic,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = searchDto;

    const skip = (page - 1) * limit;

    // Build search filters
    const where: any = {
      AND: [
        // Public templates or user's own templates
        isPublic ? { isPublic: true } : userId ? { OR: [{ isPublic: true }, { userId }] } : { isPublic: true },
        
        // Text search
        query ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
            { tags: { has: query } },
          ],
        } : {},

        // Filters
        category ? { category } : {},
        subcategory ? { subcategory } : {},
        difficulty ? { difficulty } : {},
        authorId ? { userId: authorId } : {},
        tags?.length ? { tags: { hasSome: tags } } : {},
      ].filter(Boolean),
    };

    // Build sort options
    const orderBy = this.buildSortOptions(sortBy);

    const [templates, total] = await Promise.all([
      this.prisma.template.findMany({
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
              ratings: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.template.count({ where }),
    ]);

    // Get facets for filtering
    const facets = await this.getSearchFacets(where);

    const enrichedTemplates = await Promise.all(
      templates.map(template => this.enrichTemplateMetadata(template))
    );

    return {
      templates: enrichedTemplates,
      total,
      facets,
    };
  }

  async useTemplate(userId: string, templateId: string, variables: Record<string, any>): Promise<{
    compiledTemplate: string;
    usageId: string;
  }> {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check access permissions
    if (!template.isPublic && template.userId !== userId) {
      throw new ForbiddenException('Template is private');
    }

    // Validate required variables
    const validation = this.validateTemplateVariables(template.variables as any[], variables);
    if (!validation.isValid) {
      throw new BadRequestException(`Missing or invalid variables: ${validation.errors.join(', ')}`);
    }

    // Compile template with variables
    const compiledTemplate = this.compileTemplate(template.content, variables);

    // Track usage
    const usage = await this.prisma.$transaction(async (tx) => {
      // Increment usage count
      await tx.template.update({
        where: { id: templateId },
        data: { usageCount: { increment: 1 } },
      });

      // Create usage record (for analytics)
      const usageRecord = await tx.analyticsEvent.create({
        data: {
          userId,
          sessionId: 'template-usage',
          event: 'template.used',
          properties: {
            templateId,
            templateTitle: template.title,
            templateCategory: template.category,
            variables: Object.keys(variables),
          },
        },
      });

      return usageRecord;
    });

    // Award points for using template
    await this.gamificationService.awardPoints(userId, 'template_used', {
      templateId,
      templateTitle: template.title,
    });

    // Emit template used event
    this.eventEmitter.emit('template.used', {
      userId,
      templateId,
      variables,
      compiledLength: compiledTemplate.length,
    });

    return {
      compiledTemplate,
      usageId: usage.id,
    };
  }

  async rateTemplate(userId: string, templateId: string, rateDto: RateTemplateDto): Promise<void> {
    const { rating, review } = rateDto;

    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check access permissions
    if (!template.isPublic && template.userId !== userId) {
      throw new ForbiddenException('Template is private');
    }

    // Can't rate own template
    if (template.userId === userId) {
      throw new BadRequestException('Cannot rate your own template');
    }

    await this.prisma.$transaction(async (tx) => {
      // Upsert rating
      await tx.templateRating.upsert({
        where: {
          userId_templateId: { userId, templateId },
        },
        update: { rating, review },
        create: { userId, templateId, rating, review },
      });

      // Recalculate template rating
      const ratings = await tx.templateRating.findMany({
        where: { templateId },
        select: { rating: true },
      });

      const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

      await tx.template.update({
        where: { id: templateId },
        data: {
          rating: avgRating,
          ratingCount: ratings.length,
        },
      });
    });

    // Award points for rating
    await this.gamificationService.awardPoints(userId, 'template_rated', {
      templateId,
      rating,
    });

    this.logger.log(`User ${userId} rated template ${templateId} with ${rating} stars`);
  }

  async getTemplateRecommendations(userId: string): Promise<TemplateRecommendation[]> {
    // Get user's template usage history
    const userEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        event: 'template.used',
      },
      take: 50,
      orderBy: { timestamp: 'desc' },
    });

    // Extract user's interests from usage patterns
    const userCategories = userEvents
      .map(event => event.properties?.templateCategory)
      .filter(Boolean);

    const categoryFrequency = userCategories.reduce((acc, category) => {
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    // Get recommendations based on user's interests
    const topCategories = Object.entries(categoryFrequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([category]) => category);

    // Find popular templates in user's preferred categories
    const recommendations = await this.prisma.template.findMany({
      where: {
        isPublic: true,
        category: { in: topCategories },
        userId: { not: userId }, // Exclude user's own templates
      },
      include: {
        user: {
          select: { username: true, avatar: true },
        },
        _count: {
          select: { likes: true, ratings: true },
        },
      },
      orderBy: [
        { rating: 'desc' },
        { usageCount: 'desc' },
      ],
      take: 10,
    });

    return recommendations.map(template => ({
      template: this.enrichTemplateMetadata(template),
      reason: `Popular in ${template.category}`,
      score: this.calculateRecommendationScore(template, userCategories),
    }));
  }

  async getTemplateVersions(templateId: string): Promise<TemplateWithMetadata[]> {
    // Find all versions of this template
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Find all templates with the same base (title and userId)
    const versions = await this.prisma.template.findMany({
      where: {
        userId: template.userId,
        title: template.title,
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
        _count: {
          select: {
            likes: true,
            comments: true,
            ratings: true,
          },
        },
      },
      orderBy: { version: 'desc' },
    });

    return Promise.all(versions.map(version => this.enrichTemplateMetadata(version)));
  }

  async deleteTemplate(userId: string, templateId: string): Promise<void> {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (template.userId !== userId) {
      throw new ForbiddenException('You can only delete your own templates');
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete related data
      await tx.templateRating.deleteMany({ where: { templateId } });
      await tx.like.deleteMany({ where: { templateId } });
      await tx.comment.deleteMany({ where: { templateId } });

      // Delete template
      await tx.template.delete({ where: { id: templateId } });

      // Update user stats
      await tx.userProfile.update({
        where: { userId },
        data: {
          templatesCreated: { decrement: 1 },
        },
      });
    });

    // Remove from search index
    await this.searchService.removeTemplateFromIndex(templateId);

    this.logger.log(`Template ${templateId} deleted by user ${userId}`);
  }

  async getTemplateCategories(): Promise<TemplateCategory[]> {
    const categories = await this.prisma.template.groupBy({
      by: ['category', 'subcategory'],
      where: { isPublic: true },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // Group by category
    const categoryMap = new Map<string, TemplateCategory>();

    categories.forEach(({ category, subcategory, _count }) => {
      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          name: category,
          slug: this.generateSlug(category),
          count: 0,
          subcategories: [],
        });
      }

      const categoryData = categoryMap.get(category);
      categoryData.count += _count.id;

      if (subcategory) {
        const existingSubcat = categoryData.subcategories.find(s => s.name === subcategory);
        if (existingSubcat) {
          existingSubcat.count += _count.id;
        } else {
          categoryData.subcategories.push({
            name: subcategory,
            slug: this.generateSlug(subcategory),
            count: _count.id,
          });
        }
      }
    });

    return Array.from(categoryMap.values()).sort((a, b) => b.count - a.count);
  }

  private async validateTemplate(content: string, variables: TemplateVariableDto[]): Promise<TemplateValidation> {
    const errors = [];

    // Check if content contains variable placeholders
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const contentVariables = [];
    let match;

    while ((match = placeholderRegex.exec(content)) !== null) {
      contentVariables.push(match[1].trim());
    }

    // Check if all content variables are defined
    const definedVariables = variables.map(v => v.name);
    const missingDefinitions = contentVariables.filter(v => !definedVariables.includes(v));
    
    if (missingDefinitions.length > 0) {
      errors.push(`Undefined variables in content: ${missingDefinitions.join(', ')}`);
    }

    // Check if all defined variables are used
    const unusedVariables = definedVariables.filter(v => !contentVariables.includes(v));
    if (unusedVariables.length > 0) {
      errors.push(`Unused variable definitions: ${unusedVariables.join(', ')}`);
    }

    // Validate variable definitions
    variables.forEach(variable => {
      if (!variable.name || variable.name.trim() === '') {
        errors.push('Variable name cannot be empty');
      }
      if (!variable.type || !['text', 'number', 'select', 'multiline'].includes(variable.type)) {
        errors.push(`Invalid variable type for ${variable.name}: ${variable.type}`);
      }
      if (variable.type === 'select' && (!variable.options || variable.options.length === 0)) {
        errors.push(`Select variable ${variable.name} must have options`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  private calculateDifficulty(variables: TemplateVariableDto[]): string {
    const variableCount = variables?.length || 0;
    
    if (variableCount <= 2) return 'beginner';
    if (variableCount <= 6) return 'intermediate';
    return 'advanced';
  }

  private shouldCreateNewVersion(existingTemplate: any, updateDto: UpdateTemplateDto): boolean {
    // Create new version for major changes
    return !!(
      updateDto.content && updateDto.content !== existingTemplate.content ||
      updateDto.variables && JSON.stringify(updateDto.variables) !== JSON.stringify(existingTemplate.variables) ||
      updateDto.difficulty && updateDto.difficulty !== existingTemplate.difficulty
    );
  }

  private compileTemplate(content: string, variables: Record<string, any>): string {
    let compiled = content;

    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      compiled = compiled.replace(placeholder, String(value));
    });

    return compiled;
  }

  private validateTemplateVariables(templateVariables: TemplateVariableDto[], providedVariables: Record<string, any>): {
    isValid: boolean;
    errors: string[];
  } {
    const errors = [];

    templateVariables.forEach(variable => {
      const value = providedVariables[variable.name];

      if (variable.required && (value === undefined || value === null || value === '')) {
        errors.push(`Required variable '${variable.name}' is missing`);
        return;
      }

      if (value !== undefined && value !== null) {
        // Type validation
        switch (variable.type) {
          case 'number':
            if (isNaN(Number(value))) {
              errors.push(`Variable '${variable.name}' must be a number`);
            }
            break;
          case 'select':
            if (variable.options && !variable.options.includes(value)) {
              errors.push(`Variable '${variable.name}' must be one of: ${variable.options.join(', ')}`);
            }
            break;
        }

        // Length validation
        if (variable.maxLength && String(value).length > variable.maxLength) {
          errors.push(`Variable '${variable.name}' exceeds maximum length of ${variable.maxLength}`);
        }
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private async enrichTemplateMetadata(template: any): Promise<TemplateWithMetadata> {
    // Add computed fields
    const enriched = {
      ...template,
      isLikedByUser: template.likes && template.likes.length > 0,
      likeCount: template._count?.likes || 0,
      commentCount: template._count?.comments || 0,
      ratingCount: template._count?.ratings || 0,
      averageRating: template.rating || 0,
      authorName: `${template.user.firstName || ''} ${template.user.lastName || ''}`.trim() || template.user.username,
      variableCount: Array.isArray(template.variables) ? template.variables.length : 0,
      estimatedTime: this.estimateUsageTime(template.variables),
      complexity: this.calculateComplexity(template),
    };

    return enriched;
  }

  private buildSortOptions(sortBy: string): any {
    switch (sortBy) {
      case 'popular':
        return [{ usageCount: 'desc' }, { rating: 'desc' }];
      case 'rating':
        return [{ rating: 'desc' }, { ratingCount: 'desc' }];
      case 'recent':
        return { createdAt: 'desc' };
      case 'title':
        return { title: 'asc' };
      case 'usage':
        return { usageCount: 'desc' };
      default: // relevance
        return [{ rating: 'desc' }, { usageCount: 'desc' }];
    }
  }

  private async getSearchFacets(baseWhere: any): Promise<any> {
    const [categories, difficulties, tags] = await Promise.all([
      this.prisma.template.groupBy({
        by: ['category'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.template.groupBy({
        by: ['difficulty'],
        where: baseWhere,
        _count: { id: true },
      }),
      this.prisma.template.findMany({
        where: baseWhere,
        select: { tags: true },
      }),
    ]);

    // Process tags
    const tagCounts = {};
    tags.forEach(template => {
      if (Array.isArray(template.tags)) {
        template.tags.forEach(tag => {
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
      difficulties: difficulties.map(d => ({ name: d.difficulty, count: d._count.id })),
      tags: topTags,
    };
  }

  private calculateRecommendationScore(template: any, userCategories: string[]): number {
    let score = 0;

    // Base popularity score
    score += Math.min(template.usageCount * 0.1, 50);
    score += Math.min(template.rating * 10, 50);
    score += Math.min(template._count.likes * 2, 30);

    // Category preference bonus
    const categoryMatches = userCategories.filter(cat => cat === template.category).length;
    score += categoryMatches * 20;

    return Math.round(score);
  }

  private estimateUsageTime(variables: any[]): number {
    if (!Array.isArray(variables)) return 2;
    
    // Base time + time per variable
    const baseTime = 2; // minutes
    const timePerVariable = 1; // minute per variable
    
    return baseTime + (variables.length * timePerVariable);
  }

  private calculateComplexity(template: any): number {
    let complexity = 0;

    // Variable count contribution
    const variableCount = Array.isArray(template.variables) ? template.variables.length : 0;
    complexity += Math.min(variableCount * 10, 50);

    // Content length contribution
    const contentLength = template.content?.length || 0;
    complexity += Math.min(contentLength / 100, 30);

    // Advanced variable types
    if (Array.isArray(template.variables)) {
      template.variables.forEach(variable => {
        if (variable.type === 'select' && variable.options?.length > 5) {
          complexity += 5;
        }
        if (variable.type === 'multiline') {
          complexity += 3;
        }
      });
    }

    return Math.min(Math.round(complexity), 100);
  }

  private async incrementViewCount(templateId: string): Promise<void> {
    try {
      await this.prisma.template.update({
        where: { id: templateId },
        data: { usageCount: { increment: 1 } },
      });
    } catch (error) {
      // Ignore errors for view count updates
      this.logger.warn(`Failed to increment view count for template ${templateId}`, error);
    }
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}