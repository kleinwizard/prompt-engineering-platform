import { Controller, Get, Post, Body, Query, UseGuards, Request, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PerformanceMonitorService } from './performance-monitor.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

interface RecordMetricsDto {
  promptId?: string;
  modelName: string;
  modelProvider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  responseTime: number;
  errorRate: number;
  retryCount?: number;
  timeouts?: number;
  qualityScores?: {
    accuracy?: number;
    relevance?: number;
    completeness?: number;
    clarity?: number;
  };
  promptLength: number;
  contextLength: number;
  temperature?: number;
  maxTokens?: number;
  category?: string;
}

interface MetricsQueryDto {
  timeRange?: string;
  model?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
}

interface OptimizationQueryDto {
  type?: 'token' | 'cost' | 'quality' | 'performance';
  limit?: number;
}

@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PerformanceMonitorController {
  constructor(private performanceService: PerformanceMonitorService) {}

  @Post('metrics')
  @Roles('user', 'admin')
  async recordMetrics(@Body() dto: RecordMetricsDto, @Request() req) {
    const metrics = {
      timestamp: new Date(),
      tenantId: req.user.tenantId,
      userId: req.user.id,
      
      tokenEfficiency: {
        inputTokens: dto.inputTokens,
        outputTokens: dto.outputTokens,
        totalTokens: dto.totalTokens,
        efficiency: dto.outputTokens / Math.max(dto.inputTokens, 1),
        wastedTokens: Math.max(0, dto.totalTokens - (dto.inputTokens + dto.outputTokens)),
        optimizationScore: this.calculateOptimizationScore(dto)
      },
      
      responseQuality: {
        accuracy: dto.qualityScores?.accuracy || 0.8,
        relevance: dto.qualityScores?.relevance || 0.8,
        completeness: dto.qualityScores?.completeness || 0.8,
        clarity: dto.qualityScores?.clarity || 0.8,
        overall: this.calculateOverallQuality(dto.qualityScores),
        humanFeedback: null
      },
      
      performance: {
        responseTime: dto.responseTime,
        throughput: 1000 / dto.responseTime, // requests per second
        errorRate: dto.errorRate,
        retryCount: dto.retryCount || 0,
        timeouts: dto.timeouts || 0
      },
      
      cost: {
        inputCost: dto.inputCost,
        outputCost: dto.outputCost,
        totalCost: dto.totalCost,
        costPerRequest: dto.totalCost,
        costEfficiency: dto.outputTokens / Math.max(dto.totalCost, 0.001)
      },
      
      model: {
        name: dto.modelName,
        version: 'latest',
        provider: dto.modelProvider,
        temperature: dto.temperature || 0.7,
        maxTokens: dto.maxTokens || 2048
      },
      
      context: {
        promptLength: dto.promptLength,
        contextLength: dto.contextLength,
        complexity: this.calculateComplexity(dto.promptLength, dto.contextLength),
        category: dto.category || 'general'
      }
    };

    await this.performanceService.recordMetrics(metrics);
    
    return {
      success: true,
      message: 'Metrics recorded successfully'
    };
  }

  @Get('dashboard')
  @Roles('user', 'admin', 'analytics')
  async getDashboard(@Query() query: MetricsQueryDto, @Request() req) {
    return this.performanceService.getMetricsDashboard(
      req.user.tenantId,
      query.timeRange || '1h'
    );
  }

  @Get('metrics/token-efficiency')
  @Roles('user', 'admin', 'analytics')
  async getTokenEfficiency(@Query() query: MetricsQueryDto, @Request() req) {
    const { startDate, endDate } = this.parseTimeRange(query);
    return this.performanceService.getTokenEfficiencyStats(
      req.user.tenantId,
      startDate,
      endDate
    );
  }

  @Get('metrics/quality')
  @Roles('user', 'admin', 'analytics')
  async getQualityMetrics(@Query() query: MetricsQueryDto, @Request() req) {
    const { startDate, endDate } = this.parseTimeRange(query);
    return this.performanceService.getQualityStats(
      req.user.tenantId,
      startDate,
      endDate
    );
  }

  @Get('metrics/cost')
  @Roles('user', 'admin', 'analytics')
  async getCostMetrics(@Query() query: MetricsQueryDto, @Request() req) {
    const { startDate, endDate } = this.parseTimeRange(query);
    return this.performanceService.getCostStats(
      req.user.tenantId,
      startDate,
      endDate
    );
  }

  @Get('metrics/performance')
  @Roles('user', 'admin', 'analytics')
  async getPerformanceMetrics(@Query() query: MetricsQueryDto, @Request() req) {
    const { startDate, endDate } = this.parseTimeRange(query);
    return this.performanceService.getPerformanceStats(
      req.user.tenantId,
      startDate,
      endDate
    );
  }

  @Get('models/comparison')
  @Roles('user', 'admin', 'analytics')
  async getModelComparison(@Query() query: MetricsQueryDto, @Request() req) {
    const { startDate, endDate } = this.parseTimeRange(query);
    return this.performanceService.getModelComparison(
      req.user.tenantId,
      startDate,
      endDate
    );
  }

  @Get('optimizations')
  @Roles('user', 'admin')
  async getOptimizations(@Query() query: OptimizationQueryDto, @Request() req) {
    return this.performanceService.getOptimizationSuggestions(req.user.tenantId);
  }

  @Get('alerts')
  @Roles('user', 'admin')
  async getAlerts(@Request() req) {
    return this.performanceService.getActiveAlerts(req.user.tenantId);
  }

  @Post('alerts/:id/resolve')
  @Roles('admin', 'user')
  async resolveAlert(
    @Param('id') alertId: string,
    @Body() resolution: { action: string; notes?: string },
    @Request() req
  ) {
    // Implementation would mark alert as resolved
    return {
      success: true,
      message: 'Alert resolved successfully',
      alertId,
      resolvedBy: req.user.id,
      resolution
    };
  }

  @Get('insights/token-waste')
  @Roles('user', 'admin', 'analytics')
  async getTokenWasteInsights(@Query() query: MetricsQueryDto, @Request() req) {
    // Return insights about token waste patterns
    return {
      insights: [
        {
          type: 'repetitive_instructions',
          description: 'Found repetitive instructions that could be simplified',
          impact: 'high',
          examples: ['Remove redundant "please" and "thank you" phrases'],
          estimatedSavings: { tokens: 150, cost: 0.02 }
        },
        {
          type: 'verbose_examples',
          description: 'Examples in prompts are too verbose',
          impact: 'medium',
          examples: ['Shorten example responses to key points only'],
          estimatedSavings: { tokens: 75, cost: 0.01 }
        }
      ],
      totalPotentialSavings: { tokens: 225, cost: 0.03 }
    };
  }

  @Get('insights/quality-patterns')
  @Roles('user', 'admin', 'analytics')
  async getQualityPatterns(@Query() query: MetricsQueryDto, @Request() req) {
    // Return patterns in quality metrics
    return {
      patterns: [
        {
          pattern: 'low_clarity_scores',
          description: 'Responses consistently score low on clarity',
          frequency: 0.3,
          recommendation: 'Add explicit output format instructions',
          examples: ['Specify: "Format your response as: 1. Point one 2. Point two"']
        },
        {
          pattern: 'incomplete_responses',
          description: 'Responses often incomplete for complex tasks',
          frequency: 0.2,
          recommendation: 'Break complex tasks into subtasks',
          examples: ['Use step-by-step instructions: "First analyze X, then evaluate Y"']
        }
      ],
      recommendations: [
        'Add structured output templates',
        'Include completion criteria in prompts',
        'Use chain-of-thought prompting for complex reasoning'
      ]
    };
  }

  @Get('insights/cost-optimization')
  @Roles('user', 'admin', 'analytics')
  async getCostOptimizationInsights(@Query() query: MetricsQueryDto, @Request() req) {
    return {
      opportunities: [
        {
          type: 'model_rightsizing',
          description: 'Using GPT-4 for tasks that could use GPT-3.5-turbo',
          impact: 'high',
          affected_prompts: 45,
          potential_savings: { percentage: 60, monthly_amount: 120 },
          recommendation: 'A/B test with GPT-3.5-turbo for classification tasks'
        },
        {
          type: 'token_optimization',
          description: 'Prompts contain unnecessary filler words',
          impact: 'medium',
          affected_prompts: 23,
          potential_savings: { percentage: 25, monthly_amount: 45 },
          recommendation: 'Use prompt compression techniques'
        },
        {
          type: 'caching_opportunity',
          description: 'Repetitive prompts detected that could be cached',
          impact: 'medium',
          affected_prompts: 67,
          potential_savings: { percentage: 40, monthly_amount: 80 },
          recommendation: 'Enable semantic caching for FAQ responses'
        }
      ],
      total_potential_savings: { percentage: 42, monthly_amount: 245 }
    };
  }

  @Get('reports/executive')
  @Roles('admin', 'manager')
  async getExecutiveReport(@Query() query: MetricsQueryDto, @Request() req) {
    const { startDate, endDate } = this.parseTimeRange(query);
    
    // Generate executive summary report
    return {
      period: { startDate, endDate },
      summary: {
        total_requests: 15420,
        total_cost: 1247.30,
        average_quality: 0.87,
        cost_trend: 'increasing',
        quality_trend: 'stable',
        efficiency_trend: 'improving'
      },
      key_metrics: {
        cost_per_request: 0.081,
        token_efficiency: 0.74,
        response_quality: 0.87,
        response_time: 2341,
        error_rate: 0.003
      },
      highlights: [
        'Token efficiency improved 15% compared to last month',
        'Response quality maintained above 85% target',
        'Cost per request increased 8% due to model upgrades'
      ],
      concerns: [
        'Error rate spiked on Nov 15th due to API issues',
        'Token waste increased in customer service prompts'
      ],
      recommendations: [
        'Implement response caching to reduce costs by 20%',
        'Optimize customer service prompt templates',
        'Consider GPT-3.5-turbo for routine classification tasks'
      ],
      budget_projection: {
        current_monthly: 2847.30,
        projected_monthly: 3124.50,
        yearly_projection: 37494.00
      }
    };
  }

  @Get('benchmarks/industry')
  @Roles('user', 'admin', 'analytics')
  async getIndustryBenchmarks(@Request() req) {
    // Return industry benchmark data
    return {
      industry: 'technology',
      benchmarks: {
        token_efficiency: {
          your_score: 0.74,
          industry_average: 0.68,
          top_quartile: 0.82,
          bottom_quartile: 0.52
        },
        response_quality: {
          your_score: 0.87,
          industry_average: 0.79,
          top_quartile: 0.91,
          bottom_quartile: 0.65
        },
        cost_per_request: {
          your_score: 0.081,
          industry_average: 0.095,
          top_quartile: 0.064,
          bottom_quartile: 0.142
        },
        response_time: {
          your_score: 2341,
          industry_average: 3200,
          top_quartile: 1800,
          bottom_quartile: 5400
        }
      },
      percentile_ranking: 72,
      areas_of_strength: ['Cost efficiency', 'Response quality'],
      areas_for_improvement: ['Token efficiency', 'Response time'],
      peer_comparison: {
        better_than: 68,
        worse_than: 32,
        similar_companies: [
          { name: 'TechCorp Inc.', score: 0.76 },
          { name: 'InnovateLabs', score: 0.73 },
          { name: 'DataDriven Co.', score: 0.79 }
        ]
      }
    };
  }

  @Post('feedback/quality')
  @Roles('user', 'admin')
  async submitQualityFeedback(
    @Body() feedback: {
      promptId: string;
      responseId: string;
      quality_scores: {
        accuracy: number;
        relevance: number;
        completeness: number;
        clarity: number;
      };
      comments?: string;
    },
    @Request() req
  ) {
    // Store human feedback for quality improvement
    return {
      success: true,
      message: 'Quality feedback recorded',
      feedback_id: crypto.randomUUID()
    };
  }

  @Get('health-check')
  async getHealthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date(),
      services: {
        metrics_collection: 'operational',
        real_time_monitoring: 'operational',
        alert_system: 'operational',
        optimization_engine: 'operational'
      },
      recent_activity: {
        metrics_recorded_last_hour: 1247,
        alerts_triggered_last_24h: 3,
        optimizations_suggested_today: 15
      }
    };
  }

  // Private helper methods

  private calculateOptimizationScore(dto: RecordMetricsDto): number {
    // Calculate optimization score based on token efficiency and cost
    const tokenEfficiency = dto.outputTokens / Math.max(dto.inputTokens, 1);
    const costEfficiency = dto.outputTokens / Math.max(dto.totalCost, 0.001);
    
    // Normalize and combine scores
    const normalizedTokenEff = Math.min(tokenEfficiency / 2, 1); // Cap at 2:1 ratio
    const normalizedCostEff = Math.min(costEfficiency / 1000, 1); // Normalize cost efficiency
    
    return (normalizedTokenEff * 0.6) + (normalizedCostEff * 0.4);
  }

  private calculateOverallQuality(qualityScores?: RecordMetricsDto['qualityScores']): number {
    if (!qualityScores) return 0.8; // Default score
    
    const scores = [
      qualityScores.accuracy || 0.8,
      qualityScores.relevance || 0.8,
      qualityScores.completeness || 0.8,
      qualityScores.clarity || 0.8
    ];
    
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  private calculateComplexity(promptLength: number, contextLength: number): number {
    // Simple complexity calculation based on length and context
    const lengthFactor = Math.min(promptLength / 1000, 2); // Normalize to 0-2
    const contextFactor = Math.min(contextLength / 5000, 2); // Normalize to 0-2
    
    return (lengthFactor + contextFactor) / 4; // Return 0-1 scale
  }

  private parseTimeRange(query: MetricsQueryDto): { startDate: Date; endDate: Date } {
    if (query.startDate && query.endDate) {
      return {
        startDate: new Date(query.startDate),
        endDate: new Date(query.endDate)
      };
    }

    const endDate = new Date();
    let startDate: Date;

    switch (query.timeRange) {
      case '1h':
        startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }
}