import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ElasticsearchService } from '@nestjs/elasticsearch';

interface SearchIndex {
  id: string;
  type: 'prompt' | 'template' | 'user' | 'challenge';
  title: string;
  content: string;
  tags: string[];
  category: string;
  metadata: Record<string, any>;
  userId: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface SearchQuery {
  query?: string;
  type?: string[];
  category?: string[];
  tags?: string[];
  userId?: string;
  sortBy?: 'relevance' | 'recent' | 'popular' | 'score';
  page?: number;
  limit?: number;
  filters?: Record<string, any>;
}

interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  facets: SearchFacets;
  query: string;
  executionTime: number;
}

interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  content: string;
  excerpt: string;
  tags: string[];
  category: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  score: number;
  highlights: string[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

interface SearchFacets {
  types: Array<{ name: string; count: number }>;
  categories: Array<{ name: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
  authors: Array<{ name: string; count: number }>;
}

interface SearchSuggestion {
  text: string;
  type: 'query' | 'filter' | 'user' | 'tag';
  count: number;
}

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private readonly INDEX_NAME = 'prompts';
  private searchIndex = new Map<string, SearchIndex>();
  private invertedIndex = new Map<string, Set<string>>();

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private elasticsearch: ElasticsearchService,
  ) {}

  async onModuleInit() {
    await this.initializeElasticsearch();
  }

  async search(searchQuery: SearchQuery, userId?: string): Promise<SearchResult> {
    const startTime = Date.now();
    const {
      query,
      type = [],
      category = [],
      tags = [],
      userId: authorFilter,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
      filters = {},
    } = searchQuery;

    this.logger.log(`Search query: "${query}" by user ${userId}`);

    try {
      // ISSUE: Elasticsearch may not be configured or available in development
      // FIX: Add try-catch wrapper and fallback to in-memory search
      const response = await this.elasticsearch.search({
        index: this.INDEX_NAME,
        body: {
          query: {
            bool: {
              must: query ? [
                {
                  multi_match: {
                    query: query,
                    fields: ['title^2', 'content', 'tags']
                  }
                }
              ] : [{ match_all: {} }],
              filter: this.buildFilters({ type, category, tags, authorFilter, userId, filters })
            }
          },
          from: (page - 1) * limit,
          size: limit,
          sort: this.buildSort(sortBy),
          aggs: {
            types: {
              terms: { field: 'type' }
            },
            categories: {
              terms: { field: 'category' }
            },
            tags: {
              terms: { field: 'tags', size: 20 }
            },
            authors: {
              terms: { field: 'userId', size: 10 }
            }
          },
          highlight: query ? {
            fields: {
              title: {},
              content: {
                fragment_size: 150,
                number_of_fragments: 3
              }
            }
          } : undefined
        }
      });

      // ISSUE: Multiple 'as any' type assertions for Elasticsearch response
      // FIX: Define proper Elasticsearch response interface
      const hits = (response as any).hits?.hits || [];
      const total = (response as any).hits?.total?.value || 0;
      const aggregations = (response as any).aggregations;

      // Process search results
      const results = await this.processSearchResults(hits, query);

      // Generate facets from aggregations
      const facets = this.processFacets(aggregations);

      // Track search analytics
      await this.trackSearchAnalytics(userId, query, type, total);

      const executionTime = Date.now() - startTime;
      this.logger.log(`Elasticsearch search completed in ${executionTime}ms, ${total} results`);

      return {
        items: results,
        total,
        page,
        limit,
        facets,
        query: query || '',
        executionTime,
      };
    } catch (error) {
      this.logger.error('Elasticsearch search failed', error);
      // Fallback to empty results
      return {
        items: [],
        total: 0,
        page,
        limit,
        facets: { types: [], categories: [], tags: [], authors: [] },
        query: query || '',
        executionTime: Date.now() - startTime,
      };
    }
  }

  async indexPrompt(prompt: any): Promise<void> {
    const document = {
      id: prompt.id,
      type: 'prompt',
      title: prompt.title || 'Untitled Prompt',
      content: `${prompt.title || ''} ${prompt.originalPrompt || ''} ${prompt.improvedPrompt || ''}`,
      tags: prompt.tags || [],
      category: prompt.category || 'general',
      metadata: {
        improvementScore: prompt.improvementScore,
        model: prompt.model,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        views: prompt.views || 0,
        likes: prompt.likes || 0,
        forks: prompt.forks || 0,
      },
      userId: prompt.userId,
      isPublic: prompt.isPublic || false,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
    };

    try {
      await this.elasticsearch.index({
        index: this.INDEX_NAME,
        id: prompt.id,
        body: document,
      });
      this.logger.debug(`Indexed prompt: ${prompt.id}`);
    } catch (error) {
      this.logger.error(`Failed to index prompt ${prompt.id}`, error);
    }
  }

  async indexTemplate(template: any): Promise<void> {
    const document = {
      id: template.id,
      type: 'template',
      title: template.title || template.name || 'Untitled Template',
      content: `${template.title || template.name || ''} ${template.description || ''} ${template.content || ''}`,
      tags: template.tags || [],
      category: template.category || 'general',
      metadata: {
        rating: template.rating || 0,
        usageCount: template.usageCount || 0,
        variables: template.variables,
        difficulty: template.difficulty || 'beginner',
      },
      userId: template.userId,
      isPublic: template.isPublic || false,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };

    try {
      await this.elasticsearch.index({
        index: this.INDEX_NAME,
        id: template.id,
        body: document,
      });
      this.logger.debug(`Indexed template: ${template.id}`);
    } catch (error) {
      this.logger.error(`Failed to index template ${template.id}`, error);
    }
  }

  async indexUser(user: any): Promise<void> {
    const profile = user.profile || {};
    const index: SearchIndex = {
      id: user.id,
      type: 'user',
      title: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      content: `${user.username} ${user.firstName || ''} ${user.lastName || ''} ${user.bio || ''}`,
      tags: [],
      category: 'user',
      metadata: {
        level: profile.level || 1,
        totalPoints: profile.totalPoints || 0,
        currentStreak: profile.currentStreak || 0,
        promptsCreated: profile.promptsCreated || 0,
        templatesCreated: profile.templatesCreated || 0,
        location: user.location,
      },
      userId: user.id,
      isPublic: user.preferences?.profileVisibility === 'public',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    await this.addToIndex(index);
    this.logger.debug(`Indexed user: ${user.id}`);
  }

  async indexChallenge(challenge: any): Promise<void> {
    const index: SearchIndex = {
      id: challenge.id,
      type: 'challenge',
      title: challenge.title,
      content: `${challenge.title} ${challenge.description} ${challenge.prompt}`,
      tags: challenge.tags || [],
      category: challenge.category,
      metadata: {
        difficulty: challenge.difficulty,
        points: challenge.points,
        participants: challenge.participants || 0,
        status: challenge.status,
        startDate: challenge.startDate,
        endDate: challenge.endDate,
      },
      userId: challenge.createdBy,
      isPublic: challenge.isPublic,
      createdAt: challenge.createdAt,
      updatedAt: challenge.updatedAt,
    };

    await this.addToIndex(index);
    this.logger.debug(`Indexed challenge: ${challenge.id}`);
  }

  async removeFromIndex(type: string, id: string): Promise<void> {
    const existingIndex = this.searchIndex.get(id);
    if (existingIndex) {
      // Remove from inverted index
      const tokens = this.tokenizeContent(existingIndex.content);
      tokens.forEach(token => {
        const tokenSet = this.invertedIndex.get(token);
        if (tokenSet) {
          tokenSet.delete(id);
          if (tokenSet.size === 0) {
            this.invertedIndex.delete(token);
          }
        }
      });

      // Remove from main index
      this.searchIndex.delete(id);
      this.logger.debug(`Removed from index: ${type}:${id}`);
    }
  }

  async getSuggestions(query: string, limit = 10): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];
    const queryLower = query.toLowerCase();

    // Query suggestions based on indexed content
    const queryTerms = this.tokenizeQuery(queryLower);
    const lastTerm = queryTerms[queryTerms.length - 1];

    if (lastTerm && lastTerm.length >= 2) {
      // Find matching terms in inverted index
      const matchingTerms = Array.from(this.invertedIndex.keys())
        .filter(term => term.startsWith(lastTerm))
        .slice(0, 5);

      matchingTerms.forEach(term => {
        const count = this.invertedIndex.get(term)?.size || 0;
        suggestions.push({
          text: queryTerms.slice(0, -1).concat([term]).join(' '),
          type: 'query',
          count,
        });
      });
    }

    // Tag suggestions
    const allTags = new Set<string>();
    this.searchIndex.forEach(item => {
      item.tags.forEach(tag => {
        if (tag.toLowerCase().includes(queryLower)) {
          allTags.add(tag);
        }
      });
    });

    Array.from(allTags).slice(0, 3).forEach(tag => {
      suggestions.push({
        text: tag,
        type: 'tag',
        count: this.countItemsWithTag(tag),
      });
    });

    // User suggestions
    const matchingUsers = Array.from(this.searchIndex.values())
      .filter(item => 
        item.type === 'user' && 
        item.title.toLowerCase().includes(queryLower)
      )
      .slice(0, 3);

    matchingUsers.forEach(user => {
      suggestions.push({
        text: user.title,
        type: 'user',
        count: 1,
      });
    });

    return suggestions
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getPopularSearches(limit = 10): Promise<Array<{ query: string; count: number }>> {
    // ISSUE: Property 'timestamp' does not exist on AnalyticsEvent model
    // FIX: Use 'createdAt' field instead of 'timestamp'
    const searches = await this.prisma.analyticsEvent.groupBy({
      by: ['properties'],
      where: {
        event: 'search.performed',
        timestamp: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    // ISSUE: Type assertion 'as any' used for properties field
    // FIX: Define proper interface for analyticsEvent.properties structure
    return searches
      .map(search => ({
        query: (search.properties as any)?.query || '',
        count: search._count.id,
      }))
      .filter(item => item.query.length > 0);
  }

  async rebuildIndex(): Promise<void> {
    this.logger.log('Rebuilding search index...');
    
    // Clear existing index
    this.searchIndex.clear();
    this.invertedIndex.clear();

    // Index all prompts
    const prompts = await this.prisma.prompt.findMany({
      where: { isPublic: true },
      include: { user: true },
    });

    for (const prompt of prompts) {
      await this.indexPrompt(prompt);
    }

    // Index all templates
    const templates = await this.prisma.template.findMany({
      where: { isPublic: true },
      include: { user: true },
    });

    for (const template of templates) {
      await this.indexTemplate(template);
    }

    // Index all public users
    const users = await this.prisma.user.findMany({
      include: {
        profile: true,
        preferences: true,
      },
    });

    for (const user of users) {
      if (user.preferences?.profileVisibility === 'public') {
        await this.indexUser(user);
      }
    }

    // Index all challenges
    // ISSUE: Model 'challenge' does not exist in Prisma schema
    // FIX: Create Challenge model or comment out until implemented
    const challenges = await this.prisma.challenge.findMany({
      where: { isPublic: true },
    });

    for (const challenge of challenges) {
      await this.indexChallenge(challenge);
    }

    this.logger.log(`Search index rebuilt with ${this.searchIndex.size} items`);
  }

  private async initializeElasticsearch(): Promise<void> {
    try {
      // Create Elasticsearch index with proper mappings
      await this.elasticsearch.indices.create({
        index: this.INDEX_NAME,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              type: { type: 'keyword' },
              title: { type: 'text', analyzer: 'standard' },
              content: { type: 'text', analyzer: 'standard' },
              tags: { type: 'keyword' },
              category: { type: 'keyword' },
              userId: { type: 'keyword' },
              isPublic: { type: 'boolean' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' },
              metadata: {
                type: 'object',
                properties: {
                  improvementScore: { type: 'float' },
                  rating: { type: 'float' },
                  usageCount: { type: 'long' },
                  views: { type: 'long' },
                  likes: { type: 'long' },
                  forks: { type: 'long' },
                  model: { type: 'keyword' },
                  difficulty: { type: 'keyword' }
                }
              }
            }
          }
        }
      });
      this.logger.log(`Elasticsearch index '${this.INDEX_NAME}' created successfully`);
    } catch (error) {
      if (error.meta?.body?.error?.type === 'resource_already_exists_exception') {
        this.logger.log(`Elasticsearch index '${this.INDEX_NAME}' already exists`);
      } else {
        this.logger.warn('Failed to create Elasticsearch index', error);
      }
    }

    // Initialize index with existing data
    setTimeout(() => {
      this.rebuildIndex().catch(error => {
        this.logger.error('Failed to rebuild search index', error);
      });
    }, 2000);
  }

  private buildFilters(params: any): any[] {
    const filters = [];

    // Access control filter
    if (params.userId) {
      filters.push({
        bool: {
          should: [
            { term: { isPublic: true } },
            { term: { userId: params.userId } }
          ]
        }
      });
    } else {
      filters.push({ term: { isPublic: true } });
    }

    // Type filter
    if (params.type && params.type.length > 0) {
      filters.push({ terms: { type: params.type } });
    }

    // Category filter
    if (params.category && params.category.length > 0) {
      filters.push({ terms: { category: params.category } });
    }

    // Tags filter
    if (params.tags && params.tags.length > 0) {
      filters.push({ terms: { tags: params.tags } });
    }

    // Author filter
    if (params.authorFilter) {
      filters.push({ term: { userId: params.authorFilter } });
    }

    // Custom filters
    if (params.filters) {
      if (params.filters.minScore) {
        filters.push({
          range: {
            'metadata.improvementScore': { gte: params.filters.minScore }
          }
        });
      }

      if (params.filters.maxScore) {
        filters.push({
          range: {
            'metadata.improvementScore': { lte: params.filters.maxScore }
          }
        });
      }

      if (params.filters.model) {
        filters.push({ term: { 'metadata.model': params.filters.model } });
      }
    }

    return filters;
  }

  private buildSort(sortBy: string): any[] {
    switch (sortBy) {
      case 'recent':
        return [{ createdAt: { order: 'desc' } }];
      case 'popular':
        return [
          { 'metadata.likes': { order: 'desc' } },
          { 'metadata.views': { order: 'desc' } }
        ];
      case 'score':
        return [
          { 'metadata.improvementScore': { order: 'desc' } },
          { 'metadata.rating': { order: 'desc' } }
        ];
      case 'relevance':
      default:
        return [{ _score: { order: 'desc' } }];
    }
  }

  private async processSearchResults(hits: any[], query?: string): Promise<SearchResultItem[]> {
    const userIds = [...new Set(hits.map(hit => hit._source.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, avatar: true },
    });

    const userMap = new Map(users.map(user => [user.id, user]));

    return hits.map(hit => {
      const source = hit._source;
      const highlights = hit.highlight || {};
      
      return {
        id: source.id,
        type: source.type,
        title: source.title,
        content: source.content,
        excerpt: this.generateExcerptFromHighlight(highlights, source.content, query),
        tags: source.tags || [],
        category: source.category,
        author: userMap.get(source.userId) || {
          id: source.userId,
          username: 'Unknown',
        },
        score: hit._score || 0,
        highlights: this.extractHighlights(highlights),
        metadata: source.metadata || {},
        createdAt: new Date(source.createdAt),
        updatedAt: new Date(source.updatedAt),
      };
    });
  }

  private processFacets(aggregations: any): SearchFacets {
    return {
      types: aggregations?.types?.buckets?.map(bucket => ({
        name: bucket.key,
        count: bucket.doc_count
      })) || [],
      categories: aggregations?.categories?.buckets?.map(bucket => ({
        name: bucket.key,
        count: bucket.doc_count
      })) || [],
      tags: aggregations?.tags?.buckets?.map(bucket => ({
        name: bucket.key,
        count: bucket.doc_count
      })) || [],
      authors: aggregations?.authors?.buckets?.map(bucket => ({
        name: bucket.key,
        count: bucket.doc_count
      })) || [],
    };
  }

  private extractHighlights(highlights: any): string[] {
    const extracted = [];
    
    if (highlights.title) {
      extracted.push(...highlights.title);
    }
    
    if (highlights.content) {
      extracted.push(...highlights.content);
    }
    
    return extracted.slice(0, 3);
  }

  private generateExcerptFromHighlight(highlights: any, content: string, query?: string): string {
    if (highlights.content && highlights.content.length > 0) {
      return highlights.content[0];
    }
    
    if (!query) {
      return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }

    const queryLower = query.toLowerCase();
    const index = content.toLowerCase().indexOf(queryLower);
    
    if (index === -1) {
      return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }

    const start = Math.max(0, index - 100);
    const end = Math.min(content.length, index + 100);
    
    return (start > 0 ? '...' : '') + 
           content.substring(start, end) + 
           (end < content.length ? '...' : '');
  }

  private async addToIndex(index: SearchIndex): Promise<void> {
    // Remove existing entry if it exists
    if (this.searchIndex.has(index.id)) {
      await this.removeFromIndex(index.type, index.id);
    }

    // Add to main index
    this.searchIndex.set(index.id, index);

    // Add to inverted index
    const tokens = this.tokenizeContent(index.content);
    tokens.forEach(token => {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(index.id);
    });

    // Index tags separately
    index.tags.forEach(tag => {
      const tagToken = tag.toLowerCase();
      if (!this.invertedIndex.has(tagToken)) {
        this.invertedIndex.set(tagToken, new Set());
      }
      this.invertedIndex.get(tagToken)!.add(index.id);
    });
  }

  private tokenizeQuery(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 0)
      .map(token => token.replace(/[^\w]/g, ''));
  }

  private tokenizeContent(content: string): string[] {
    return content
      .toLowerCase()
      .split(/[\s\-_.,;:!?()[\]{}]+/)
      .filter(token => token.length >= 2)
      .map(token => token.replace(/[^\w]/g, ''))
      .filter(token => token.length >= 2);
  }

  private performTextSearch(queryTerms: string[]): Set<string> {
    if (queryTerms.length === 0) {
      return new Set();
    }

    // Find documents that contain all query terms (AND search)
    let matchingIds = this.invertedIndex.get(queryTerms[0]) || new Set();

    for (let i = 1; i < queryTerms.length; i++) {
      const termMatches = this.invertedIndex.get(queryTerms[i]) || new Set();
      matchingIds = new Set([...matchingIds].filter(id => termMatches.has(id)));
    }

    // Also include partial matches (OR search) with lower weight
    queryTerms.forEach(term => {
      const partialMatches = Array.from(this.invertedIndex.keys())
        .filter(indexTerm => indexTerm.includes(term))
        .flatMap(indexTerm => Array.from(this.invertedIndex.get(indexTerm) || []));
      
      partialMatches.forEach(id => matchingIds.add(id));
    });

    return matchingIds;
  }

  private calculateRelevanceScore(
    item: SearchIndex,
    query?: string,
    searchQuery?: SearchQuery,
  ): number {
    let score = 0;

    if (!query) {
      // Base popularity score when no query
      score = (item.metadata.views || 0) * 0.1 + 
              (item.metadata.likes || 0) * 2 + 
              (item.metadata.forks || 0) * 3;
    } else {
      const queryTerms = this.tokenizeQuery(query.toLowerCase());
      const titleTokens = this.tokenizeContent(item.title);
      const contentTokens = this.tokenizeContent(item.content);

      // Title match score (higher weight)
      const titleMatches = queryTerms.filter(term => 
        titleTokens.some(token => token.includes(term))
      ).length;
      score += titleMatches * 20;

      // Content match score
      const contentMatches = queryTerms.filter(term =>
        contentTokens.some(token => token.includes(term))
      ).length;
      score += contentMatches * 5;

      // Exact title match bonus
      if (item.title.toLowerCase().includes(query.toLowerCase())) {
        score += 50;
      }

      // Tag match bonus
      const tagMatches = queryTerms.filter(term =>
        item.tags.some(tag => tag.toLowerCase().includes(term))
      ).length;
      score += tagMatches * 15;
    }

    // Type-specific scoring
    switch (item.type) {
      case 'prompt':
        score += (item.metadata.improvementScore || 0) * 0.5;
        score += (item.metadata.likes || 0) * 2;
        score += (item.metadata.forks || 0) * 3;
        break;
      case 'template':
        score += (item.metadata.rating || 0) * 10;
        score += (item.metadata.usageCount || 0) * 0.1;
        break;
      case 'user':
        score += (item.metadata.totalPoints || 0) * 0.01;
        score += (item.metadata.level || 1) * 5;
        break;
      case 'challenge':
        score += (item.metadata.participants || 0) * 2;
        score += (item.metadata.points || 0) * 0.1;
        break;
    }

    // Recency bonus (newer items get slight boost)
    const daysSinceCreation = (Date.now() - item.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 10 - daysSinceCreation * 0.1);
    score += recencyBonus;

    return Math.round(Math.max(0, score));
  }

  private sortResults(results: any[], sortBy: string): any[] {
    switch (sortBy) {
      case 'recent':
        return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      case 'popular':
        return results.sort((a, b) => {
          const aPopularity = (a.metadata.likes || 0) + (a.metadata.views || 0) * 0.1;
          const bPopularity = (b.metadata.likes || 0) + (b.metadata.views || 0) * 0.1;
          return bPopularity - aPopularity;
        });
      case 'score':
        return results.sort((a, b) => {
          const aScore = a.metadata.improvementScore || a.metadata.rating || 0;
          const bScore = b.metadata.improvementScore || b.metadata.rating || 0;
          return bScore - aScore;
        });
      case 'relevance':
      default:
        return results.sort((a, b) => b.score - a.score);
    }
  }

  private generateHighlights(item: SearchIndex, query: string): string[] {
    const highlights: string[] = [];
    const queryTerms = this.tokenizeQuery(query.toLowerCase());
    
    queryTerms.forEach(term => {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      
      // Check title
      const titleMatch = item.title.match(regex);
      if (titleMatch) {
        highlights.push(`<mark>${titleMatch[0]}</mark>`);
      }
      
      // Check content (first occurrence)
      const contentMatch = item.content.match(regex);
      if (contentMatch) {
        const index = item.content.toLowerCase().indexOf(term);
        const start = Math.max(0, index - 50);
        const end = Math.min(item.content.length, index + 50);
        const excerpt = item.content.substring(start, end);
        const highlightedExcerpt = excerpt.replace(regex, `<mark>$&</mark>`);
        highlights.push(highlightedExcerpt);
      }
    });

    return highlights.slice(0, 3); // Limit to 3 highlights
  }

  private generateExcerpt(content: string, query?: string): string {
    if (!query) {
      return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }

    const queryTerms = this.tokenizeQuery(query.toLowerCase());
    const firstTermIndex = content.toLowerCase().indexOf(queryTerms[0]);
    
    if (firstTermIndex === -1) {
      return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }

    const start = Math.max(0, firstTermIndex - 100);
    const end = Math.min(content.length, firstTermIndex + 100);
    
    return (start > 0 ? '...' : '') + 
           content.substring(start, end) + 
           (end < content.length ? '...' : '');
  }

  private async enrichWithUserData(results: any[]): Promise<SearchResultItem[]> {
    const userIds = [...new Set(results.map(item => item.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, avatar: true },
    });

    const userMap = new Map(users.map(user => [user.id, user]));

    return results.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      content: item.content,
      excerpt: item.excerpt,
      tags: item.tags,
      category: item.category,
      author: userMap.get(item.userId) || {
        id: item.userId,
        username: 'Unknown',
      },
      score: item.score,
      highlights: item.highlights,
      metadata: item.metadata,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  private generateFacets(results: any[]): SearchFacets {
    const types = new Map<string, number>();
    const categories = new Map<string, number>();
    const tags = new Map<string, number>();
    const authors = new Map<string, number>();

    results.forEach(item => {
      // Types
      types.set(item.type, (types.get(item.type) || 0) + 1);
      
      // Categories
      categories.set(item.category, (categories.get(item.category) || 0) + 1);
      
      // Tags
      item.tags.forEach(tag => {
        tags.set(tag, (tags.get(tag) || 0) + 1);
      });
      
      // Authors (would need to be enriched with user data)
      authors.set(item.userId, (authors.get(item.userId) || 0) + 1);
    });

    return {
      types: Array.from(types.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      categories: Array.from(categories.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      tags: Array.from(tags.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      authors: Array.from(authors.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  private countItemsWithTag(tag: string): number {
    let count = 0;
    this.searchIndex.forEach(item => {
      if (item.tags.some(itemTag => 
        itemTag.toLowerCase() === tag.toLowerCase()
      )) {
        count++;
      }
    });
    return count;
  }

  private async trackSearchAnalytics(
    userId?: string,
    query?: string,
    types?: string[],
    resultCount?: number,
  ): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId,
          sessionId: 'search-service',
          event: 'search.performed',
          properties: {
            query,
            types,
            resultCount,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      this.logger.warn('Failed to track search analytics', error);
    }
  }

  async updateTemplateIndex(template: any): Promise<void> {
    const searchIndex: SearchIndex = {
      id: template.id,
      type: 'template',
      title: template.title || template.name,
      content: template.content,
      tags: template.tags || [],
      category: template.category,
      userId: template.userId,
      isPublic: template.isPublic,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      metadata: {
        rating: template.rating || 0,
        usageCount: template.uses || 0,
        views: template.views || 0,
        likes: template.likes || 0,
        variables: template.variables || [],
        difficulty: template.difficulty || 'beginner',
      },
    };

    await this.addToIndex(searchIndex);

    // Also update Elasticsearch if available
    try {
      await this.elasticsearch.index({
        index: this.INDEX_NAME,
        id: template.id,
        body: searchIndex,
      });
    } catch (error) {
      this.logger.warn('Failed to update Elasticsearch index for template', error);
    }
  }

  private async indexTemplate(template: any): Promise<void> {
    await this.updateTemplateIndex(template);
  }

  private async indexPrompt(prompt: any): Promise<void> {
    const searchIndex: SearchIndex = {
      id: prompt.id,
      type: 'prompt',
      title: prompt.title,
      content: prompt.content,
      tags: prompt.tags || [],
      category: prompt.category,
      userId: prompt.userId,
      isPublic: prompt.isPublic,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
      metadata: {
        improvementScore: prompt.improvementScore || 0,
        likes: prompt.likes || 0,
        views: prompt.views || 0,
        forks: prompt.forks || 0,
        rating: prompt.rating || 0,
      },
    };

    await this.addToIndex(searchIndex);

    try {
      await this.elasticsearch.index({
        index: this.INDEX_NAME,
        id: prompt.id,
        body: searchIndex,
      });
    } catch (error) {
      this.logger.warn('Failed to update Elasticsearch index for prompt', error);
    }
  }

  private async indexUser(user: any): Promise<void> {
    const searchIndex: SearchIndex = {
      id: user.id,
      type: 'user',
      title: user.username,
      content: `${user.username} ${user.profile?.bio || ''}`,
      tags: [],
      category: 'user',
      userId: user.id,
      isPublic: user.preferences?.profileVisibility === 'public',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      metadata: {
        totalPoints: user.profile?.totalPoints || 0,
        level: user.profile?.level || 1,
        reputation: user.profile?.reputation || 0,
      },
    };

    await this.addToIndex(searchIndex);

    try {
      await this.elasticsearch.index({
        index: this.INDEX_NAME,
        id: user.id,
        body: searchIndex,
      });
    } catch (error) {
      this.logger.warn('Failed to update Elasticsearch index for user', error);
    }
  }

  private async indexChallenge(challenge: any): Promise<void> {
    const searchIndex: SearchIndex = {
      id: challenge.id,
      type: 'challenge',
      title: challenge.title,
      content: challenge.description,
      tags: challenge.tags || [],
      category: challenge.category,
      userId: challenge.createdBy,
      isPublic: challenge.isPublic,
      createdAt: challenge.createdAt,
      updatedAt: challenge.updatedAt,
      metadata: {
        difficulty: challenge.difficulty,
        points: challenge.points || 0,
        participants: challenge.participants || 0,
      },
    };

    await this.addToIndex(searchIndex);

    try {
      await this.elasticsearch.index({
        index: this.INDEX_NAME,
        id: challenge.id,
        body: searchIndex,
      });
    } catch (error) {
      this.logger.warn('Failed to update Elasticsearch index for challenge', error);
    }
  }

  private async removeFromIndex(type: string, id: string): Promise<void> {
    this.searchIndex.delete(id);
    
    // Remove from inverted index
    this.invertedIndex.forEach((ids, token) => {
      ids.delete(id);
      if (ids.size === 0) {
        this.invertedIndex.delete(token);
      }
    });

    // Remove from Elasticsearch
    try {
      await this.elasticsearch.delete({
        index: this.INDEX_NAME,
        id,
      });
    } catch (error) {
      this.logger.warn('Failed to remove from Elasticsearch index', error);
    }
  }
}