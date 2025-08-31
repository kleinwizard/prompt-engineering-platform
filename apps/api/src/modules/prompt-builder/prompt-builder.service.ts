import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface PromptBlock {
  id: string;
  type: 'role' | 'context' | 'task' | 'constraints' | 'format' | 'examples' | 'custom';
  content: string;
  config: {
    variables: Record<string, string>;
    validation?: {
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
    styling?: {
      color: string;
      icon: string;
      priority: number;
    };
  };
  position: number;
  connections?: string[]; // IDs of connected blocks
}

export interface BlockTemplate {
  type: string;
  name: string;
  icon: string;
  template: string;
  variables: string[];
  color: string;
  category: string;
  description: string;
  examples: string[];
  validation?: any;
}

export interface PromptBlueprint {
  id: string;
  userId: string;
  name: string;
  description: string;
  blocks: PromptBlock[];
  metadata: {
    version: string;
    created: Date;
    lastModified: Date;
    tags: string[];
    industry?: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    estimatedTime: number;
  };
  isPublic: boolean;
  usageCount: number;
}

@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  constructor(private prisma: PrismaService) {}

  private readonly blockTemplates: Record<string, BlockTemplate> = {
    role: {
      type: 'role',
      name: 'Role Definition',
      icon: '👤',
      template: 'You are a {{ROLE}} with expertise in {{EXPERTISE}}. Your background includes {{BACKGROUND}}.',
      variables: ['ROLE', 'EXPERTISE', 'BACKGROUND'],
      color: '#3B82F6',
      category: 'foundation',
      description: 'Define the AI\'s role and expertise areas',
      examples: [
        'You are a senior software engineer with expertise in React and TypeScript.',
        'You are a medical doctor with expertise in cardiology and 10 years of clinical experience.',
        'You are a financial analyst with expertise in equity research and market analysis.'
      ],
      validation: {
        ROLE: { required: true, minLength: 3 },
        EXPERTISE: { required: true, minLength: 5 }
      }
    },
    
    context: {
      type: 'context',
      name: 'Context Setting',
      icon: '📋',
      template: 'Context: {{CONTEXT}}\nBackground Information: {{BACKGROUND}}\nCurrent Situation: {{SITUATION}}',
      variables: ['CONTEXT', 'BACKGROUND', 'SITUATION'],
      color: '#10B981',
      category: 'foundation',
      description: 'Provide essential background and context information',
      examples: [
        'Context: We are developing a new mobile app for food delivery.',
        'Context: This is a quarterly financial review for a tech startup.',
        'Context: Patient is experiencing chest pain and shortness of breath.'
      ]
    },

    task: {
      type: 'task',
      name: 'Task Definition',
      icon: '🎯',
      template: 'Your task is to {{TASK}}.\n\nThe main goal is: {{GOAL}}\n\nSuccess criteria: {{SUCCESS_CRITERIA}}',
      variables: ['TASK', 'GOAL', 'SUCCESS_CRITERIA'],
      color: '#8B5CF6',
      category: 'core',
      description: 'Define the specific task and objectives',
      examples: [
        'Your task is to analyze the user interface and provide improvement recommendations.',
        'Your task is to write a comprehensive project proposal for stakeholder review.',
        'Your task is to diagnose the patient\'s condition based on the symptoms provided.'
      ]
    },

    constraints: {
      type: 'constraints',
      name: 'Constraints & Limitations',
      icon: '⚠️',
      template: 'Please adhere to the following constraints:\n- {{CONSTRAINT_1}}\n- {{CONSTRAINT_2}}\n- {{CONSTRAINT_3}}\n\nAvoid: {{AVOID}}',
      variables: ['CONSTRAINT_1', 'CONSTRAINT_2', 'CONSTRAINT_3', 'AVOID'],
      color: '#F59E0B',
      category: 'guidelines',
      description: 'Set boundaries and limitations for the response',
      examples: [
        'Keep response under 500 words',
        'Use only peer-reviewed sources',
        'Maintain a professional tone throughout'
      ]
    },

    format: {
      type: 'format',
      name: 'Output Format',
      icon: '📝',
      template: 'Format your response as follows:\n\n{{FORMAT_STRUCTURE}}\n\nUse this style: {{STYLE}}\nInclude: {{INCLUDE_ELEMENTS}}',
      variables: ['FORMAT_STRUCTURE', 'STYLE', 'INCLUDE_ELEMENTS'],
      color: '#EC4899',
      category: 'output',
      description: 'Specify the desired output format and structure',
      examples: [
        'Format as a numbered list with brief explanations',
        'Use markdown with headers, bullet points, and code blocks',
        'Structure as Executive Summary, Analysis, and Recommendations'
      ]
    },

    examples: {
      type: 'examples',
      name: 'Examples & References',
      icon: '💡',
      template: 'Here are examples to guide your response:\n\nExample 1:\nInput: {{EXAMPLE_INPUT_1}}\nOutput: {{EXAMPLE_OUTPUT_1}}\n\nExample 2:\nInput: {{EXAMPLE_INPUT_2}}\nOutput: {{EXAMPLE_OUTPUT_2}}',
      variables: ['EXAMPLE_INPUT_1', 'EXAMPLE_OUTPUT_1', 'EXAMPLE_INPUT_2', 'EXAMPLE_OUTPUT_2'],
      color: '#F59E0B',
      category: 'guidance',
      description: 'Provide concrete examples to illustrate expected output',
      examples: [
        'Show before/after code examples',
        'Demonstrate proper analysis format',
        'Illustrate desired communication style'
      ]
    },

    custom: {
      type: 'custom',
      name: 'Custom Block',
      icon: '🛠️',
      template: '{{CUSTOM_CONTENT}}',
      variables: ['CUSTOM_CONTENT'],
      color: '#6B7280',
      category: 'advanced',
      description: 'Create custom prompt components for specific needs',
      examples: [
        'Industry-specific instructions',
        'Complex reasoning chains',
        'Multi-step processes'
      ]
    }
  };

  async getBlockTemplates(): Promise<BlockTemplate[]> {
    return Object.values(this.blockTemplates);
  }

  async createPromptBlueprint(
    userId: string,
    name: string,
    description: string,
    blocks: PromptBlock[],
    options: {
      isPublic?: boolean;
      tags?: string[];
      industry?: string;
      difficulty?: 'beginner' | 'intermediate' | 'advanced';
    } = {}
  ): Promise<PromptBlueprint> {
    // Validate blocks
    const validatedBlocks = this.validateBlocks(blocks);
    
    // Generate optimized prompt
    const generatedPrompt = this.generatePromptFromBlocks(validatedBlocks);
    
    // Calculate complexity score
    const complexity = this.calculateComplexity(validatedBlocks);
    
    // Create blueprint in database
    const blueprint = await this.prisma.promptBlueprint.create({
      data: {
        userId,
        name,
        description,
        blocks: validatedBlocks,
        generatedPrompt,
        complexity,
        isPublic: options.isPublic || false,
        tags: options.tags || [],
        industry: options.industry,
        difficulty: options.difficulty || 'intermediate',
        estimatedTime: this.estimateCompletionTime(validatedBlocks),
        usageCount: 0,
        metadata: {
          version: '1.0.0',
          created: new Date(),
          lastModified: new Date(),
          blockCount: validatedBlocks.length,
          variableCount: this.countVariables(validatedBlocks)
        }
      }
    });

    return blueprint;
  }

  async updatePromptBlueprint(
    blueprintId: string,
    userId: string,
    updates: Partial<{
      name: string;
      description: string;
      blocks: PromptBlock[];
      tags: string[];
      isPublic: boolean;
    }>
  ): Promise<PromptBlueprint> {
    // Verify ownership
    const existing = await this.prisma.promptBlueprint.findFirst({
      where: { id: blueprintId, userId }
    });

    if (!existing) {
      throw new BadRequestException('Blueprint not found or access denied');
    }

    let updatedBlocks = existing.blocks as PromptBlock[];
    let generatedPrompt = existing.generatedPrompt;

    if (updates.blocks) {
      updatedBlocks = this.validateBlocks(updates.blocks);
      generatedPrompt = this.generatePromptFromBlocks(updatedBlocks);
    }

    const updated = await this.prisma.promptBlueprint.update({
      where: { id: blueprintId },
      data: {
        ...updates,
        blocks: updatedBlocks,
        generatedPrompt,
        complexity: this.calculateComplexity(updatedBlocks),
        metadata: {
          ...existing.metadata,
          lastModified: new Date(),
          version: this.incrementVersion(existing.metadata.version),
          blockCount: updatedBlocks.length,
          variableCount: this.countVariables(updatedBlocks)
        }
      }
    });

    return updated;
  }

  async generatePromptFromBlocks(blocks: PromptBlock[]): Promise<string> {
    // Sort blocks by position
    const sortedBlocks = [...blocks].sort((a, b) => a.position - b.position);
    
    let prompt = '';
    const processedVariables = new Set<string>();

    for (const block of sortedBlocks) {
      const template = this.blockTemplates[block.type];
      if (!template) continue;

      let blockContent = template.template;
      
      // Replace variables with user-provided values
      for (const variable of template.variables) {
        const value = block.config.variables[variable];
        if (value) {
          blockContent = blockContent.replace(
            new RegExp(`{{${variable}}}`, 'g'),
            value
          );
          processedVariables.add(variable);
        }
      }

      // Add block separator and content
      if (prompt) {
        prompt += '\n\n';
      }
      
      prompt += blockContent;
    }

    // Validate all required variables are filled
    const missingVariables = this.findMissingVariables(prompt);
    if (missingVariables.length > 0) {
      this.logger.warn(`Missing variables in generated prompt: ${missingVariables.join(', ')}`);
    }

    return this.optimizePrompt(prompt);
  }

  private validateBlocks(blocks: PromptBlock[]): PromptBlock[] {
    const validated: PromptBlock[] = [];
    const usedPositions = new Set<number>();

    for (const block of blocks) {
      // Validate block type
      if (!this.blockTemplates[block.type]) {
        throw new BadRequestException(`Invalid block type: ${block.type}`);
      }

      // Ensure unique positions
      let position = block.position;
      while (usedPositions.has(position)) {
        position++;
      }
      usedPositions.add(position);

      // Validate required variables
      const template = this.blockTemplates[block.type];
      for (const variable of template.variables) {
        if (template.validation?.[variable]?.required && !block.config.variables[variable]) {
          throw new BadRequestException(`Required variable ${variable} missing in ${block.type} block`);
        }
      }

      validated.push({
        ...block,
        position,
        id: block.id || this.generateBlockId()
      });
    }

    return validated.sort((a, b) => a.position - b.position);
  }

  private generateBlockId(): string {
    return `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateComplexity(blocks: PromptBlock[]): number {
    let complexity = 0;
    
    // Base complexity per block
    complexity += blocks.length * 10;
    
    // Variable complexity
    const totalVariables = this.countVariables(blocks);
    complexity += totalVariables * 5;
    
    // Type-specific complexity
    for (const block of blocks) {
      switch (block.type) {
        case 'role':
          complexity += 5;
          break;
        case 'context':
          complexity += 10;
          break;
        case 'task':
          complexity += 15;
          break;
        case 'constraints':
          complexity += 20;
          break;
        case 'format':
          complexity += 10;
          break;
        case 'examples':
          complexity += 25;
          break;
        case 'custom':
          complexity += 30;
          break;
      }
    }

    return Math.min(100, complexity); // Cap at 100
  }

  private countVariables(blocks: PromptBlock[]): number {
    const variables = new Set<string>();
    
    for (const block of blocks) {
      const template = this.blockTemplates[block.type];
      if (template) {
        template.variables.forEach(variable => {
          if (block.config.variables[variable]) {
            variables.add(variable);
          }
        });
      }
    }
    
    return variables.size;
  }

  private estimateCompletionTime(blocks: PromptBlock[]): number {
    let minutes = 0;
    
    for (const block of blocks) {
      switch (block.type) {
        case 'role':
          minutes += 2;
          break;
        case 'context':
          minutes += 3;
          break;
        case 'task':
          minutes += 4;
          break;
        case 'constraints':
          minutes += 5;
          break;
        case 'format':
          minutes += 3;
          break;
        case 'examples':
          minutes += 8;
          break;
        case 'custom':
          minutes += 10;
          break;
      }
    }
    
    return Math.max(5, minutes); // Minimum 5 minutes
  }

  private findMissingVariables(prompt: string): string[] {
    const variableRegex = /{{([^}]+)}}/g;
    const matches = prompt.match(variableRegex);
    
    if (!matches) return [];
    
    return matches.map(match => match.replace(/[{}]/g, ''));
  }

  private optimizePrompt(prompt: string): string {
    // Remove excessive whitespace
    let optimized = prompt.replace(/\n{3,}/g, '\n\n');
    
    // Remove trailing spaces
    optimized = optimized.replace(/[ \t]+$/gm, '');
    
    // Ensure proper spacing around sections
    optimized = optimized.replace(/([.!?])\n([A-Z])/g, '$1\n\n$2');
    
    return optimized.trim();
  }

  private incrementVersion(currentVersion: string): string {
    const parts = currentVersion.split('.');
    const patch = parseInt(parts[2] || '0') + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  async getPromptBlueprints(userId: string, options: {
    includePublic?: boolean;
    tags?: string[];
    industry?: string;
    difficulty?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ blueprints: any[]; total: number }> {
    const where: any = {
      OR: [
        { userId },
        ...(options.includePublic ? [{ isPublic: true }] : [])
      ]
    };

    if (options.tags?.length) {
      where.tags = { hasSome: options.tags };
    }

    if (options.industry) {
      where.industry = options.industry;
    }

    if (options.difficulty) {
      where.difficulty = options.difficulty;
    }

    const [blueprints, total] = await Promise.all([
      this.prisma.promptBlueprint.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, avatar: true }
          },
          _count: {
            select: { forks: true, favorites: true }
          }
        },
        orderBy: [
          { featured: 'desc' },
          { usageCount: 'desc' },
          { createdAt: 'desc' }
        ],
        take: options.limit || 20,
        skip: options.offset || 0
      }),
      this.prisma.promptBlueprint.count({ where })
    ]);

    return { blueprints, total };
  }

  async forkBlueprint(blueprintId: string, userId: string, name?: string): Promise<any> {
    const original = await this.prisma.promptBlueprint.findUnique({
      where: { id: blueprintId }
    });

    if (!original) {
      throw new BadRequestException('Blueprint not found');
    }

    // Create fork
    const fork = await this.prisma.promptBlueprint.create({
      data: {
        userId,
        name: name || `${original.name} (Fork)`,
        description: `Forked from ${original.name}`,
        blocks: original.blocks,
        generatedPrompt: original.generatedPrompt,
        complexity: original.complexity,
        tags: original.tags,
        industry: original.industry,
        difficulty: original.difficulty,
        estimatedTime: original.estimatedTime,
        parentId: blueprintId,
        isPublic: false,
        usageCount: 0,
        metadata: {
          ...original.metadata,
          version: '1.0.0',
          created: new Date(),
          lastModified: new Date(),
          forkedFrom: blueprintId
        }
      }
    });

    // Increment fork count on original
    await this.prisma.promptBlueprint.update({
      where: { id: blueprintId },
      data: { forkCount: { increment: 1 } }
    });

    return fork;
  }

  async analyzePromptBlueprint(blueprintId: string): Promise<any> {
    const blueprint = await this.prisma.promptBlueprint.findUnique({
      where: { id: blueprintId }
    });

    if (!blueprint) {
      throw new BadRequestException('Blueprint not found');
    }

    const blocks = blueprint.blocks as PromptBlock[];
    
    return {
      id: blueprintId,
      analysis: {
        blockDistribution: this.analyzeBlockDistribution(blocks),
        variableUsage: this.analyzeVariableUsage(blocks),
        structureQuality: this.analyzeStructureQuality(blocks),
        optimization: this.analyzeOptimizationOpportunities(blocks),
        recommendations: this.generateRecommendations(blocks)
      },
      metrics: {
        complexity: blueprint.complexity,
        estimatedTime: blueprint.estimatedTime,
        blockCount: blocks.length,
        variableCount: this.countVariables(blocks),
        readabilityScore: this.calculateReadabilityScore(blueprint.generatedPrompt)
      }
    };
  }

  private analyzeBlockDistribution(blocks: PromptBlock[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    for (const block of blocks) {
      distribution[block.type] = (distribution[block.type] || 0) + 1;
    }
    
    return distribution;
  }

  private analyzeVariableUsage(blocks: PromptBlock[]): any {
    const variables: Record<string, any> = {};
    
    for (const block of blocks) {
      const template = this.blockTemplates[block.type];
      if (template) {
        for (const variable of template.variables) {
          const value = block.config.variables[variable];
          if (value) {
            variables[variable] = {
              block: block.type,
              length: value.length,
              complexity: this.estimateTextComplexity(value)
            };
          }
        }
      }
    }
    
    return variables;
  }

  private analyzeStructureQuality(blocks: PromptBlock[]): any {
    const hasRole = blocks.some(b => b.type === 'role');
    const hasTask = blocks.some(b => b.type === 'task');
    const hasFormat = blocks.some(b => b.type === 'format');
    const hasExamples = blocks.some(b => b.type === 'examples');
    
    return {
      hasEssentialBlocks: hasRole && hasTask,
      hasOutputGuidance: hasFormat,
      hasExamples,
      structureScore: this.calculateStructureScore(blocks),
      missingComponents: this.identifyMissingComponents(blocks)
    };
  }

  private analyzeOptimizationOpportunities(blocks: PromptBlock[]): string[] {
    const opportunities: string[] = [];
    
    if (blocks.length < 3) {
      opportunities.push('Consider adding more blocks for better structure');
    }
    
    if (!blocks.some(b => b.type === 'examples')) {
      opportunities.push('Add examples to improve output quality');
    }
    
    if (!blocks.some(b => b.type === 'constraints')) {
      opportunities.push('Define constraints to prevent unwanted outputs');
    }
    
    if (blocks.filter(b => b.type === 'custom').length > 2) {
      opportunities.push('Too many custom blocks may reduce maintainability');
    }
    
    return opportunities;
  }

  private generateRecommendations(blocks: PromptBlock[]): string[] {
    const recommendations: string[] = [];
    
    // Check for proper order
    const order = blocks.map(b => b.type);
    if (order.indexOf('task') < order.indexOf('role')) {
      recommendations.push('Consider placing role definition before task definition');
    }
    
    // Check for variable completeness
    const emptyVariables = this.findEmptyVariables(blocks);
    if (emptyVariables.length > 0) {
      recommendations.push(`Fill in missing variables: ${emptyVariables.join(', ')}`);
    }
    
    // Check for balance
    const customBlocks = blocks.filter(b => b.type === 'custom').length;
    const totalBlocks = blocks.length;
    if (customBlocks / totalBlocks > 0.5) {
      recommendations.push('Balance custom blocks with structured template blocks');
    }
    
    return recommendations;
  }

  private findEmptyVariables(blocks: PromptBlock[]): string[] {
    const empty: string[] = [];
    
    for (const block of blocks) {
      const template = this.blockTemplates[block.type];
      if (template) {
        for (const variable of template.variables) {
          if (!block.config.variables[variable] || block.config.variables[variable].trim() === '') {
            empty.push(`${block.type}.${variable}`);
          }
        }
      }
    }
    
    return empty;
  }

  private calculateStructureScore(blocks: PromptBlock[]): number {
    let score = 0;
    
    // Essential blocks
    if (blocks.some(b => b.type === 'role')) score += 20;
    if (blocks.some(b => b.type === 'task')) score += 25;
    if (blocks.some(b => b.type === 'context')) score += 15;
    
    // Quality blocks
    if (blocks.some(b => b.type === 'format')) score += 15;
    if (blocks.some(b => b.type === 'examples')) score += 15;
    if (blocks.some(b => b.type === 'constraints')) score += 10;
    
    return Math.min(100, score);
  }

  private identifyMissingComponents(blocks: PromptBlock[]): string[] {
    const missing: string[] = [];
    const types = new Set(blocks.map(b => b.type));
    
    if (!types.has('role')) missing.push('Role Definition');
    if (!types.has('task')) missing.push('Task Definition');
    if (!types.has('format')) missing.push('Output Format');
    
    return missing;
  }

  private estimateTextComplexity(text: string): number {
    const words = text.split(' ').length;
    const sentences = text.split(/[.!?]+/).length;
    const avgWordsPerSentence = words / sentences;
    
    // Simple complexity score
    return Math.min(10, Math.round(avgWordsPerSentence / 2));
  }

  private calculateReadabilityScore(text: string): number {
    const words = text.split(' ').length;
    const sentences = text.split(/[.!?]+/).length;
    const syllables = this.countSyllables(text);
    
    // Simplified Flesch reading ease
    const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private countSyllables(text: string): number {
    return text.toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/[aeiouy]+/g, 'a')
      .length;
  }
}