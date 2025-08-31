import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';

interface StatisticalResult {
  significant: boolean;
  pValue: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  winner?: string;
  effect: number;
}

@Injectable()
export class ABTestingService {
  private readonly logger = new Logger(ABTestingService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2
  ) {}

  async createExperiment(userId: string, dto: any) {
    // Validate variants sum to 100%
    const totalAllocation = dto.variants.reduce((sum: number, v: any) => sum + v.allocation, 0);
    if (Math.abs(totalAllocation - 1) > 0.001) {
      throw new BadRequestException('Variant allocations must sum to 100%');
    }

    return this.prisma.promptExperiment.create({
      data: {
        userId,
        name: dto.name,
        hypothesis: dto.hypothesis,
        sampleSize: dto.sampleSize,
        confidenceLevel: dto.confidenceLevel || 0.95,
        metrics: dto.metrics,
        variants: {
          create: dto.variants.map((variant: any) => ({
            name: variant.name,
            prompt: variant.prompt,
            allocation: variant.allocation
          }))
        }
      },
      include: {
        variants: true
      }
    });
  }

  async startExperiment(experimentId: string, userId: string) {
    const experiment = await this.prisma.promptExperiment.findUnique({
      where: { id: experimentId },
      include: { variants: true }
    });

    if (!experiment || experiment.userId !== userId) {
      throw new BadRequestException('Experiment not found or access denied');
    }

    if (experiment.status !== 'draft') {
      throw new BadRequestException('Experiment is not in draft status');
    }

    await this.prisma.promptExperiment.update({
      where: { id: experimentId },
      data: {
        status: 'running',
        startedAt: new Date()
      }
    });

    return { success: true, message: 'Experiment started' };
  }

  async getVariant(experimentId: string, userId: string): Promise<any> {
    const experiment = await this.prisma.promptExperiment.findUnique({
      where: { id: experimentId },
      include: { variants: true }
    });

    if (!experiment || experiment.status !== 'running') {
      throw new BadRequestException('Experiment not found or not running');
    }

    // Use consistent hashing for user assignment
    const hash = crypto.createHash('md5').update(`${experimentId}:${userId}`).digest('hex');
    const assignment = parseInt(hash.substring(0, 8), 16) / 0xffffffff;

    let cumulativeAllocation = 0;
    for (const variant of experiment.variants) {
      cumulativeAllocation += variant.allocation;
      if (assignment <= cumulativeAllocation) {
        // Record impression
        await this.recordImpression(variant.id, userId);
        return variant;
      }
    }

    // Fallback to first variant
    await this.recordImpression(experiment.variants[0].id, userId);
    return experiment.variants[0];
  }

  async recordImpression(variantId: string, userId: string) {
    await this.prisma.promptVariant.update({
      where: { id: variantId },
      data: { impressions: { increment: 1 } }
    });

    this.logger.debug(`Recorded impression for variant ${variantId} by user ${userId}`);
  }

  async recordConversion(
    variantId: string, 
    userId: string, 
    metrics: Record<string, number> = {}
  ) {
    const variant = await this.prisma.promptVariant.findUnique({
      where: { id: variantId },
      include: { 
        experiment: { 
          include: { variants: true, results: true } 
        } 
      }
    });

    if (!variant) {
      throw new BadRequestException('Variant not found');
    }

    // Record the conversion
    await this.prisma.$transaction([
      // Update variant stats
      this.prisma.promptVariant.update({
        where: { id: variantId },
        data: { 
          conversions: { increment: 1 },
          metrics: metrics
        }
      }),
      
      // Record experiment result
      this.prisma.promptExperimentResult.create({
        data: {
          experimentId: variant.experimentId,
          variantId,
          userId,
          converted: true,
          metrics
        }
      })
    ]);

    // Check for statistical significance
    await this.checkSignificance(variant.experimentId);

    this.logger.debug(`Recorded conversion for variant ${variantId} by user ${userId}`);
  }

  private async checkSignificance(experimentId: string) {
    const experiment = await this.prisma.promptExperiment.findUnique({
      where: { id: experimentId },
      include: { variants: true }
    });

    if (!experiment || experiment.status !== 'running') {
      return;
    }

    // Check if we have enough data
    const totalImpressions = experiment.variants.reduce((sum, v) => sum + v.impressions, 0);
    if (totalImpressions < experiment.sampleSize) {
      return;
    }

    // Perform statistical analysis
    const results = this.calculateStatisticalSignificance(experiment.variants, experiment.confidenceLevel);
    
    if (results.significant && results.winner) {
      await this.declareWinner(experimentId, results.winner, results);
    }
  }

  private calculateStatisticalSignificance(variants: any[], confidenceLevel: number): StatisticalResult {
    if (variants.length < 2) {
      return { significant: false, pValue: 1, confidenceInterval: { lower: 0, upper: 0 }, effect: 0 };
    }

    // For simplicity, comparing first two variants with Z-test for proportions
    const [control, treatment] = variants;
    
    const p1 = control.conversions / control.impressions;
    const p2 = treatment.conversions / treatment.impressions;
    
    const n1 = control.impressions;
    const n2 = treatment.impressions;
    
    // Pooled proportion
    const pooled = (control.conversions + treatment.conversions) / (n1 + n2);
    
    // Standard error
    const se = Math.sqrt(pooled * (1 - pooled) * (1/n1 + 1/n2));
    
    // Z-score
    const z = Math.abs(p2 - p1) / se;
    
    // P-value (two-tailed)
    const pValue = 2 * (1 - this.normalCDF(z));
    
    // Effect size (lift)
    const effect = p1 > 0 ? (p2 - p1) / p1 : 0;
    
    // Confidence interval for difference
    const criticalValue = this.normalInverse(1 - (1 - confidenceLevel) / 2);
    const margin = criticalValue * se;
    const diff = p2 - p1;
    
    const significant = pValue < (1 - confidenceLevel);
    const winner = significant ? (p2 > p1 ? treatment.id : control.id) : undefined;
    
    return {
      significant,
      pValue,
      confidenceInterval: {
        lower: diff - margin,
        upper: diff + margin
      },
      winner,
      effect
    };
  }

  private normalCDF(x: number): number {
    // Approximation of normal CDF
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    // Approximation of error function
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  private normalInverse(p: number): number {
    // Beasley-Springer-Moro algorithm for normal inverse
    const a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [0, -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [0, 7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    if (p < pLow || p > pHigh) {
      // Tail region
      const q = p < pLow ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
      const x = (((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5] * q + c[6];
      const y = ((d[1] * q + d[2]) * q + d[3]) * q + d[4];
      return p < pLow ? -(x / y) : x / y;
    } else {
      // Central region
      const q = p - 0.5;
      const r = q * q;
      const x = (((((a[1] * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * r + a[6]) * q;
      const y = ((((b[1] * r + b[2]) * r + b[3]) * r + b[4]) * r + b[5]) * r + 1;
      return x / y;
    }
  }

  private async declareWinner(experimentId: string, winnerId: string, _results: StatisticalResult) {
    await this.prisma.promptExperiment.update({
      where: { id: experimentId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        winner: winnerId
      }
    });

    this.logger.log(`Experiment ${experimentId} completed. Winner: ${winnerId}`);
    
    // Send experiment completion notification
    this.eventEmitter.emit('experiment.completed', {
      experimentId,
      winnerId,
      userId: (await this.prisma.promptExperiment.findUnique({ 
        where: { id: experimentId }, 
        select: { userId: true } 
      }))?.userId
    });
  }

  async getExperiments(userId: string) {
    return this.prisma.promptExperiment.findMany({
      where: { userId },
      include: {
        variants: true,
        _count: {
          select: { results: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getExperiment(experimentId: string, _userId: string) {
    const experiment = await this.prisma.promptExperiment.findUnique({
      where: { id: experimentId },
      include: {
        variants: true,
        results: {
          take: 100,
          orderBy: { timestamp: 'desc' }
        }
      }
    });

    if (!experiment) {
      throw new BadRequestException('Experiment not found');
    }

    // Calculate statistics
    const stats = await this.calculateExperimentStats(experimentId);

    return {
      ...experiment,
      stats
    };
  }

  private async calculateExperimentStats(experimentId: string) {
    const experiment = await this.prisma.promptExperiment.findUnique({
      where: { id: experimentId },
      include: { variants: true }
    });

    if (!experiment) return null;

    const stats = {
      totalImpressions: 0,
      totalConversions: 0,
      overallConversionRate: 0,
      variants: [] as any[]
    };

    for (const variant of experiment.variants) {
      const conversionRate = variant.impressions > 0 ? variant.conversions / variant.impressions : 0;
      
      stats.variants.push({
        id: variant.id,
        name: variant.name,
        impressions: variant.impressions,
        conversions: variant.conversions,
        conversionRate,
        confidence: variant.impressions > 30 ? this.calculateConfidence(variant.conversions, variant.impressions) : 0
      });

      stats.totalImpressions += variant.impressions;
      stats.totalConversions += variant.conversions;
    }

    stats.overallConversionRate = stats.totalImpressions > 0 ? stats.totalConversions / stats.totalImpressions : 0;

    return stats;
  }

  private calculateConfidence(conversions: number, impressions: number): number {
    if (impressions === 0) return 0;
    
    const p = conversions / impressions;
    const n = impressions;
    
    // Wilson score interval
    const z = 1.96; // 95% confidence
    const denominator = 1 + z * z / n;
    const centre = (p + z * z / (2 * n)) / denominator;
    const halfWidth = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
    
    return Math.max(0, Math.min(1, centre - halfWidth));
  }

  async stopExperiment(experimentId: string, userId: string) {
    const experiment = await this.prisma.promptExperiment.findUnique({
      where: { id: experimentId }
    });

    if (!experiment || experiment.userId !== userId) {
      throw new BadRequestException('Experiment not found or access denied');
    }

    await this.prisma.promptExperiment.update({
      where: { id: experimentId },
      data: {
        status: 'cancelled',
        completedAt: new Date()
      }
    });

    return { success: true, message: 'Experiment stopped' };
  }
}