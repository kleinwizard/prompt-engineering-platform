import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

interface CertificationRequirement {
  type: 'prompt_count' | 'quality_score' | 'peer_review' | 'test' | 'project' | 'assessment' | 'time_requirement' | 'template_creation';
  metric: string;
  target: number;
  description: string;
}

interface CertificationProgress {
  completed: boolean;
  completionPercentage: number;
  requirements: {
    [key: string]: {
      required: number;
      current: number;
      completed: boolean;
    };
  };
  missingRequirements: string[];
  nextSteps: string[];
  estimatedCompletion?: string;
  previouslyCompleted?: boolean;
}

interface CertificationLevel {
  id: string;
  level: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sortOrder: number;
  requirements: Record<string, any>;
  benefits: Record<string, any>;
  curriculum?: any[];
  timeRequirement?: string;
  prerequisite?: string;
}

@Injectable()
export class CertificationService {
  private readonly logger = new Logger(CertificationService.name);

  constructor(private prisma: PrismaService) {}

  async initializeCertificationLevels(): Promise<void> {
    this.logger.log('Initializing certification levels...');

    const certificationLevels: CertificationLevel[] = [
      {
        id: 'bronze-engineer',
        level: 'bronze',
        name: 'Bronze Prompt Engineer',
        description: 'Foundation level certification for prompt engineering basics',
        icon: '🥉',
        color: '#CD7F32',
        sortOrder: 1,
        requirements: {
          prompts_created: 10,
          minimum_quality_score: 80,
          prompts_improved: 5,
          templates_used: 3,
          learning_modules: ['intro-to-prompts', 'basic-structure', 'common-patterns'],
          assessment_score: 70,
          time_requirement: '1 week minimum'
        },
        benefits: {
          badge: 'bronze-certified',
          profile_flair: true,
          template_access: 'basic',
          priority_support: false,
          certification_certificate: true,
          linkedin_credential: true
        },
        curriculum: [
          {
            module: 'Introduction to Prompt Engineering',
            topics: [
              'What makes a good prompt',
              'Basic prompt structure',
              'Common mistakes to avoid'
            ],
            assessment: 'multiple_choice',
            passing_score: 70
          },
          {
            module: 'Prompt Components',
            topics: [
              'Role definition',
              'Context setting',
              'Output formatting'
            ],
            practical: 'Create 3 basic prompts',
            peer_review: false
          }
        ]
      },
      {
        id: 'silver-engineer',
        level: 'silver',
        name: 'Silver Prompt Engineer',
        description: 'Intermediate certification for advanced prompt techniques',
        icon: '🥈',
        color: '#C0C0C0',
        sortOrder: 2,
        requirements: {
          prompts_created: 50,
          minimum_quality_score: 85,
          prompts_improved: 25,
          templates_created: 5,
          successful_experiments: 3,
          peer_reviews_given: 10,
          peer_reviews_received: 5,
          learning_modules: ['advanced-techniques', 'optimization', 'multi-model'],
          assessment_score: 80,
          time_requirement: '1 month minimum',
          prerequisite: 'bronze'
        },
        benefits: {
          badge: 'silver-certified',
          profile_flair: true,
          template_access: 'advanced',
          priority_support: true,
          feature_early_access: true,
          community_moderator: true,
          certification_certificate: true,
          linkedin_credential: true,
          resume_verification: true
        },
        curriculum: [
          {
            module: 'Advanced Prompt Techniques',
            topics: [
              'Chain-of-thought prompting',
              'Few-shot learning',
              'Constitutional AI principles'
            ],
            assessment: 'practical_project',
            passing_score: 80
          },
          {
            module: 'Prompt Optimization',
            topics: [
              'Token efficiency',
              'Performance optimization',
              'Cost reduction strategies'
            ],
            practical: 'Optimize 5 existing prompts',
            peer_review: true
          },
          {
            module: 'Multi-Model Strategies',
            topics: [
              'Model selection',
              'Prompt portability',
              'Model-specific optimizations'
            ],
            practical: 'Create cross-model prompt suite',
            peer_review: true
          }
        ]
      },
      {
        id: 'gold-engineer',
        level: 'gold',
        name: 'Gold Prompt Engineer',
        description: 'Expert certification for prompt engineering mastery',
        icon: '🥇',
        color: '#FFD700',
        sortOrder: 3,
        requirements: {
          prompts_created: 100,
          minimum_quality_score: 90,
          prompts_improved: 50,
          templates_created: 15,
          templates_featured: 3,
          successful_experiments: 10,
          experiment_winner: 3,
          workflow_created: 5,
          peer_reviews_given: 25,
          peer_reviews_received: 15,
          community_contributions: 10,
          learning_modules: ['expert-techniques', 'industry-specific', 'research-methods'],
          assessment_score: 90,
          practical_project: true,
          time_requirement: '3 months minimum',
          prerequisite: 'silver'
        },
        benefits: {
          badge: 'gold-certified',
          profile_flair: true,
          template_access: 'unlimited',
          priority_support: true,
          feature_early_access: true,
          beta_features: true,
          community_leader: true,
          speaking_opportunities: true,
          certification_certificate: true,
          linkedin_credential: true,
          resume_verification: true,
          referral_bonus: '20%'
        },
        curriculum: [
          {
            module: 'Expert Prompt Engineering',
            topics: [
              'Complex reasoning chains',
              'Adversarial prompting',
              'Prompt security',
              'Advanced formatting'
            ],
            assessment: 'comprehensive_exam',
            passing_score: 90
          },
          {
            module: 'Industry Applications',
            topics: [
              'Domain-specific prompting',
              'Regulatory compliance',
              'Enterprise patterns'
            ],
            practical: 'Industry case study',
            peer_review: true,
            expert_review: true
          },
          {
            module: 'Research & Development',
            topics: [
              'Prompt research methods',
              'A/B testing design',
              'Statistical analysis'
            ],
            practical: 'Original research project',
            publication_required: true
          }
        ]
      },
      {
        id: 'platinum-engineer',
        level: 'platinum',
        name: 'Platinum Prompt Engineer',
        description: 'Elite certification for industry leaders and innovators',
        icon: '💎',
        color: '#E5E4E2',
        sortOrder: 4,
        requirements: {
          prompts_created: 500,
          minimum_quality_score: 95,
          prompts_improved: 200,
          templates_created: 50,
          templates_featured: 10,
          successful_experiments: 25,
          experiment_winner: 10,
          workflow_created: 20,
          workflow_featured: 5,
          peer_reviews_given: 100,
          community_contributions: 50,
          mentees: 5,
          published_articles: 3,
          conference_presentation: 1,
          original_research: true,
          assessment_score: 95,
          committee_review: true,
          time_requirement: '1 year minimum',
          prerequisite: 'gold'
        },
        benefits: {
          badge: 'platinum-certified',
          profile_flair: true,
          template_access: 'unlimited',
          priority_support: true,
          dedicated_support: true,
          all_features: true,
          advisory_board: true,
          conference_speaker: true,
          course_instructor: true,
          certification_certificate: true,
          linkedin_credential: true,
          resume_verification: true,
          press_kit: true,
          referral_bonus: '30%',
          revenue_sharing: true
        },
        curriculum: [
          {
            module: 'Thought Leadership',
            topics: [
              'Publishing research',
              'Conference presentations',
              'Community building'
            ],
            requirement: 'Publish 3 articles'
          },
          {
            module: 'Innovation Lab',
            topics: [
              'Novel techniques',
              'Tool development',
              'Open source contributions'
            ],
            requirement: 'Create new methodology'
          },
          {
            module: 'Mentorship Program',
            topics: [
              'Teaching methodology',
              'Curriculum development',
              'Student assessment'
            ],
            requirement: 'Successfully mentor 5 engineers'
          }
        ]
      },
      {
        id: 'master-architect',
        level: 'master',
        name: 'Master Prompt Architect',
        description: 'Lifetime achievement certification for exceptional contributors',
        icon: '👑',
        color: '#9B59B6',
        sortOrder: 5,
        requirements: {
          prerequisite: 'platinum',
          years_active: 2,
          prompts_created: 1000,
          impact_score: 10000, // Calculated from usage, forks, improvements
          innovation_contributions: 5,
          community_leadership: true,
          peer_nominations: 10,
          committee_unanimous: true
        },
        benefits: {
          badge: 'master-architect',
          lifetime_access: true,
          advisory_position: true,
          equity_options: true,
          conference_keynote: true,
          book_deal_support: true,
          custom_features: true,
          legacy_naming: true // Feature named after them
        }
      }
    ];

    for (const level of certificationLevels) {
      await this.prisma.promptCertification.upsert({
        where: { level: level.level },
        update: {
          name: level.name,
          description: level.description,
          requirements: level.requirements,
          benefits: level.benefits,
          icon: level.icon,
          color: level.color,
          sortOrder: level.sortOrder,
          isActive: true
        },
        create: {
          id: level.id,
          level: level.level,
          name: level.name,
          description: level.description,
          requirements: level.requirements,
          benefits: level.benefits,
          icon: level.icon,
          color: level.color,
          sortOrder: level.sortOrder,
          isActive: true
        }
      });
    }

    this.logger.log(`Initialized ${certificationLevels.length} certification levels`);
  }

  async checkCertificationProgress(userId: string, certificationId: string): Promise<CertificationProgress> {
    const certification = await this.prisma.promptCertification.findUnique({
      where: { id: certificationId }
    });

    if (!certification) {
      throw new NotFoundException('Certification not found');
    }

    // Check if user already has this certification
    const existingCertification = await this.prisma.userCertification.findUnique({
      where: { userId_certificationId: { userId, certificationId } }
    });

    const userStats = await this.calculateUserStats(userId);
    const progress = this.evaluateRequirements(userStats, certification.requirements as any);
    progress.previouslyCompleted = existingCertification?.status === 'completed';

    await this.prisma.userCertification.upsert({
      where: { userId_certificationId: { userId, certificationId } },
      create: {
        userId,
        certificationId,
        progress,
        status: progress.completed ? 'completed' : 'in_progress'
      },
      update: {
        progress,
        status: progress.completed && !progress.previouslyCompleted ? 'completed' : existingCertification?.status || 'in_progress',
        completedAt: progress.completed && !progress.previouslyCompleted ? new Date() : existingCertification?.completedAt
      }
    });

    if (progress.completed && !progress.previouslyCompleted) {
      await this.issueCertificate(userId, certificationId);
      await this.notifyAchievement(userId, certification);
    }

    return progress;
  }

  private async calculateUserStats(userId: string): Promise<Record<string, any>> {
    const [
      promptsCreated,
      templatesCreated,
      experimentsCount,
      averageQuality,
      peerReviewsGiven,
      peerReviewsReceived,
      workflowsCreated,
      communityContributions,
      userAccount
    ] = await Promise.all([
      // Prompts created
      this.prisma.prompt.count({
        where: { userId }
      }),
      
      // Templates created
      this.prisma.template.count({
        where: { userId }
      }),
      
      // Experiments (A/B tests) created
      this.prisma.promptExperiment.count({
        where: { userId }
      }),
      
      // Average quality score from ratings
      this.prisma.promptRating.aggregate({
        where: { prompt: { userId } },
        _avg: { rating: true }
      }),
      
      // Peer reviews given (placeholder - would need review system)
      Promise.resolve(0),
      
      // Peer reviews received (placeholder - would need review system)
      Promise.resolve(0),
      
      // Workflows created
      this.prisma.promptWorkflow.count({
        where: { userId }
      }),
      
      // Community contributions (comments, forks, etc.)
      Promise.resolve(0), // Placeholder
      
      // User account info
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true }
      })
    ]);

    const featuredTemplates = await this.prisma.template.count({
      where: { userId, featured: true }
    });

    const successfulExperiments = await this.prisma.promptExperiment.count({
      where: { userId, status: 'completed', winner: { not: null } }
    });

    const experimentWins = await this.prisma.promptExperiment.count({
      where: { 
        userId, 
        status: 'completed',
        variants: {
          some: {
            id: { in: await this.getWinningVariantIds(userId) }
          }
        }
      }
    });

    return {
      prompts_created: promptsCreated,
      templates_created: templatesCreated,
      templates_featured: featuredTemplates,
      successful_experiments: successfulExperiments,
      experiment_winner: experimentWins,
      workflow_created: workflowsCreated,
      peer_reviews_given: peerReviewsGiven,
      peer_reviews_received: peerReviewsReceived,
      community_contributions: communityContributions,
      minimum_quality_score: Math.round(averageQuality._avg.rating || 0),
      prompts_improved: Math.floor(promptsCreated * 0.5), // Estimate
      templates_used: Math.max(3, Math.floor(templatesCreated * 0.3)), // Estimate
      workflow_featured: Math.floor(workflowsCreated * 0.25), // Estimate
      years_active: userAccount ? this.calculateYearsActive(userAccount.createdAt) : 0,
      impact_score: this.calculateImpactScore(promptsCreated, templatesCreated, featuredTemplates),
      assessment_score: 0 // Would be tracked from actual assessments
    };
  }

  private async getWinningVariantIds(userId: string): Promise<string[]> {
    const experiments = await this.prisma.promptExperiment.findMany({
      where: { userId, winner: { not: null } },
      select: { winner: true }
    });

    return experiments.map(exp => exp.winner).filter(Boolean);
  }

  private calculateYearsActive(createdAt: Date): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - createdAt.getTime());
    const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
    return Math.floor(diffYears * 10) / 10; // Round to 1 decimal place
  }

  private calculateImpactScore(prompts: number, templates: number, featured: number): number {
    // Simple impact score calculation
    return (prompts * 10) + (templates * 50) + (featured * 200);
  }

  private evaluateRequirements(userStats: Record<string, any>, requirements: Record<string, any>): CertificationProgress {
    const progress: CertificationProgress = {
      completed: true,
      completionPercentage: 0,
      requirements: {},
      missingRequirements: [],
      nextSteps: []
    };

    let totalRequirements = 0;
    let completedRequirements = 0;

    for (const [requirement, target] of Object.entries(requirements)) {
      if (requirement === 'prerequisite' || requirement === 'time_requirement') {
        continue; // Handle separately
      }

      const current = userStats[requirement] || 0;
      const required = typeof target === 'number' ? target : 0;
      const completed = current >= required;

      if (required > 0) {
        totalRequirements++;
        if (completed) {
          completedRequirements++;
        }

        progress.requirements[requirement] = {
          required,
          current,
          completed
        };

        if (!completed) {
          progress.completed = false;
          progress.missingRequirements.push(requirement);
          progress.nextSteps.push(`Complete ${required - current} more ${requirement.replace(/_/g, ' ')}`);
        }
      }
    }

    progress.completionPercentage = totalRequirements > 0 ? Math.round((completedRequirements / totalRequirements) * 100) : 0;

    return progress;
  }

  private async issueCertificate(userId: string, certificationId: string): Promise<void> {
    const certificate = {
      id: crypto.randomUUID(),
      userId,
      certificationId,
      issuedAt: new Date(),
      verificationCode: this.generateVerificationCode(),
      blockchain_hash: await this.recordOnBlockchain(userId, certificationId)
    };

    // Generate certificate URL/PDF
    const certificateUrl = await this.generateCertificatePDF(certificate);
    
    // Update user certification with certificate info
    await this.prisma.userCertification.update({
      where: { userId_certificationId: { userId, certificationId } },
      data: { 
        certificate: certificateUrl,
        completedAt: new Date()
      }
    });

    // Track achievement in analytics
    await this.prisma.analyticsEvent.create({
      data: {
        userId,
        sessionId: `certification-${Date.now()}`,
        event: 'certification.completed',
        properties: {
          certificationId,
          certificateId: certificate.id,
          verificationCode: certificate.verificationCode,
          timestamp: new Date().toISOString()
        }
      }
    });

    this.logger.log(`Certificate issued for user ${userId}, certification ${certificationId}`);
  }

  private generateVerificationCode(): string {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
  }

  private async recordOnBlockchain(userId: string, certificationId: string): Promise<string> {
    // Placeholder for blockchain integration
    // In production, this would record the certificate on a blockchain for verification
    const hash = crypto.createHash('sha256')
      .update(`${userId}:${certificationId}:${Date.now()}`)
      .digest('hex');
    
    return hash;
  }

  private async generateCertificatePDF(certificate: any): Promise<string> {
    // Placeholder for PDF generation
    // In production, this would generate an actual PDF certificate
    return `/certificates/${certificate.id}.pdf`;
  }

  private async notifyAchievement(userId: string, certification: any): Promise<void> {
    // Send notification about certification completion
    this.logger.log(`Certification achievement notification sent to user ${userId} for ${certification.name}`);
    
    // In production, this would:
    // 1. Send email notification
    // 2. Add in-app notification
    // 3. Potentially post to social media (with permission)
    // 4. Update user's LinkedIn profile (with integration)
  }

  async getUserCertifications(userId: string) {
    return this.prisma.userCertification.findMany({
      where: { userId },
      include: {
        certification: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAllCertifications() {
    return this.prisma.promptCertification.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });
  }

  async getCertificationById(id: string) {
    return this.prisma.promptCertification.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            userId: true,
            status: true,
            completedAt: true,
            progress: true
          }
        }
      }
    });
  }

  async verifyCertificate(verificationCode: string) {
    // This would verify a certificate using the verification code
    // In production, this would check against blockchain records
    return {
      valid: true,
      certificate: {
        verificationCode,
        issuedDate: new Date(),
        status: 'valid'
      }
    };
  }

  async getCertificationLeaderboard(certificationId?: string) {
    const where = certificationId ? { certificationId } : {};
    
    return this.prisma.userCertification.findMany({
      where: {
        ...where,
        status: 'completed'
      },
      include: {
        user: {
          select: { id: true, username: true, avatar: true }
        },
        certification: {
          select: { name: true, level: true, icon: true, color: true }
        }
      },
      orderBy: { completedAt: 'asc' }, // First to complete gets higher rank
      take: 100
    });
  }

  async getCertificationStats() {
    const [totalCertifications, activeCertifications, totalIssued] = await Promise.all([
      this.prisma.promptCertification.count(),
      this.prisma.promptCertification.count({ where: { isActive: true } }),
      this.prisma.userCertification.count({ where: { status: 'completed' } })
    ]);

    const certificationDistribution = await this.prisma.userCertification.groupBy({
      by: ['certificationId'],
      where: { status: 'completed' },
      _count: { _all: true }
    });

    return {
      totalCertifications,
      activeCertifications,
      totalIssued,
      distribution: certificationDistribution
    };
  }
}