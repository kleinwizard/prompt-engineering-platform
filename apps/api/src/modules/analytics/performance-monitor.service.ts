import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Cron, CronExpression } from '@nestjs/schedule';

interface PerformanceMetrics {
  timestamp: Date;
  tenantId?: string;
  userId?: string;
  
  // Token Efficiency Metrics
  tokenEfficiency: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    efficiency: number; // output/input ratio
    wastedTokens: number;
    optimizationScore: number;
  };
  
  // Response Quality Metrics
  responseQuality: {
    accuracy: number;
    relevance: number;
    completeness: number;
    clarity: number;
    overall: number;
    humanFeedback?: number;
  };
  
  // Performance Metrics
  performance: {
    responseTime: number;
    throughput: number;
    errorRate: number;
    retryCount: number;
    timeouts: number;
  };
  
  // Cost Metrics
  cost: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    costPerRequest: number;
    costEfficiency: number;
  };
  
  // Model Metrics
  model: {
    name: string;
    version: string;
    provider: string;
    temperature: number;
    maxTokens: number;
  };
  
  // Context Metrics
  context: {
    promptLength: number;
    contextLength: number;
    complexity: number;
    category: string;
  };
}

export interface PerformanceAlert {
  id: string;
  type: 'cost_spike' | 'quality_drop' | 'performance_degradation' | 'error_rate_high';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metrics: any;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  resolved: boolean;
}

export interface OptimizationSuggestion {
  type: 'token_optimization' | 'model_switch' | 'prompt_improvement' | 'caching';
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  estimatedSavings: {
    tokens?: number;
    cost?: number;
    time?: number;
  };
  implementation: string;
  examples?: string[];
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/performance'
})
export class PerformanceMonitorService {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PerformanceMonitorService.name);
  private readonly alertThresholds = {
    costPerRequest: 0.05,
    responseTime: 5000,
    errorRate: 0.05,
    qualityScore: 0.8,
    tokenEfficiency: 0.7
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService
  ) {}

  async recordMetrics(metrics: PerformanceMetrics): Promise<void> {
    try {
      // Store metrics in database
      await this.prisma.performanceMetrics.create({
        data: {
          timestamp: metrics.timestamp,
          tenantId: metrics.tenantId,
          userId: metrics.userId,
          tokenEfficiency: metrics.tokenEfficiency,
          responseQuality: metrics.responseQuality,
          performance: metrics.performance,
          cost: metrics.cost,
          model: metrics.model,
          context: metrics.context
        }
      });

      // Real-time broadcasting
      this.server.emit('metrics_update', {
        tenantId: metrics.tenantId,
        metrics: this.sanitizeMetricsForBroadcast(metrics)
      });

      // Check for alerts
      await this.checkAlerts(metrics);

      // Generate optimization suggestions
      const suggestions = await this.generateOptimizationSuggestions(metrics);
      if (suggestions.length > 0) {
        this.server.emit('optimization_suggestions', {
          tenantId: metrics.tenantId,
          suggestions
        });
      }

    } catch (error) {
      this.logger.error('Failed to record performance metrics:', error);
    }
  }

  async getMetricsDashboard(tenantId: string, timeRange: string = '1h') {
    const { startDate, endDate } = this.parseTimeRange(timeRange);

    const [
      realtimeMetrics,
      tokenEfficiencyStats,
      qualityStats,
      costStats,
      performanceStats,
      modelComparison,
      alerts,
      optimizationSuggestions
    ] = await Promise.all([
      this.getRealtimeMetrics(tenantId),
      this.getTokenEfficiencyStats(tenantId, startDate, endDate),
      this.getQualityStats(tenantId, startDate, endDate),
      this.getCostStats(tenantId, startDate, endDate),
      this.getPerformanceStats(tenantId, startDate, endDate),
      this.getModelComparison(tenantId, startDate, endDate),
      this.getActiveAlerts(tenantId),
      this.getOptimizationSuggestions(tenantId)
    ]);

    return {
      realtime: realtimeMetrics,
      tokenEfficiency: tokenEfficiencyStats,
      quality: qualityStats,
      cost: costStats,
      performance: performanceStats,
      modelComparison,
      alerts,
      optimizations: optimizationSuggestions,
      summary: {
        totalRequests: performanceStats.totalRequests,
        totalCost: costStats.totalCost,
        averageQuality: qualityStats.averageQuality,
        averageEfficiency: tokenEfficiencyStats.averageEfficiency,
        topModels: modelComparison.slice(0, 3)
      }
    };
  }

  private async getRealtimeMetrics(tenantId: string) {
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    
    const metrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: lastHour }
      },
      orderBy: { timestamp: 'desc' },
      take: 100
    });

    if (metrics.length === 0) {
      return this.getDefaultMetrics();
    }

    const latest = metrics[0];
    const previous = metrics[Math.min(10, metrics.length - 1)];

    return {
      current: {
        tokenEfficiency: (latest.tokenEfficiency as any)?.efficiency || 0,
        responseQuality: (latest.responseQuality as any)?.overall || 0,
        costPerRequest: (latest.cost as any)?.costPerRequest || 0,
        responseTime: (latest.performance as any)?.responseTime || 0,
        errorRate: (latest.performance as any)?.errorRate || 0
      },
      trends: {
        tokenEfficiency: this.calculateTrend(metrics.map(m => (m.tokenEfficiency as any)?.efficiency || 0)),
        responseQuality: this.calculateTrend(metrics.map(m => (m.responseQuality as any)?.overall || 0)),
        costPerRequest: this.calculateTrend(metrics.map(m => (m.cost as any)?.costPerRequest || 0)),
        responseTime: this.calculateTrend(metrics.map(m => (m.performance as any)?.responseTime || 0))
      },
      sparklines: {
        tokenEfficiency: metrics.slice(0, 20).reverse().map(m => (m.tokenEfficiency as any)?.efficiency || 0),
        responseQuality: metrics.slice(0, 20).reverse().map(m => (m.responseQuality as any)?.overall || 0),
        cost: metrics.slice(0, 20).reverse().map(m => (m.cost as any)?.costPerRequest || 0),
        responseTime: metrics.slice(0, 20).reverse().map(m => (m.performance as any)?.responseTime || 0)
      }
    };
  }

  private async getTokenEfficiencyStats(tenantId: string, startDate: Date, endDate: Date) {
    const metrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: startDate, lte: endDate }
      }
    });

    if (metrics.length === 0) {
      return { averageEfficiency: 0, trends: [], distribution: [] };
    }

    const efficiencies = metrics.map(m => (m.tokenEfficiency as any)?.efficiency || 0);
    const totalTokens = metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.totalTokens || 0), 0);
    const wastedTokens = metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.wastedTokens || 0), 0);

    // Time series data for charts
    const timeSeries = this.groupByTimeInterval(metrics, endDate.getTime() - startDate.getTime())
      .map(group => ({
        timestamp: group.timestamp,
        efficiency: group.metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.efficiency || 0), 0) / group.metrics.length,
        totalTokens: group.metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.totalTokens || 0), 0),
        wastedTokens: group.metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.wastedTokens || 0), 0)
      }));

    // Efficiency distribution
    const distribution = this.createDistribution(efficiencies, 10);

    // Top inefficient prompts
    const inefficientPrompts = metrics
      .filter(m => ((m.tokenEfficiency as any)?.efficiency || 0) < 0.5)
      .sort((a, b) => ((a.tokenEfficiency as any)?.efficiency || 0) - ((b.tokenEfficiency as any)?.efficiency || 0))
      .slice(0, 10)
      .map(m => ({
        promptId: m.id,
        efficiency: (m.tokenEfficiency as any)?.efficiency || 0,
        wastedTokens: (m.tokenEfficiency as any)?.wastedTokens || 0,
        timestamp: m.timestamp
      }));

    return {
      averageEfficiency: efficiencies.reduce((sum, eff) => sum + eff, 0) / efficiencies.length,
      totalTokens,
      wastedTokens,
      wastePercentage: (wastedTokens / totalTokens) * 100,
      timeSeries,
      distribution,
      inefficientPrompts,
      recommendations: this.generateTokenOptimizationRecommendations(metrics)
    };
  }

  private async getQualityStats(tenantId: string, startDate: Date, endDate: Date) {
    const metrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: startDate, lte: endDate }
      }
    });

    if (metrics.length === 0) {
      return { averageQuality: 0, breakdown: {}, trends: [] };
    }

    const qualities = metrics.map(m => (m.responseQuality as any)?.overall || 0);
    const averageQuality = qualities.reduce((sum, q) => sum + q, 0) / qualities.length;

    // Quality breakdown by dimensions
    const breakdown = {
      accuracy: metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.accuracy || 0), 0) / metrics.length,
      relevance: metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.relevance || 0), 0) / metrics.length,
      completeness: metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.completeness || 0), 0) / metrics.length,
      clarity: metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.clarity || 0), 0) / metrics.length
    };

    // Quality trends over time
    const timeSeries = this.groupByTimeInterval(metrics, endDate.getTime() - startDate.getTime())
      .map(group => ({
        timestamp: group.timestamp,
        quality: group.metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.overall || 0), 0) / group.metrics.length,
        accuracy: group.metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.accuracy || 0), 0) / group.metrics.length,
        relevance: group.metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.relevance || 0), 0) / group.metrics.length,
        completeness: group.metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.completeness || 0), 0) / group.metrics.length,
        clarity: group.metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.clarity || 0), 0) / group.metrics.length
      }));

    // Quality by model
    const modelQuality = this.groupBy(metrics, 'model.name')
      .map(([modelName, modelMetrics]) => ({
        model: modelName,
        quality: modelMetrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.overall || 0), 0) / modelMetrics.length,
        count: modelMetrics.length
      }))
      .sort((a, b) => b.quality - a.quality);

    // Low quality alerts
    const lowQualityPrompts = metrics
      .filter(m => ((m.responseQuality as any)?.overall || 0) < 0.7)
      .sort((a, b) => ((a.responseQuality as any)?.overall || 0) - ((b.responseQuality as any)?.overall || 0))
      .slice(0, 10);

    return {
      averageQuality,
      breakdown,
      timeSeries,
      modelQuality,
      lowQualityPrompts,
      distribution: this.createDistribution(qualities, 10),
      recommendations: this.generateQualityImprovementRecommendations(metrics)
    };
  }

  private async getCostStats(tenantId: string, startDate: Date, endDate: Date) {
    const metrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: startDate, lte: endDate }
      }
    });

    if (metrics.length === 0) {
      return { totalCost: 0, averageCostPerRequest: 0, trends: [] };
    }

    const totalCost = metrics.reduce((sum, m) => sum + ((m.cost as any)?.totalCost || 0), 0);
    const averageCostPerRequest = totalCost / metrics.length;

    // Cost breakdown by model
    const modelCosts = this.groupBy(metrics, 'model.name')
      .map(([modelName, modelMetrics]) => ({
        model: modelName,
        totalCost: modelMetrics.reduce((sum, m) => sum + ((m.cost as any)?.totalCost || 0), 0),
        requests: modelMetrics.length,
        averageCost: modelMetrics.reduce((sum, m) => sum + ((m.cost as any)?.totalCost || 0), 0) / modelMetrics.length
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    // Cost trends
    const timeSeries = this.groupByTimeInterval(metrics, endDate.getTime() - startDate.getTime())
      .map(group => ({
        timestamp: group.timestamp,
        totalCost: group.metrics.reduce((sum, m) => sum + ((m.cost as any)?.totalCost || 0), 0),
        averageCost: group.metrics.reduce((sum, m) => sum + ((m.cost as any)?.totalCost || 0), 0) / group.metrics.length,
        requests: group.metrics.length
      }));

    // Most expensive prompts
    const expensivePrompts = metrics
      .sort((a, b) => ((b.cost as any)?.totalCost || 0) - ((a.cost as any)?.totalCost || 0))
      .slice(0, 10)
      .map(m => ({
        promptId: m.id,
        cost: (m.cost as any)?.totalCost || 0,
        tokens: (m.tokenEfficiency as any)?.totalTokens || 0,
        model: (m.model as any)?.name || 'unknown',
        timestamp: m.timestamp
      }));

    // Cost optimization opportunities
    const optimizationOpportunities = this.identifyCostOptimizations(metrics);

    return {
      totalCost,
      averageCostPerRequest,
      modelCosts,
      timeSeries,
      expensivePrompts,
      optimizationOpportunities,
      projectedMonthlyCost: this.projectMonthlyCost(timeSeries),
      costPerToken: totalCost / Math.max(1, metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.totalTokens || 0), 0))
    };
  }

  private async getPerformanceStats(tenantId: string, startDate: Date, endDate: Date) {
    const metrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: startDate, lte: endDate }
      }
    });

    if (metrics.length === 0) {
      return { totalRequests: 0, averageResponseTime: 0, errorRate: 0 };
    }

    const totalRequests = metrics.length;
    const averageResponseTime = metrics.reduce((sum, m) => sum + ((m.performance as any)?.responseTime || 0), 0) / metrics.length;
    const errorRate = metrics.reduce((sum, m) => sum + ((m.performance as any)?.errorRate || 0), 0) / metrics.length;
    const totalRetries = metrics.reduce((sum, m) => sum + ((m.performance as any)?.retryCount || 0), 0);
    const totalTimeouts = metrics.reduce((sum, m) => sum + ((m.performance as any)?.timeouts || 0), 0);

    // Performance by model
    const modelPerformance = this.groupBy(metrics, 'model.name')
      .map(([modelName, modelMetrics]) => ({
        model: modelName,
        averageResponseTime: modelMetrics.reduce((sum, m) => sum + ((m.performance as any)?.responseTime || 0), 0) / modelMetrics.length,
        errorRate: modelMetrics.reduce((sum, m) => sum + ((m.performance as any)?.errorRate || 0), 0) / modelMetrics.length,
        requests: modelMetrics.length
      }))
      .sort((a, b) => a.averageResponseTime - b.averageResponseTime);

    // Performance trends
    const timeSeries = this.groupByTimeInterval(metrics, endDate.getTime() - startDate.getTime())
      .map(group => ({
        timestamp: group.timestamp,
        requests: group.metrics.length,
        averageResponseTime: group.metrics.reduce((sum, m) => sum + ((m.performance as any)?.responseTime || 0), 0) / group.metrics.length,
        errorRate: group.metrics.reduce((sum, m) => sum + ((m.performance as any)?.errorRate || 0), 0) / group.metrics.length,
        throughput: group.metrics.length / ((group.timeRange || 3600) / 1000) // requests per second
      }));

    return {
      totalRequests,
      averageResponseTime,
      errorRate,
      totalRetries,
      totalTimeouts,
      modelPerformance,
      timeSeries,
      slowestPrompts: this.findSlowestPrompts(metrics),
      throughputStats: this.calculateThroughputStats(timeSeries)
    };
  }

  private async getModelComparison(tenantId: string, startDate: Date, endDate: Date) {
    const metrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: startDate, lte: endDate }
      }
    });

    const modelGroups = this.groupBy(metrics, 'model.name');
    
    return modelGroups.map(([modelName, modelMetrics]) => {
      const avgQuality = modelMetrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.overall || 0), 0) / modelMetrics.length;
      const avgCost = modelMetrics.reduce((sum, m) => sum + ((m.cost as any)?.costPerRequest || 0), 0) / modelMetrics.length;
      const avgResponseTime = modelMetrics.reduce((sum, m) => sum + ((m.performance as any)?.responseTime || 0), 0) / modelMetrics.length;
      const avgEfficiency = modelMetrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.efficiency || 0), 0) / modelMetrics.length;
      
      return {
        model: modelName,
        requests: modelMetrics.length,
        quality: avgQuality,
        cost: avgCost,
        responseTime: avgResponseTime,
        efficiency: avgEfficiency,
        score: this.calculateModelScore(avgQuality, avgCost, avgResponseTime, avgEfficiency),
        provider: (modelMetrics[0]?.model as any)?.provider || 'unknown'
      };
    }).sort((a, b) => b.score - a.score);
  }

  private async generateOptimizationSuggestions(metrics: PerformanceMetrics): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    // Token optimization
    if (metrics.tokenEfficiency.efficiency < 0.7) {
      suggestions.push({
        type: 'token_optimization',
        title: 'Optimize Token Usage',
        description: 'Your prompts are using tokens inefficiently. Consider simplifying language and removing redundant instructions.',
        impact: 'high',
        effort: 'medium',
        estimatedSavings: {
          tokens: Math.round(metrics.tokenEfficiency.wastedTokens * 0.7),
          cost: metrics.cost.totalCost * 0.3
        },
        implementation: 'Use the prompt optimizer tool to identify and remove unnecessary tokens',
        examples: [
          'Replace "Could you please help me understand" with "Explain"',
          'Remove filler words like "basically", "actually", "really"',
          'Use bullet points instead of verbose descriptions'
        ]
      });
    }

    // Model switching recommendation
    if (metrics.cost.costPerRequest > 0.03) {
      suggestions.push({
        type: 'model_switch',
        title: 'Consider More Cost-Effective Model',
        description: 'Your current model might be overpowered for this task. A smaller model could provide similar results at lower cost.',
        impact: 'high',
        effort: 'low',
        estimatedSavings: {
          cost: metrics.cost.totalCost * 0.4
        },
        implementation: 'Run A/B test with GPT-3.5-turbo or Claude Instant',
        examples: [
          'For simple Q&A, try GPT-3.5-turbo instead of GPT-4',
          'For classification tasks, consider smaller specialized models'
        ]
      });
    }

    // Prompt improvement
    if (metrics.responseQuality.overall < 0.8) {
      suggestions.push({
        type: 'prompt_improvement',
        title: 'Improve Prompt Structure',
        description: 'Your prompts could be more specific to improve response quality.',
        impact: 'medium',
        effort: 'medium',
        estimatedSavings: {
          time: 30 // percentage improvement in efficiency
        },
        implementation: 'Add more context, examples, and clear output format specifications',
        examples: [
          'Add role definition: "You are an expert in..."',
          'Include 2-3 examples of desired output',
          'Specify exact format: "Respond in JSON format with keys..."'
        ]
      });
    }

    // Caching opportunity
    if (this.detectRepetitivePatterns(metrics)) {
      suggestions.push({
        type: 'caching',
        title: 'Enable Response Caching',
        description: 'Detected repetitive prompts that could benefit from caching.',
        impact: 'medium',
        effort: 'low',
        estimatedSavings: {
          cost: metrics.cost.totalCost * 0.2,
          time: 80 // percentage reduction in response time
        },
        implementation: 'Enable semantic caching for similar prompts',
        examples: [
          'Cache responses for FAQ-style prompts',
          'Use template caching for structured outputs'
        ]
      });
    }

    return suggestions;
  }

  private async checkAlerts(metrics: PerformanceMetrics): Promise<void> {
    const alerts: PerformanceAlert[] = [];

    // Cost spike alert
    if (metrics.cost.costPerRequest > this.alertThresholds.costPerRequest) {
      alerts.push({
        id: crypto.randomUUID(),
        type: 'cost_spike',
        severity: 'high',
        message: `Cost per request (${metrics.cost.costPerRequest.toFixed(4)}) exceeds threshold (${this.alertThresholds.costPerRequest})`,
        metrics: { costPerRequest: metrics.cost.costPerRequest },
        threshold: this.alertThresholds.costPerRequest,
        currentValue: metrics.cost.costPerRequest,
        timestamp: new Date(),
        resolved: false
      });
    }

    // Quality drop alert
    if (metrics.responseQuality.overall < this.alertThresholds.qualityScore) {
      alerts.push({
        id: crypto.randomUUID(),
        type: 'quality_drop',
        severity: 'medium',
        message: `Response quality (${metrics.responseQuality.overall.toFixed(2)}) below acceptable threshold`,
        metrics: { qualityScore: metrics.responseQuality.overall },
        threshold: this.alertThresholds.qualityScore,
        currentValue: metrics.responseQuality.overall,
        timestamp: new Date(),
        resolved: false
      });
    }

    // Performance degradation alert
    if (metrics.performance.responseTime > this.alertThresholds.responseTime) {
      alerts.push({
        id: crypto.randomUUID(),
        type: 'performance_degradation',
        severity: 'medium',
        message: `Response time (${metrics.performance.responseTime}ms) exceeds threshold`,
        metrics: { responseTime: metrics.performance.responseTime },
        threshold: this.alertThresholds.responseTime,
        currentValue: metrics.performance.responseTime,
        timestamp: new Date(),
        resolved: false
      });
    }

    // Error rate alert
    if (metrics.performance.errorRate > this.alertThresholds.errorRate) {
      alerts.push({
        id: crypto.randomUUID(),
        type: 'error_rate_high',
        severity: 'high',
        message: `Error rate (${(metrics.performance.errorRate * 100).toFixed(1)}%) is too high`,
        metrics: { errorRate: metrics.performance.errorRate },
        threshold: this.alertThresholds.errorRate,
        currentValue: metrics.performance.errorRate,
        timestamp: new Date(),
        resolved: false
      });
    }

    // Store and broadcast alerts
    for (const alert of alerts) {
      await this.storeAlert(alert);
      this.server.emit('performance_alert', {
        tenantId: metrics.tenantId,
        alert
      });
    }
  }

  private async getActiveAlerts(tenantId: string): Promise<PerformanceAlert[]> {
    return this.prisma.performanceAlert.findMany({
      where: {
        tenantId,
        resolved: false,
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      orderBy: { timestamp: 'desc' }
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async aggregateRealtimeMetrics() {
    // Aggregate metrics for all active tenants
    const activeTenants = await this.getActiveTenants();
    
    for (const tenantId of activeTenants) {
      const realtimeMetrics = await this.getRealtimeMetrics(tenantId);
      
      // Broadcast to connected clients
      this.server.to(`tenant:${tenantId}`).emit('realtime_metrics', realtimeMetrics);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async generateOptimizationInsights() {
    const activeTenants = await this.getActiveTenants();
    
    for (const tenantId of activeTenants) {
      const suggestions = await this.getOptimizationSuggestions(tenantId);
      
      if (suggestions.length > 0) {
        this.server.to(`tenant:${tenantId}`).emit('optimization_insights', {
          suggestions,
          timestamp: new Date()
        });
      }
    }
  }

  // Helper methods

  private parseTimeRange(timeRange: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate: Date;

    switch (timeRange) {
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

  private calculateTrend(values: number[]): string {
    if (values.length < 2) return 'stable';
    
    const recent = values.slice(-Math.min(10, values.length));
    const older = values.slice(0, Math.min(10, values.length));
    
    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;
    
    const change = (recentAvg - olderAvg) / olderAvg;
    
    if (change > 0.05) return 'increasing';
    if (change < -0.05) return 'decreasing';
    return 'stable';
  }

  private groupByTimeInterval(metrics: any[], timeRangeMs: number) {
    const intervalMs = this.getOptimalInterval(timeRangeMs);
    const groups = new Map();

    for (const metric of metrics) {
      const intervalStart = Math.floor(metric.timestamp.getTime() / intervalMs) * intervalMs;
      
      if (!groups.has(intervalStart)) {
        groups.set(intervalStart, {
          timestamp: new Date(intervalStart),
          metrics: [],
          timeRange: intervalMs
        });
      }
      
      groups.get(intervalStart).metrics.push(metric);
    }

    return Array.from(groups.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private getOptimalInterval(timeRangeMs: number): number {
    if (timeRangeMs <= 60 * 60 * 1000) return 60 * 1000; // 1 minute for 1 hour
    if (timeRangeMs <= 24 * 60 * 60 * 1000) return 15 * 60 * 1000; // 15 minutes for 1 day
    if (timeRangeMs <= 7 * 24 * 60 * 60 * 1000) return 60 * 60 * 1000; // 1 hour for 1 week
    return 6 * 60 * 60 * 1000; // 6 hours for longer periods
  }

  private groupBy<T>(array: T[], keyFn: string | ((item: T) => string)): [string, T[]][] {
    const groups = new Map<string, T[]>();
    
    for (const item of array) {
      const key = typeof keyFn === 'string' ? this.getNestedProperty(item, keyFn) : keyFn(item);
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    return Array.from(groups.entries());
  }

  private getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj) || '';
  }

  private createDistribution(values: number[], buckets: number = 10) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bucketSize = (max - min) / buckets;
    
    const distribution = Array(buckets).fill(0).map((_, i) => ({
      range: `${(min + i * bucketSize).toFixed(2)}-${(min + (i + 1) * bucketSize).toFixed(2)}`,
      count: 0
    }));

    for (const value of values) {
      const bucketIndex = Math.min(Math.floor((value - min) / bucketSize), buckets - 1);
      distribution[bucketIndex].count++;
    }

    return distribution;
  }

  private calculateModelScore(quality: number, cost: number, responseTime: number, efficiency: number): number {
    // Weighted scoring: quality (40%), cost efficiency (30%), speed (20%), token efficiency (10%)
    const costScore = Math.max(0, 1 - (cost / 0.1)); // Normalize to $0.10 max
    const speedScore = Math.max(0, 1 - (responseTime / 10000)); // Normalize to 10s max
    
    return (quality * 0.4) + (costScore * 0.3) + (speedScore * 0.2) + (efficiency * 0.1);
  }

  private sanitizeMetricsForBroadcast(metrics: PerformanceMetrics) {
    // Remove sensitive information before broadcasting
    return {
      timestamp: metrics.timestamp,
      tokenEfficiency: metrics.tokenEfficiency,
      responseQuality: metrics.responseQuality,
      performance: metrics.performance,
      cost: {
        ...metrics.cost,
        // Remove exact costs, keep ratios
        totalCost: null,
        inputCost: null,
        outputCost: null
      }
    };
  }

  private getDefaultMetrics() {
    return {
      current: {
        tokenEfficiency: 0,
        responseQuality: 0,
        costPerRequest: 0,
        responseTime: 0,
        errorRate: 0
      },
      trends: {
        tokenEfficiency: 'stable',
        responseQuality: 'stable',
        costPerRequest: 'stable',
        responseTime: 'stable'
      },
      sparklines: {
        tokenEfficiency: [],
        responseQuality: [],
        cost: [],
        responseTime: []
      }
    };
  }

  private detectRepetitivePatterns(metrics: PerformanceMetrics): boolean {
    // Simple pattern detection - in production, this would be more sophisticated
    return metrics.context.promptLength > 100 && metrics.tokenEfficiency.efficiency < 0.6;
  }

  private async storeAlert(alert: PerformanceAlert): Promise<void> {
    await this.prisma.performanceAlert.create({
      data: alert
    });
  }

  private async getActiveTenants(): Promise<string[]> {
    const recentMetrics = await this.prisma.performanceMetrics.findMany({
      where: {
        timestamp: {
          gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
        }
      },
      distinct: ['tenantId'],
      select: { tenantId: true }
    });

    return recentMetrics.map(m => m.tenantId).filter(Boolean);
  }

  private generateTokenOptimizationRecommendations(metrics: any[]): string[] {
    const recommendations = [];
    
    const avgWaste = metrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.wastedTokens || 0), 0) / metrics.length;
    
    if (avgWaste > 50) {
      recommendations.push('Consider using more concise language in your prompts');
      recommendations.push('Remove redundant instructions and examples');
    }
    
    if (metrics.some(m => ((m.tokenEfficiency as any)?.efficiency || 0) < 0.3)) {
      recommendations.push('Some prompts have very low efficiency - review for unnecessary verbosity');
    }
    
    return recommendations;
  }

  private generateQualityImprovementRecommendations(metrics: any[]): string[] {
    const recommendations = [];
    
    const avgQuality = metrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.overall || 0), 0) / metrics.length;
    
    if (avgQuality < 0.7) {
      recommendations.push('Add more specific context and examples to improve response quality');
      recommendations.push('Consider using chain-of-thought prompting for complex tasks');
    }
    
    return recommendations;
  }

  private identifyCostOptimizations(metrics: any[]) {
    const opportunities = [];
    
    const expensiveModels = metrics.filter(m => ((m.cost as any)?.costPerRequest || 0) > 0.05);
    if (expensiveModels.length > metrics.length * 0.3) {
      opportunities.push({
        type: 'model_optimization',
        description: 'Consider using more cost-effective models for simpler tasks',
        potential_savings: '30-50%'
      });
    }
    
    return opportunities;
  }

  private projectMonthlyCost(timeSeries: any[]): number {
    if (timeSeries.length === 0) return 0;
    
    const dailyAverage = timeSeries.reduce((sum, t) => sum + t.totalCost, 0) / timeSeries.length;
    return dailyAverage * 30;
  }

  private findSlowestPrompts(metrics: any[]) {
    return metrics
      .sort((a, b) => ((b.performance as any)?.responseTime || 0) - ((a.performance as any)?.responseTime || 0))
      .slice(0, 5)
      .map(m => ({
        promptId: m.id,
        responseTime: (m.performance as any)?.responseTime || 0,
        model: (m.model as any)?.name || 'unknown',
        timestamp: m.timestamp
      }));
  }

  private calculateThroughputStats(timeSeries: any[]) {
    if (timeSeries.length === 0) return { average: 0, peak: 0, minimum: 0 };
    
    const throughputs = timeSeries.map(t => t.throughput || 0);
    
    return {
      average: throughputs.reduce((sum, t) => sum + t, 0) / throughputs.length,
      peak: Math.max(...throughputs),
      minimum: Math.min(...throughputs)
    };
  }

  private async getOptimizationSuggestions(tenantId: string): Promise<OptimizationSuggestion[]> {
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentMetrics = await this.prisma.performanceMetrics.findMany({
      where: {
        tenantId,
        timestamp: { gte: lastHour }
      },
      orderBy: { timestamp: 'desc' },
      take: 50
    });

    if (recentMetrics.length === 0) {
      return [];
    }

    const suggestions: OptimizationSuggestion[] = [];

    // Analyze recent metrics for optimization opportunities
    const avgEfficiency = recentMetrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.efficiency || 0), 0) / recentMetrics.length;
    const avgCost = recentMetrics.reduce((sum, m) => sum + ((m.cost as any)?.costPerRequest || 0), 0) / recentMetrics.length;
    const avgQuality = recentMetrics.reduce((sum, m) => sum + ((m.responseQuality as any)?.overall || 0), 0) / recentMetrics.length;
    const avgResponseTime = recentMetrics.reduce((sum, m) => sum + ((m.performance as any)?.responseTime || 0), 0) / recentMetrics.length;

    // Token efficiency suggestions
    if (avgEfficiency < 0.6) {
      suggestions.push({
        type: 'token_optimization',
        title: 'Improve Token Efficiency',
        description: `Current efficiency is ${(avgEfficiency * 100).toFixed(1)}%. Optimize prompts to reduce token waste.`,
        impact: 'high',
        effort: 'medium',
        estimatedSavings: {
          tokens: Math.round(recentMetrics.reduce((sum, m) => sum + ((m.tokenEfficiency as any)?.wastedTokens || 0), 0) * 0.5),
          cost: avgCost * recentMetrics.length * 0.3
        },
        implementation: 'Use shorter, more direct language and remove unnecessary examples',
        examples: [
          'Replace "Please help me understand" with "Explain"',
          'Use bullet points instead of paragraphs',
          'Remove redundant examples'
        ]
      });
    }

    // Cost optimization suggestions
    if (avgCost > 0.03) {
      suggestions.push({
        type: 'model_switch',
        title: 'Switch to More Cost-Effective Model',
        description: `Average cost per request is $${avgCost.toFixed(4)}. Consider using a smaller model.`,
        impact: 'high',
        effort: 'low',
        estimatedSavings: {
          cost: avgCost * recentMetrics.length * 0.4
        },
        implementation: 'Test with GPT-3.5-turbo or Claude Instant for similar results at lower cost',
        examples: [
          'Simple Q&A: Use GPT-3.5-turbo instead of GPT-4',
          'Classification: Use fine-tuned smaller models'
        ]
      });
    }

    // Quality improvement suggestions
    if (avgQuality < 0.8) {
      suggestions.push({
        type: 'prompt_improvement',
        title: 'Enhance Prompt Quality',
        description: `Response quality is ${(avgQuality * 100).toFixed(1)}%. Improve prompt structure and clarity.`,
        impact: 'medium',
        effort: 'medium',
        estimatedSavings: {
          time: 25
        },
        implementation: 'Add role definitions, context, and output format specifications',
        examples: [
          'Start with "You are an expert in..."',
          'Provide 2-3 examples of expected output',
          'Specify exact format requirements'
        ]
      });
    }

    // Performance suggestions
    if (avgResponseTime > 3000) {
      suggestions.push({
        type: 'caching',
        title: 'Implement Response Caching',
        description: `Average response time is ${avgResponseTime.toFixed(0)}ms. Caching could help.`,
        impact: 'medium',
        effort: 'low',
        estimatedSavings: {
          time: 60,
          cost: avgCost * recentMetrics.length * 0.2
        },
        implementation: 'Cache responses for repetitive or similar prompts',
        examples: [
          'FAQ responses',
          'Template-based outputs',
          'Common classification results'
        ]
      });
    }

    return suggestions.sort((a, b) => {
      const impactScore = { high: 3, medium: 2, low: 1 };
      return impactScore[b.impact] - impactScore[a.impact];
    });
  }
}