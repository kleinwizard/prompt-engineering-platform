import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { PromptAnalysisService } from '../prompts/prompt-analysis.service';
import { RulesEngine } from '@prompt-platform/prompt-engine';
import {
  CreateChallengeDto,
  UpdateChallengeDto,
  JoinChallengeDto,
  SubmitChallengeDto,
  ChallengeSearchDto,
} from './dto';
import {
  ChallengeWithDetails,
  ChallengeSubmissionResult,
  ChallengeLeaderboard,
  ChallengeStats,
  ChallengeScoringResult,
  ChallengeRecommendation,
} from './interfaces';

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  private readonly scoringWeights = {
    accuracy: 0.4,
    creativity: 0.2,
    efficiency: 0.2,
    safety: 0.1,
    adherence: 0.1,
  };

  private readonly difficultyMultipliers = {
    easy: 1.0,
    medium: 1.5,
    hard: 2.0,
    expert: 3.0,
  };

  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private promptAnalysisService: PromptAnalysisService,
    private rulesEngine: RulesEngine,
    private eventEmitter: EventEmitter2,
  ) {}

  async createChallenge(createChallengeDto: CreateChallengeDto): Promise<ChallengeWithDetails> {
    const {
      title,
      description,
      type,
      category,
      difficulty = 'medium',
      prompt,
      requirements,
      rubric,
      startDate,
      endDate,
      points = 100,
      badgeId,
    } = createChallengeDto;

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    if (new Date(startDate) < new Date()) {
      throw new BadRequestException('Start date cannot be in the past');
    }

    const challenge = await this.prisma.challenge.create({
      data: {
        title,
        slug: this.generateSlug(title),
        description,
        type,
        category,
        difficulty,
        prompt,
        requirements: requirements || {},
        rubric: rubric || this.generateDefaultRubric(category),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        points: Math.round(points * this.difficultyMultipliers[difficulty]),
        badgeId,
        isActive: new Date() >= new Date(startDate),
      },
      include: {
        participants: {
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
          },
        },
        submissions: {
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
          },
          orderBy: { score: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            participants: true,
            submissions: true,
          },
        },
      },
    });

    this.logger.log(`Challenge ${challenge.id} created: ${title}`);

    // Emit challenge created event
    this.eventEmitter.emit('challenge.created', {
      challengeId: challenge.id,
      title,
      type,
      category,
      startDate,
    });

    return this.enrichChallengeDetails(challenge);
  }

  async updateChallenge(challengeId: string, updateDto: UpdateChallengeDto): Promise<ChallengeWithDetails> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    // Check if challenge has started
    if (challenge.startDate <= new Date() && Object.keys(updateDto).some(key => 
      ['prompt', 'requirements', 'rubric'].includes(key)
    )) {
      throw new BadRequestException('Cannot modify challenge requirements after it has started');
    }

    const updatedChallenge = await this.prisma.challenge.update({
      where: { id: challengeId },
      data: {
        ...updateDto,
        slug: updateDto.title ? this.generateSlug(updateDto.title) : undefined,
        startDate: updateDto.startDate ? new Date(updateDto.startDate) : undefined,
        endDate: updateDto.endDate ? new Date(updateDto.endDate) : undefined,
      },
      include: {
        participants: {
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
          },
        },
        submissions: {
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
          },
          orderBy: { score: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            participants: true,
            submissions: true,
          },
        },
      },
    });

    this.logger.log(`Challenge ${challengeId} updated`);

    return this.enrichChallengeDetails(updatedChallenge);
  }

  async getChallenge(challengeId: string, userId?: string): Promise<ChallengeWithDetails> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        participants: userId ? {
          where: { userId },
        } : {
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
          },
          take: 20,
        },
        submissions: {
          where: userId ? { userId } : { isPublic: true },
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
          },
          orderBy: { score: 'desc' },
          take: userId ? 5 : 10,
        },
        _count: {
          select: {
            participants: true,
            submissions: true,
          },
        },
      },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    return this.enrichChallengeDetails(challenge);
  }

  async searchChallenges(searchDto: ChallengeSearchDto, userId?: string): Promise<{
    challenges: ChallengeWithDetails[];
    total: number;
    facets: any;
  }> {
    const {
      query,
      type,
      category,
      difficulty,
      status = 'active',
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = searchDto;

    const skip = (page - 1) * limit;
    const now = new Date();

    // Build search filters
    const where: any = {
      AND: [
        // Text search
        query ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        } : {},

        // Filters
        type ? { type } : {},
        category ? { category } : {},
        difficulty ? { difficulty } : {},

        // Status filter
        status === 'active' ? { isActive: true, endDate: { gt: now } } :
        status === 'upcoming' ? { startDate: { gt: now } } :
        status === 'ended' ? { endDate: { lt: now } } : {},
      ].filter(Boolean),
    };

    // Build sort options
    const orderBy = this.buildSortOptions(sortBy);

    const [challenges, total] = await Promise.all([
      this.prisma.challenge.findMany({
        where,
        include: {
          _count: {
            select: {
              participants: true,
              submissions: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.challenge.count({ where }),
    ]);

    // Get facets
    const facets = await this.getSearchFacets(where);

    const enrichedChallenges = challenges.map(challenge => this.enrichChallengeDetails(challenge));

    return {
      challenges: enrichedChallenges,
      total,
      facets,
    };
  }

  async joinChallenge(userId: string, challengeId: string, joinDto?: JoinChallengeDto): Promise<void> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    // Check if challenge is active and joinable
    const now = new Date();
    if (!challenge.isActive || challenge.endDate <= now) {
      throw new BadRequestException('Challenge is no longer active');
    }

    if (challenge.startDate > now) {
      throw new BadRequestException('Challenge has not started yet');
    }

    // Check if already joined
    const existingParticipant = await this.prisma.challengeParticipant.findUnique({
      where: {
        userId_challengeId: { userId, challengeId },
      },
    });

    if (existingParticipant) {
      throw new BadRequestException('Already joined this challenge');
    }

    await this.prisma.$transaction(async (tx) => {
      // Add participant
      await tx.challengeParticipant.create({
        data: {
          userId,
          challengeId,
        },
      });

      // Update participant count
      await tx.challenge.update({
        where: { id: challengeId },
        data: {
          participantCount: { increment: 1 },
        },
      });
    });

    // Award points for joining
    await this.gamificationService.awardPoints(userId, 'challenge_participated', {
      challengeId,
      challengeTitle: challenge.title,
    });

    // Check for first challenge achievement
    const userChallengeCount = await this.prisma.challengeParticipant.count({
      where: { userId },
    });

    if (userChallengeCount === 1) {
      await this.gamificationService.awardPoints(userId, 'first_challenge');
    }

    // Emit joined event
    this.eventEmitter.emit('challenge.joined', {
      userId,
      challengeId,
      challengeTitle: challenge.title,
    });

    this.logger.log(`User ${userId} joined challenge ${challengeId}`);
  }

  async submitChallenge(
    userId: string,
    challengeId: string,
    submitDto: SubmitChallengeDto,
  ): Promise<ChallengeSubmissionResult> {
    const { prompt, output, model = 'gpt-4', metadata } = submitDto;

    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { participants: { where: { userId } } },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    // Check if user is a participant
    if (challenge.participants.length === 0) {
      throw new ForbiddenException('Must join challenge before submitting');
    }

    // Check if challenge is still active
    const now = new Date();
    if (challenge.endDate <= now) {
      throw new BadRequestException('Challenge submission period has ended');
    }

    // Check if already submitted
    const existingSubmission = await this.prisma.challengeSubmission.findUnique({
      where: {
        userId_challengeId: { userId, challengeId },
      },
    });

    if (existingSubmission) {
      throw new BadRequestException('You have already submitted to this challenge');
    }

    // Analyze and score the submission
    const scoringResult = await this.scoreSubmission(challenge, prompt, output, model, metadata);

    // Create submission
    const submission = await this.prisma.$transaction(async (tx) => {
      const newSubmission = await tx.challengeSubmission.create({
        data: {
          userId,
          challengeId,
          prompt,
          output,
          model,
          score: scoringResult.totalScore,
          tokenCount: metadata?.tokenCount,
          executionTime: metadata?.executionTime,
          isPublic: submitDto.isPublic !== false,
        },
      });

      // Update challenge submission count
      await tx.challenge.update({
        where: { id: challengeId },
        data: {
          submissionCount: { increment: 1 },
        },
      });

      return newSubmission;
    });

    // Calculate rank after submission
    const rank = await this.calculateSubmissionRank(challengeId, scoringResult.totalScore);

    // Update submission with rank
    await this.prisma.challengeSubmission.update({
      where: { id: submission.id },
      data: { rank },
    });

    // Award points based on performance
    const pointsAwarded = this.calculateSubmissionPoints(challenge, scoringResult.totalScore, rank);
    await this.gamificationService.awardPoints(userId, 'challenge_completed', {
      challengeId,
      score: scoringResult.totalScore,
      rank,
      pointsAwarded,
    });

    // Check for challenge win (top 3)
    if (rank <= 3) {
      await this.gamificationService.awardPoints(userId, 'challenge_won', {
        challengeId,
        rank,
        additionalPoints: challenge.points * (4 - rank) * 0.5, // Bonus for top 3
      });
    }

    // Emit submission event
    this.eventEmitter.emit('challenge.submitted', {
      userId,
      challengeId,
      submissionId: submission.id,
      score: scoringResult.totalScore,
      rank,
    });

    this.logger.log(`User ${userId} submitted to challenge ${challengeId} - Score: ${scoringResult.totalScore}, Rank: ${rank}`);

    return {
      submissionId: submission.id,
      score: scoringResult.totalScore,
      rank,
      feedback: scoringResult.feedback,
      pointsAwarded,
      achievements: [], // TODO: Add achievement checking
    };
  }

  async getChallengeLeaderboard(challengeId: string, limit = 50): Promise<ChallengeLeaderboard> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const submissions = await this.prisma.challengeSubmission.findMany({
      where: { challengeId },
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
      },
      orderBy: [
        { score: 'desc' },
        { submittedAt: 'asc' }, // Earlier submission wins ties
      ],
      take: limit,
    });

    // Enrich with additional stats
    const leaderboard = await Promise.all(
      submissions.map(async (submission, index) => {
        const userStats = await this.prisma.challengeParticipant.count({
          where: { userId: submission.userId },
        });

        return {
          rank: index + 1,
          user: submission.user,
          score: submission.score,
          submittedAt: submission.submittedAt,
          model: submission.model,
          tokenCount: submission.tokenCount,
          executionTime: submission.executionTime,
          totalChallengesParticipated: userStats,
        };
      })
    );

    return {
      challenge: {
        id: challenge.id,
        title: challenge.title,
        category: challenge.category,
        difficulty: challenge.difficulty,
        endDate: challenge.endDate,
      },
      entries: leaderboard,
      totalSubmissions: submissions.length,
      lastUpdated: new Date(),
    };
  }

  async getChallengeStats(challengeId: string): Promise<ChallengeStats> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        submissions: {
          select: {
            score: true,
            submittedAt: true,
            model: true,
            tokenCount: true,
            executionTime: true,
          },
        },
        _count: {
          select: {
            participants: true,
            submissions: true,
          },
        },
      },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    // Calculate statistics
    const scores = challenge.submissions.map(s => s.score);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;

    // Submission timeline
    const submissionsByDay = challenge.submissions.reduce((acc, sub) => {
      const day = sub.submittedAt.toISOString().split('T')[0];
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    // Model usage
    const modelUsage = challenge.submissions.reduce((acc, sub) => {
      acc[sub.model] = (acc[sub.model] || 0) + 1;
      return acc;
    }, {});

    return {
      challengeId: challenge.id,
      title: challenge.title,
      totalParticipants: challenge._count.participants,
      totalSubmissions: challenge._count.submissions,
      completionRate: challenge._count.participants > 0 
        ? (challenge._count.submissions / challenge._count.participants) * 100 
        : 0,
      averageScore: avgScore,
      highestScore: maxScore,
      lowestScore: minScore,
      submissionTimeline: Object.entries(submissionsByDay).map(([date, count]) => ({
        date,
        submissions: count,
      })),
      modelDistribution: Object.entries(modelUsage).map(([model, count]) => ({
        model,
        usage: count,
        percentage: (count / challenge.submissions.length) * 100,
      })),
      difficultyLevel: challenge.difficulty,
      category: challenge.category,
      timeRemaining: challenge.endDate > new Date() 
        ? Math.max(0, challenge.endDate.getTime() - new Date().getTime())
        : 0,
    };
  }

  async getChallengeRecommendations(userId: string): Promise<ChallengeRecommendation[]> {
    // Get user's skill level and interests
    const userSkills = await this.prisma.userSkills.findUnique({
      where: { userId },
    });

    const userChallenges = await this.prisma.challengeParticipant.findMany({
      where: { userId },
      include: { challenge: true },
      take: 10,
    });

    // Determine user's preferred categories
    const categoryPreferences = userChallenges.reduce((acc, participation) => {
      acc[participation.challenge.category] = (acc[participation.challenge.category] || 0) + 1;
      return acc;
    }, {});

    // Determine appropriate difficulty
    const suggestedDifficulty = this.getSuggestedDifficulty(userSkills?.overallScore || 0);

    // Find suitable active challenges
    const now = new Date();
    const availableChallenges = await this.prisma.challenge.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gt: now },
        participants: {
          none: { userId }, // Exclude already joined challenges
        },
      },
      include: {
        _count: {
          select: {
            participants: true,
            submissions: true,
          },
        },
      },
      take: 20,
    });

    // Score and rank recommendations
    const recommendations = availableChallenges
      .map(challenge => {
        let score = 0;

        // Category preference bonus
        const categoryBonus = categoryPreferences[challenge.category] || 0;
        score += categoryBonus * 20;

        // Difficulty matching
        const difficultyMatch = challenge.difficulty === suggestedDifficulty ? 30 : 
                               Math.abs(this.difficultyToNumber(challenge.difficulty) - this.difficultyToNumber(suggestedDifficulty)) * -10;
        score += difficultyMatch;

        // Activity level bonus
        score += Math.min(challenge._count.participants * 2, 30);

        // Time remaining factor
        const timeRemaining = challenge.endDate.getTime() - now.getTime();
        const daysRemaining = timeRemaining / (1000 * 60 * 60 * 24);
        score += daysRemaining > 7 ? 20 : daysRemaining > 3 ? 10 : 5;

        return {
          challenge: this.enrichChallengeDetails(challenge),
          score,
          reason: this.generateRecommendationReason(challenge, categoryBonus > 0, difficultyMatch > 0),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return recommendations;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async updateChallengeStatuses(): Promise<void> {
    const now = new Date();

    // Activate challenges that should start
    await this.prisma.challenge.updateMany({
      where: {
        isActive: false,
        startDate: { lte: now },
        endDate: { gt: now },
      },
      data: { isActive: true },
    });

    // Deactivate ended challenges
    const endedChallenges = await this.prisma.challenge.updateMany({
      where: {
        isActive: true,
        endDate: { lte: now },
      },
      data: { isActive: false },
    });

    if (endedChallenges.count > 0) {
      this.logger.log(`Deactivated ${endedChallenges.count} ended challenges`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateLeaderboards(): Promise<void> {
    const activeChallenges = await this.prisma.challenge.findMany({
      where: { isActive: true },
      include: { submissions: true },
    });

    for (const challenge of activeChallenges) {
      // Recalculate ranks
      const sortedSubmissions = challenge.submissions.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.submittedAt.getTime() - b.submittedAt.getTime();
      });

      // Update ranks
      for (let i = 0; i < sortedSubmissions.length; i++) {
        await this.prisma.challengeSubmission.update({
          where: { id: sortedSubmissions[i].id },
          data: { rank: i + 1 },
        });
      }
    }

    this.logger.log(`Updated leaderboards for ${activeChallenges.length} active challenges`);
  }

  private async scoreSubmission(
    challenge: any,
    prompt: string,
    output: string,
    model: string,
    metadata?: any,
  ): Promise<ChallengeScoringResult> {
    // Analyze the prompt
    const analysis = await this.promptAnalysisService.analyzePrompt({
      rawUserPrompt: prompt,
      userId: 'challenge-submission',
    });

    // Apply rules to get improvement suggestions
    const ruleResults = await this.rulesEngine.applyRules(
      { rawUserPrompt: prompt },
      analysis
    );

    // Calculate individual scores based on challenge rubric
    const rubric = challenge.rubric as any;
    const scores = {
      accuracy: this.scoreAccuracy(prompt, output, challenge, metadata),
      creativity: this.scoreCreativity(prompt, output, analysis),
      efficiency: this.scoreEfficiency(metadata?.tokenCount, metadata?.executionTime, challenge),
      safety: this.scoreSafety(analysis, ruleResults),
      adherence: this.scoreAdherence(prompt, challenge.requirements, analysis),
    };

    // Calculate weighted total score
    const totalScore = Object.entries(this.scoringWeights).reduce(
      (total, [criteria, weight]) => total + (scores[criteria] * weight),
      0
    );

    // Generate feedback
    const feedback = this.generateSubmissionFeedback(scores, ruleResults, challenge);

    return {
      totalScore: Math.round(totalScore),
      breakdown: scores,
      feedback,
      improvements: ruleResults.filter(r => r.priority === 'high').map(r => r.improvements).flat(),
    };
  }

  private scoreAccuracy(prompt: string, output: string, challenge: any, metadata?: any): number {
    let score = 70; // Base score

    // Check if output matches expected format/requirements
    const requirements = challenge.requirements || {};
    
    if (requirements.outputFormat) {
      if (this.matchesFormat(output, requirements.outputFormat)) {
        score += 20;
      } else {
        score -= 15;
      }
    }

    if (requirements.minLength && output.length >= requirements.minLength) {
      score += 10;
    } else if (requirements.minLength) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  private scoreCreativity(prompt: string, output: string, analysis: any): number {
    let score = 60; // Base score

    // Check for creative elements in prompt
    const creativityIndicators = ['creative', 'innovative', 'unique', 'original', 'imaginative'];
    const hasCreativeLanguage = creativityIndicators.some(word => 
      prompt.toLowerCase().includes(word)
    );

    if (hasCreativeLanguage) score += 15;

    // Check prompt complexity as creativity indicator
    if (analysis.complexity?.score > 3) score += 15;
    if (analysis.structure?.hasExamples) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  private scoreEfficiency(tokenCount?: number, executionTime?: number, challenge?: any): number {
    let score = 70; // Base score

    // Token efficiency (reward concise but effective prompts)
    if (tokenCount) {
      if (tokenCount < 200) score += 15; // Very concise
      else if (tokenCount < 500) score += 10; // Reasonably concise
      else if (tokenCount > 1000) score -= 10; // Too verbose
    }

    // Execution time efficiency
    if (executionTime) {
      if (executionTime < 5000) score += 10; // Fast execution
      else if (executionTime > 30000) score -= 10; // Slow execution
    }

    return Math.max(0, Math.min(100, score));
  }

  private scoreSafety(analysis: any, ruleResults: any[]): number {
    let score = 90; // High base score for safety

    // Deduct for safety issues
    if (analysis.safety?.hasPII) score -= 30;
    if (analysis.safety?.hasHarmfulContent) score -= 50;
    if (analysis.safety?.hasInappropriateInstructions) score -= 40;

    // Deduct for safety rule violations
    const safetyRules = ruleResults.filter(r => r.category === 'safety');
    safetyRules.forEach(rule => {
      if (rule.priority === 'high') score -= 20;
      else score -= 10;
    });

    return Math.max(0, Math.min(100, score));
  }

  private scoreAdherence(prompt: string, requirements: any, analysis: any): number {
    let score = 60; // Base score

    // Check adherence to specific requirements
    if (requirements.hasRole && analysis.structure?.hasRole) score += 15;
    if (requirements.hasConstraints && analysis.structure?.hasConstraints) score += 15;
    if (requirements.hasFormat && analysis.structure?.hasFormat) score += 15;

    // Check for forbidden elements
    if (requirements.forbiddenWords) {
      const hasForbidden = requirements.forbiddenWords.some(word => 
        prompt.toLowerCase().includes(word.toLowerCase())
      );
      if (hasForbidden) score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  private generateSubmissionFeedback(scores: any, ruleResults: any[], challenge: any): any {
    const feedback = {
      overall: '',
      strengths: [],
      improvements: [],
      nextSteps: [],
    };

    // Overall feedback
    const totalScore = Object.entries(this.scoringWeights).reduce(
      (total, [criteria, weight]) => total + (scores[criteria] * weight),
      0
    );

    if (totalScore >= 80) {
      feedback.overall = 'Excellent submission! Your prompt demonstrates strong engineering skills.';
    } else if (totalScore >= 60) {
      feedback.overall = 'Good submission with room for improvement. Focus on the areas highlighted below.';
    } else {
      feedback.overall = 'Your submission shows potential. Consider the improvement suggestions to enhance your prompt engineering skills.';
    }

    // Identify strengths
    Object.entries(scores).forEach(([criteria, score]) => {
      if (score >= 80) {
        feedback.strengths.push(this.getCriteriaStrengthMessage(criteria, score));
      }
    });

    // Identify improvements from rule results
    const highPriorityRules = ruleResults.filter(r => r.priority === 'high');
    highPriorityRules.forEach(rule => {
      feedback.improvements.push(...rule.improvements);
    });

    // Generate next steps
    feedback.nextSteps = this.generateNextSteps(scores, challenge);

    return feedback;
  }

  private async calculateSubmissionRank(challengeId: string, score: number): Promise<number> {
    const betterSubmissions = await this.prisma.challengeSubmission.count({
      where: {
        challengeId,
        score: { gt: score },
      },
    });

    return betterSubmissions + 1;
  }

  private calculateSubmissionPoints(challenge: any, score: number, rank: number): number {
    const basePoints = challenge.points || 100;
    const scoreMultiplier = score / 100;
    const rankBonus = Math.max(0, 11 - rank) * 10; // Bonus for top 10

    return Math.round(basePoints * scoreMultiplier + rankBonus);
  }

  private generateDefaultRubric(category: string): any {
    const baseRubric = {
      accuracy: { weight: 0.4, description: 'How well the prompt achieves its intended purpose' },
      creativity: { weight: 0.2, description: 'Innovation and creative approach in prompt design' },
      efficiency: { weight: 0.2, description: 'Token efficiency and execution speed' },
      safety: { weight: 0.1, description: 'Safety and ethical considerations' },
      adherence: { weight: 0.1, description: 'Following challenge requirements and constraints' },
    };

    // Customize rubric based on category
    if (category === 'creativity') {
      baseRubric.creativity.weight = 0.3;
      baseRubric.accuracy.weight = 0.3;
    } else if (category === 'speed') {
      baseRubric.efficiency.weight = 0.4;
      baseRubric.accuracy.weight = 0.3;
    } else if (category === 'safety') {
      baseRubric.safety.weight = 0.3;
      baseRubric.accuracy.weight = 0.3;
    }

    return baseRubric;
  }

  private enrichChallengeDetails(challenge: any): ChallengeWithDetails {
    const now = new Date();
    const isActive = challenge.isActive && challenge.endDate > now;
    const hasStarted = challenge.startDate <= now;
    const hasEnded = challenge.endDate <= now;

    return {
      ...challenge,
      status: hasEnded ? 'ended' : isActive ? 'active' : hasStarted ? 'ended' : 'upcoming',
      timeRemaining: challenge.endDate > now ? challenge.endDate.getTime() - now.getTime() : 0,
      daysRemaining: Math.ceil((challenge.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      participationRate: challenge.participantCount > 0 ? (challenge.submissionCount / challenge.participantCount) * 100 : 0,
      averageScore: challenge.submissions?.length > 0 
        ? challenge.submissions.reduce((sum, s) => sum + s.score, 0) / challenge.submissions.length 
        : 0,
      topScore: challenge.submissions?.length > 0 
        ? Math.max(...challenge.submissions.map(s => s.score)) 
        : 0,
      estimatedDuration: this.estimateChallengeDuration(challenge),
      tags: this.generateChallengeTags(challenge),
    };
  }

  private buildSortOptions(sortBy: string): any {
    switch (sortBy) {
      case 'popular':
        return [{ participantCount: 'desc' }, { submissionCount: 'desc' }];
      case 'recent':
        return { startDate: 'desc' };
      case 'ending':
        return { endDate: 'asc' };
      case 'points':
        return { points: 'desc' };
      case 'difficulty':
        return [{ difficulty: 'desc' }, { points: 'desc' }];
      default: // relevance
        return [{ isFeatured: 'desc' }, { participantCount: 'desc' }];
    }
  }

  private async getSearchFacets(baseWhere: any): Promise<any> {
    const [types, categories, difficulties] = await Promise.all([
      this.prisma.challenge.groupBy({
        by: ['type'],
        where: baseWhere,
        _count: { id: true },
      }),
      this.prisma.challenge.groupBy({
        by: ['category'],
        where: baseWhere,
        _count: { id: true },
      }),
      this.prisma.challenge.groupBy({
        by: ['difficulty'],
        where: baseWhere,
        _count: { id: true },
      }),
    ]);

    return {
      types: types.map(t => ({ name: t.type, count: t._count.id })),
      categories: categories.map(c => ({ name: c.category, count: c._count.id })),
      difficulties: difficulties.map(d => ({ name: d.difficulty, count: d._count.id })),
    };
  }

  private getSuggestedDifficulty(skillScore: number): string {
    if (skillScore < 30) return 'easy';
    if (skillScore < 60) return 'medium';
    if (skillScore < 80) return 'hard';
    return 'expert';
  }

  private difficultyToNumber(difficulty: string): number {
    const mapping = { easy: 1, medium: 2, hard: 3, expert: 4 };
    return mapping[difficulty] || 2;
  }

  private generateRecommendationReason(challenge: any, categoryMatch: boolean, difficultyMatch: boolean): string {
    const reasons = [];
    
    if (categoryMatch) reasons.push(`matches your interest in ${challenge.category}`);
    if (difficultyMatch) reasons.push(`suitable difficulty level`);
    if (challenge.participantCount > 50) reasons.push('popular challenge');
    if (challenge.points > 200) reasons.push('high reward potential');

    return reasons.length > 0 ? reasons.join(', ') : 'recommended for you';
  }

  private matchesFormat(output: string, expectedFormat: string): boolean {
    switch (expectedFormat.toLowerCase()) {
      case 'json':
        try { JSON.parse(output); return true; } catch { return false; }
      case 'markdown':
        return output.includes('#') || output.includes('**') || output.includes('*');
      case 'list':
        return output.includes('1.') || output.includes('-') || output.includes('•');
      default:
        return true; // Default to true for unrecognized formats
    }
  }

  private getCriteriaStrengthMessage(criteria: string, score: number): string {
    const messages = {
      accuracy: 'Excellent prompt accuracy and effectiveness',
      creativity: 'Creative and innovative approach',
      efficiency: 'Highly efficient prompt design',
      safety: 'Strong safety and ethical considerations',
      adherence: 'Perfect adherence to requirements',
    };

    return messages[criteria] || `Strong ${criteria} performance`;
  }

  private generateNextSteps(scores: any, challenge: any): string[] {
    const steps = [];

    if (scores.accuracy < 60) {
      steps.push('Focus on making your prompt more specific and goal-oriented');
    }
    if (scores.creativity < 60) {
      steps.push('Try incorporating more creative and innovative elements');
    }
    if (scores.efficiency < 60) {
      steps.push('Work on making your prompts more concise and token-efficient');
    }
    if (scores.safety < 80) {
      steps.push('Review your prompt for safety and ethical considerations');
    }

    if (steps.length === 0) {
      steps.push('Continue practicing with more challenging prompts');
      steps.push('Explore advanced prompt engineering techniques');
    }

    return steps;
  }

  private estimateChallengeDuration(challenge: any): number {
    // Base estimate on difficulty and category
    const baseDuration = 30; // minutes
    const difficultyMultiplier = this.difficultyMultipliers[challenge.difficulty] || 1;
    
    return Math.round(baseDuration * difficultyMultiplier);
  }

  private generateChallengeTags(challenge: any): string[] {
    const tags = [challenge.category, challenge.difficulty];
    
    if (challenge.type) tags.push(challenge.type);
    if (challenge.points > 200) tags.push('high-reward');
    if (challenge.participantCount > 100) tags.push('popular');
    
    return tags;
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}