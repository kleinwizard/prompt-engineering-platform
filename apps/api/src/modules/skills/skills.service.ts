import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { RulesEngine } from '@prompt-platform/prompt-engine';
import { PromptAnalysisService } from '../prompts/prompt-analysis.service';
import { GamificationService } from '../gamification/gamification.service';
import {
  SkillAssessmentDto,
  SkillProgressDto,
  SkillRecommendationDto,
  CreateSkillDto,
  UpdateSkillDto,
} from './dto';
import {
  SkillEvaluation,
  SkillReport,
  SkillRecommendation,
  UserSkillProfile,
  SkillAssessmentResult,
} from './interfaces';

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);
  
  private readonly skillWeights = {
    specificity: 0.15,
    constraints: 0.15, 
    structure: 0.20,
    roleDefinition: 0.15,
    outputFormat: 0.10,
    verification: 0.10,
    safety: 0.15,
  };

  private readonly difficultyLevels = {
    beginner: { minScore: 0, maxScore: 30 },
    intermediate: { minScore: 30, maxScore: 60 },
    advanced: { minScore: 60, maxScore: 80 },
    expert: { minScore: 80, maxScore: 100 },
  };

  constructor(
    private prisma: PrismaService,
    private rulesEngine: RulesEngine,
    private promptAnalysisService: PromptAnalysisService,
    private gamificationService: GamificationService,
    private eventEmitter: EventEmitter2,
  ) {}

  async assessUserSkill(userId: string, assessmentDto: SkillAssessmentDto): Promise<SkillAssessmentResult> {
    const { prompt, skillId, context } = assessmentDto;

    // Get skill definition
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      include: { rubric: true },
    });

    if (!skill) {
      throw new NotFoundException('Skill not found');
    }

    // Analyze the prompt
    const analysis = await this.promptAnalysisService.analyzePrompt({
      rawUserPrompt: prompt,
      userId,
      context,
    });

    // Apply skill-specific rules
    const ruleResults = await this.rulesEngine.applyRules(
      { rawUserPrompt: prompt, userId, ...context },
      analysis
    );

    // Calculate skill scores
    const skillScores = this.calculateSkillScores(analysis, ruleResults, skill);
    
    // Generate detailed feedback
    const feedback = this.generateSkillFeedback(skillScores, ruleResults, skill);
    
    // Get recommendations for improvement
    const recommendations = this.generateSkillRecommendations(skillScores, skill);

    // ISSUE: Model 'skillAssessment' does not exist in Prisma schema
    // FIX: Create SkillAssessment model with userId, skillId, scores fields
    // Store assessment result
    const assessment = await this.prisma.skillAssessment.create({
      data: {
        userId,
        skillId,
        prompt,
        response: JSON.stringify(analysis),
        scores: skillScores,
        overallScore: skillScores.overall,
        feedback: feedback.summary,
        suggestions: JSON.stringify(recommendations),
      },
    });

    // Update user skill profile
    await this.updateUserSkillProfile(userId, skillScores);

    // Award points for assessment
    await this.gamificationService.awardPoints(userId, 'skill_improved', {
      skillId,
      score: skillScores.overall,
      improvement: skillScores.overall - (await this.getPreviousSkillScore(userId, skillId)),
    });

    // Emit skill assessment event
    this.eventEmitter.emit('skill.assessed', {
      userId,
      skillId,
      score: skillScores.overall,
      assessment,
    });

    return {
      assessmentId: assessment.id,
      scores: skillScores,
      feedback,
      recommendations,
      levelAchieved: this.determineSkillLevel(skillScores.overall),
      nextMilestone: this.getNextMilestone(skillScores.overall),
    };
  }

  async getUserSkillProfile(userId: string): Promise<UserSkillProfile> {
    // ISSUE: Model 'userSkills' does not exist in Prisma schema
    // FIX: Create UserSkills model with all skill score fields
    const userSkills = await this.prisma.userSkills.findUnique({
      where: { userId },
    });

    if (!userSkills) {
      // Create default skill profile
      const defaultProfile = await this.createDefaultSkillProfile(userId);
      return this.formatSkillProfile(defaultProfile);
    }

    // ISSUE: Model 'skillAssessment' does not exist in Prisma schema
    // FIX: Create SkillAssessment model for tracking assessment history
    // Get skill assessments history
    const assessments = await this.prisma.skillAssessment.findMany({
      where: { userId },
      include: { skill: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Calculate skill trends
    const skillTrends = this.calculateSkillTrends(assessments);

    // Get skill recommendations
    const recommendations = await this.getPersonalizedRecommendations(userId, userSkills);

    return {
      profile: userSkills,
      assessmentHistory: assessments,
      skillTrends,
      recommendations,
      strongestSkills: this.identifyStrongestSkills(userSkills),
      areasForImprovement: this.identifyWeakestSkills(userSkills),
      overallProgress: this.calculateOverallProgress(userSkills),
    };
  }

  async getSkillRecommendations(userId: string): Promise<SkillRecommendation[]> {
    // ISSUE: Model 'userSkills' does not exist in Prisma schema
    // FIX: Create UserSkills model for skill tracking and recommendations
    const userSkills = await this.prisma.userSkills.findUnique({
      where: { userId },
    });

    if (!userSkills) {
      return this.getBeginnerRecommendations();
    }

    // Identify weakest skills
    const weakestSkills = this.identifyWeakestSkills(userSkills);
    
    // Get learning paths for these skills
    const recommendations = await Promise.all(
      weakestSkills.map(async (skillArea) => {
        const skill = await this.prisma.skill.findUnique({
          where: { slug: skillArea.slug },
          include: { lessons: true },
        });

        if (!skill) return null;

        return {
          skillId: skill.id,
          skillName: skill.name,
          currentLevel: skillArea.score,
          targetLevel: Math.min(skillArea.score + 20, 100),
          priority: this.calculateRecommendationPriority(skillArea),
          learningPath: {
            estimatedTime: skill.lessons.length * 15, // 15 minutes per lesson
            lessons: skill.lessons.map(l => ({
              id: l.id,
              title: l.title,
              duration: l.duration,
            })),
          },
          practiceExercises: this.generatePracticeExercises(skill),
          resources: this.getSkillResources(skill),
        };
      })
    );

    return recommendations.filter(Boolean);
  }

  async trackSkillProgress(userId: string, progressDto: SkillProgressDto): Promise<void> {
    const { skillId, activityType, score, metadata } = progressDto;

    // Update skill progress tracking
    await this.prisma.$transaction(async (tx) => {
      // ISSUE: Model 'userSkills' does not exist in Prisma schema
      // FIX: Create UserSkills model for progress tracking
      // Get current user skills
      const userSkills = await tx.userSkills.findUnique({
        where: { userId },
      });

      if (!userSkills) {
        throw new NotFoundException('User skill profile not found');
      }

      // Calculate new skill score based on activity
      const newScore = this.calculateSkillProgression(
        userSkills,
        skillId,
        activityType,
        score,
        metadata
      );

      // ISSUE: Model 'userSkills' does not exist in Prisma schema
      // FIX: Create UserSkills model with skill fields and lastAssessment
      // Update user skills
      await tx.userSkills.update({
        where: { userId },
        data: {
          ...this.getSkillUpdateData(skillId, newScore),
          lastAssessment: new Date(),
        },
      });

      // Log skill progression event
      await tx.analyticsEvent.create({
        data: {
          userId,
          sessionId: metadata?.sessionId || 'unknown',
          event: 'skill.progress',
          properties: {
            skillId,
            activityType,
            oldScore: this.getSkillScore(userSkills, skillId),
            newScore,
            improvement: newScore - this.getSkillScore(userSkills, skillId),
          },
        },
      });
    });

    // Award points for skill improvement
    await this.gamificationService.awardPoints(userId, 'skill_improved', {
      skillId,
      activityType,
      score,
    });
  }

  async createSkill(createSkillDto: CreateSkillDto): Promise<any> {
    const { name, description, category, rubric } = createSkillDto;

    return this.prisma.skill.create({
      data: {
        name,
        slug: this.generateSlug(name),
        description,
        category,
        rubric: rubric || {},
      },
    });
  }

  async updateSkill(id: string, updateSkillDto: UpdateSkillDto): Promise<any> {
    return this.prisma.skill.update({
      where: { id },
      data: updateSkillDto,
    });
  }

  async getAllSkills(): Promise<any[]> {
    return this.prisma.skill.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            userSkills: true,
            assessments: true,
            lessons: true,
          },
        },
      },
    });
  }

  private calculateSkillScores(analysis: any, ruleResults: any[], skill: any): any {
    const scores = {
      specificity: this.evaluateSpecificity(analysis, ruleResults),
      constraints: this.evaluateConstraints(analysis, ruleResults),
      structure: this.evaluateStructure(analysis, ruleResults),
      roleDefinition: this.evaluateRoleDefinition(analysis, ruleResults),
      outputFormat: this.evaluateOutputFormat(analysis, ruleResults),
      verification: this.evaluateVerification(analysis, ruleResults),
      safety: this.evaluateSafety(analysis, ruleResults),
    };

    // Calculate weighted overall score
    scores.overall = Object.entries(this.skillWeights).reduce(
      (total, [skillName, weight]) => total + (scores[skillName] * weight),
      0
    );

    return scores;
  }

  private evaluateSpecificity(analysis: any, ruleResults: any[]): number {
    const specificityRules = ruleResults.filter(r => r.category === 'clarity' && r.name.includes('Specificity'));
    let score = 70; // Base score

    // Deduct points for vague language
    if (analysis.clarity?.ambiguityScore > 10) {
      score -= Math.min(analysis.clarity.ambiguityScore, 30);
    }

    // Add points for specific measurements
    if (analysis.structure?.hasQuantifiers) score += 15;
    if (analysis.structure?.hasExamples) score += 10;

    // Apply rule-based adjustments
    specificityRules.forEach(rule => {
      if (rule.priority === 'high') score -= 15;
      else if (rule.priority === 'medium') score -= 10;
      else score -= 5;
    });

    return Math.max(0, Math.min(100, score));
  }

  private evaluateConstraints(analysis: any, ruleResults: any[]): number {
    const constraintRules = ruleResults.filter(r => r.category === 'requirements');
    let score = 60; // Base score

    // Check for explicit constraints
    if (analysis.structure?.hasConstraints) score += 20;
    if (analysis.structure?.hasWordLimit) score += 10;
    if (analysis.structure?.hasQualityStandards) score += 15;

    // Apply rule penalties
    constraintRules.forEach(rule => {
      if (rule.priority === 'high') score -= 20;
      else if (rule.priority === 'medium') score -= 15;
      else score -= 10;
    });

    return Math.max(0, Math.min(100, score));
  }

  private evaluateStructure(analysis: any, ruleResults: any[]): number {
    let score = 50; // Base score

    // Structure elements
    if (analysis.structure?.hasRole) score += 15;
    if (analysis.structure?.hasTask) score += 20;
    if (analysis.structure?.hasContext) score += 15;
    if (analysis.structure?.hasFormat) score += 10;
    if (analysis.structure?.hasLogicalFlow) score += 20;

    // Deduct for structural issues
    const structureRules = ruleResults.filter(r => r.category === 'organization');
    structureRules.forEach(rule => {
      if (rule.priority === 'high') score -= 15;
      else score -= 10;
    });

    return Math.max(0, Math.min(100, score));
  }

  private evaluateRoleDefinition(analysis: any, ruleResults: any[]): number {
    let score = 40; // Base score

    if (analysis.structure?.hasRole) score += 30;
    if (analysis.structure?.hasExpertise) score += 20;
    if (analysis.structure?.hasPersona) score += 10;

    // Apply role-specific rule penalties
    const roleRules = ruleResults.filter(r => r.category === 'context');
    roleRules.forEach(rule => {
      if (rule.priority === 'high') score -= 20;
      else score -= 10;
    });

    return Math.max(0, Math.min(100, score));
  }

  private evaluateOutputFormat(analysis: any, ruleResults: any[]): number {
    let score = 60; // Base score

    if (analysis.structure?.hasFormat) score += 25;
    if (analysis.structure?.hasStructureRequirements) score += 15;

    const formatRules = ruleResults.filter(r => r.category === 'output');
    formatRules.forEach(rule => {
      if (rule.priority === 'high') score -= 15;
      else score -= 10;
    });

    return Math.max(0, Math.min(100, score));
  }

  private evaluateVerification(analysis: any, ruleResults: any[]): number {
    let score = 70; // Base score

    // Look for verification instructions
    if (analysis.content?.includes('verify') || analysis.content?.includes('check')) {
      score += 15;
    }
    if (analysis.structure?.hasCriteria) score += 15;

    return Math.max(0, Math.min(100, score));
  }

  private evaluateSafety(analysis: any, ruleResults: any[]): number {
    let score = 90; // High base score for safety

    // Deduct for safety issues
    if (analysis.safety?.hasPII) score -= 30;
    if (analysis.safety?.hasHarmfulContent) score -= 50;
    if (analysis.safety?.hasInappropriateInstructions) score -= 40;

    const safetyRules = ruleResults.filter(r => r.category === 'safety');
    safetyRules.forEach(rule => {
      if (rule.priority === 'high') score -= 20;
      else score -= 10;
    });

    return Math.max(0, Math.min(100, score));
  }

  private generateSkillFeedback(scores: any, ruleResults: any[], skill: any): any {
    const feedback = {
      summary: '',
      strengths: [],
      improvements: [],
      specific: {},
    };

    // Identify strengths (scores > 75)
    Object.entries(scores).forEach(([skillName, score]) => {
      if (skillName !== 'overall' && score > 75) {
        feedback.strengths.push(this.getSkillStrengthMessage(skillName, score));
      }
    });

    // Identify areas for improvement (scores < 50)
    Object.entries(scores).forEach(([skillName, score]) => {
      if (skillName !== 'overall' && score < 50) {
        feedback.improvements.push(this.getSkillImprovementMessage(skillName, score));
      }
    });

    // Generate overall summary
    const level = this.determineSkillLevel(scores.overall);
    feedback.summary = `Your prompt engineering skill level is ${level} with an overall score of ${Math.round(scores.overall)}/100. `;
    
    if (feedback.strengths.length > 0) {
      feedback.summary += `Your strongest areas are ${feedback.strengths.slice(0, 2).join(' and ')}.`;
    }
    
    if (feedback.improvements.length > 0) {
      feedback.summary += ` Focus on improving ${feedback.improvements.slice(0, 2).join(' and ')}.`;
    }

    return feedback;
  }

  private generateSkillRecommendations(scores: any, skill: any): SkillRecommendation[] {
    const recommendations = [];

    Object.entries(scores).forEach(([skillName, score]) => {
      if (skillName !== 'overall' && score < 70) {
        recommendations.push({
          skill: skillName,
          currentScore: score,
          targetScore: Math.min(score + 20, 100),
          priority: score < 40 ? 'high' : 'medium',
          actions: this.getSkillImprovementActions(skillName),
          resources: this.getSkillResources({ name: skillName }),
        });
      }
    });

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private async updateUserSkillProfile(userId: string, scores: any): Promise<void> {
    // ISSUE: Model 'userSkills' does not exist in Prisma schema
    // FIX: Create UserSkills model with all skill score fields and assessment tracking
    await this.prisma.userSkills.upsert({
      where: { userId },
      update: {
        specificity: scores.specificity,
        constraints: scores.constraints,
        structure: scores.structure,
        roleDefinition: scores.roleDefinition,
        outputFormat: scores.outputFormat,
        verification: scores.verification,
        safety: scores.safety,
        overallScore: scores.overall,
        assessmentCount: { increment: 1 },
        lastAssessment: new Date(),
      },
      create: {
        userId,
        specificity: scores.specificity,
        constraints: scores.constraints,
        structure: scores.structure,
        roleDefinition: scores.roleDefinition,
        outputFormat: scores.outputFormat,
        verification: scores.verification,
        safety: scores.safety,
        overallScore: scores.overall,
        assessmentCount: 1,
        lastAssessment: new Date(),
      },
    });
  }

  private async getPreviousSkillScore(userId: string, skillId: string): Promise<number> {
    // ISSUE: Model 'skillAssessment' does not exist in Prisma schema
    // FIX: Create SkillAssessment model for tracking assessment history
    const lastAssessment = await this.prisma.skillAssessment.findFirst({
      where: { userId, skillId },
      orderBy: { createdAt: 'desc' },
      skip: 1, // Skip the most recent one
    });

    return lastAssessment?.overallScore || 0;
  }

  private determineSkillLevel(score: number): string {
    if (score >= 80) return 'Expert';
    if (score >= 60) return 'Advanced';
    if (score >= 30) return 'Intermediate';
    return 'Beginner';
  }

  private getNextMilestone(score: number): any {
    const milestones = [30, 60, 80, 100];
    const nextMilestone = milestones.find(m => m > score);
    
    return nextMilestone ? {
      score: nextMilestone,
      level: this.determineSkillLevel(nextMilestone),
      pointsNeeded: nextMilestone - score,
    } : null;
  }

  private async createDefaultSkillProfile(userId: string): Promise<any> {
    // ISSUE: Model 'userSkills' does not exist in Prisma schema
    // FIX: Create UserSkills model with all skill fields and default values
    return this.prisma.userSkills.create({
      data: {
        userId,
        specificity: 0,
        constraints: 0,
        structure: 0,
        roleDefinition: 0,
        outputFormat: 0,
        verification: 0,
        safety: 90, // Start with high safety score
        overallScore: 12.86, // Weighted average with safety = 90
        assessmentCount: 0,
      },
    });
  }

  private formatSkillProfile(userSkills: any): UserSkillProfile {
    return {
      profile: userSkills,
      assessmentHistory: [],
      skillTrends: {},
      recommendations: [],
      strongestSkills: this.identifyStrongestSkills(userSkills),
      areasForImprovement: this.identifyWeakestSkills(userSkills),
      overallProgress: this.calculateOverallProgress(userSkills),
    };
  }

  private calculateSkillTrends(assessments: any[]): any {
    const trends = {};
    
    // Group assessments by skill
    const skillGroups = assessments.reduce((groups, assessment) => {
      const skillName = assessment.skill.name;
      if (!groups[skillName]) groups[skillName] = [];
      groups[skillName].push(assessment);
      return groups;
    }, {});

    // Calculate trend for each skill
    Object.entries(skillGroups).forEach(([skillName, skillAssessments]) => {
      if (skillAssessments.length >= 2) {
        const recent = skillAssessments[0].overallScore;
        const older = skillAssessments[skillAssessments.length - 1].overallScore;
        trends[skillName] = recent - older;
      }
    });

    return trends;
  }

  private async getPersonalizedRecommendations(userId: string, userSkills: any): Promise<SkillRecommendation[]> {
    // This would integrate with the learning system to suggest personalized paths
    return this.generateSkillRecommendations(userSkills, null);
  }

  private identifyStrongestSkills(userSkills: any): any[] {
    const skills = [
      { name: 'Specificity', slug: 'specificity', score: userSkills.specificity },
      { name: 'Constraints', slug: 'constraints', score: userSkills.constraints },
      { name: 'Structure', slug: 'structure', score: userSkills.structure },
      { name: 'Role Definition', slug: 'roleDefinition', score: userSkills.roleDefinition },
      { name: 'Output Format', slug: 'outputFormat', score: userSkills.outputFormat },
      { name: 'Verification', slug: 'verification', score: userSkills.verification },
      { name: 'Safety', slug: 'safety', score: userSkills.safety },
    ];

    return skills
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  private identifyWeakestSkills(userSkills: any): any[] {
    const skills = [
      { name: 'Specificity', slug: 'specificity', score: userSkills.specificity },
      { name: 'Constraints', slug: 'constraints', score: userSkills.constraints },
      { name: 'Structure', slug: 'structure', score: userSkills.structure },
      { name: 'Role Definition', slug: 'roleDefinition', score: userSkills.roleDefinition },
      { name: 'Output Format', slug: 'outputFormat', score: userSkills.outputFormat },
      { name: 'Verification', slug: 'verification', score: userSkills.verification },
      { name: 'Safety', slug: 'safety', score: userSkills.safety },
    ];

    return skills
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);
  }

  private calculateOverallProgress(userSkills: any): any {
    const totalPossible = 700; // 7 skills × 100 points each
    const currentTotal = 
      userSkills.specificity +
      userSkills.constraints +
      userSkills.structure +
      userSkills.roleDefinition +
      userSkills.outputFormat +
      userSkills.verification +
      userSkills.safety;

    return {
      percentage: Math.round((currentTotal / totalPossible) * 100),
      level: this.determineSkillLevel(userSkills.overallScore),
      totalPoints: currentTotal,
      maxPoints: totalPossible,
    };
  }

  private getBeginnerRecommendations(): SkillRecommendation[] {
    return [
      {
        skill: 'structure',
        currentScore: 0,
        targetScore: 30,
        priority: 'high',
        actions: ['Learn basic prompt structure', 'Practice with templates'],
        resources: [],
      },
      {
        skill: 'specificity',
        currentScore: 0,
        targetScore: 30,
        priority: 'high',
        actions: ['Avoid vague language', 'Add specific examples'],
        resources: [],
      },
    ];
  }

  private calculateRecommendationPriority(skillArea: any): 'high' | 'medium' | 'low' {
    if (skillArea.score < 30) return 'high';
    if (skillArea.score < 50) return 'medium';
    return 'low';
  }

  private generatePracticeExercises(skill: any): any[] {
    // This would return skill-specific practice exercises
    return [
      {
        title: `Practice ${skill.name}`,
        description: `Improve your ${skill.name.toLowerCase()} skills`,
        difficulty: 'beginner',
        estimatedTime: 10,
      },
    ];
  }

  private getSkillResources(skill: any): any[] {
    // This would return learning resources for the skill
    return [
      {
        type: 'article',
        title: `Mastering ${skill.name}`,
        url: '#',
      },
    ];
  }

  private calculateSkillProgression(userSkills: any, skillId: string, activityType: string, score: number, metadata: any): number {
    const currentScore = this.getSkillScore(userSkills, skillId);
    
    // Simple progression model - weight recent activities more
    const improvement = Math.max(0, score - currentScore) * 0.1;
    return Math.min(100, currentScore + improvement);
  }

  private getSkillScore(userSkills: any, skillId: string): number {
    // Map skillId to actual field names
    const skillMapping = {
      'specificity': userSkills.specificity,
      'constraints': userSkills.constraints,
      'structure': userSkills.structure,
      'roleDefinition': userSkills.roleDefinition,
      'outputFormat': userSkills.outputFormat,
      'verification': userSkills.verification,
      'safety': userSkills.safety,
    };

    return skillMapping[skillId] || 0;
  }

  private getSkillUpdateData(skillId: string, newScore: number): any {
    const updateData = {};
    updateData[skillId] = newScore;
    
    // Recalculate overall score
    updateData['overallScore'] = Object.entries(this.skillWeights).reduce(
      (total, [skillName, weight]) => {
        const score = skillName === skillId ? newScore : this.getSkillScore(updateData, skillName);
        return total + (score * weight);
      },
      0
    );

    return updateData;
  }

  private getSkillStrengthMessage(skillName: string, score: number): string {
    const messages = {
      specificity: 'clear and specific language',
      constraints: 'well-defined constraints',
      structure: 'excellent prompt structure',
      roleDefinition: 'effective role definitions',
      outputFormat: 'clear output formatting',
      verification: 'good verification practices',
      safety: 'strong safety awareness',
    };

    return messages[skillName] || `strong ${skillName} skills`;
  }

  private getSkillImprovementMessage(skillName: string, score: number): string {
    const messages = {
      specificity: 'being more specific and concrete',
      constraints: 'adding clear constraints and requirements',
      structure: 'improving prompt organization',
      roleDefinition: 'defining roles more clearly',
      outputFormat: 'specifying output formats',
      verification: 'adding verification steps',
      safety: 'safety and ethical considerations',
    };

    return messages[skillName] || `${skillName} improvement`;
  }

  private getSkillImprovementActions(skillName: string): string[] {
    const actions = {
      specificity: [
        'Use concrete examples instead of abstract descriptions',
        'Include specific measurements and quantities',
        'Replace vague terms with precise language',
      ],
      constraints: [
        'Define clear boundaries and limitations',
        'Specify required length or format',
        'Add quality standards and criteria',
      ],
      structure: [
        'Use consistent prompt organization',
        'Separate role, task, and context clearly',
        'Add logical flow between sections',
      ],
      roleDefinition: [
        'Define specific expertise and background',
        'Include relevant experience level',
        'Specify domain knowledge required',
      ],
      outputFormat: [
        'Specify exact format requirements',
        'Provide structure examples',
        'Define presentation standards',
      ],
      verification: [
        'Add quality check instructions',
        'Include validation criteria',
        'Specify review requirements',
      ],
      safety: [
        'Review for potential harmful content',
        'Ensure privacy protection',
        'Add ethical guidelines',
      ],
    };

    return actions[skillName] || ['Practice and improve this skill'];
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}