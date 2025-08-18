import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PerformanceMonitorService } from './performance-monitor.service';

@Injectable()
export class PerformanceMetricsInterceptor implements NestInterceptor {
  constructor(private performanceService: PerformanceMonitorService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();
    
    // Extract relevant information from the request
    const userId = request.user?.id;
    const tenantId = request.user?.tenantId;
    const isPromptRequest = this.isPromptRelatedRequest(request);

    if (!isPromptRequest) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          // Only record metrics for successful prompt operations
          if (this.shouldRecordMetrics(request, response)) {
            this.recordMetrics(request, response, startTime, userId, tenantId);
          }
        },
        error: (error) => {
          // Record error metrics
          if (isPromptRequest) {
            this.recordErrorMetrics(request, error, startTime, userId, tenantId);
          }
        }
      })
    );
  }

  private isPromptRelatedRequest(request: any): boolean {
    const promptEndpoints = [
      '/prompts/execute',
      '/prompts/improve',
      '/templates/execute',
      '/workflows/execute',
      '/llm/complete'
    ];

    return promptEndpoints.some(endpoint => request.url.includes(endpoint));
  }

  private shouldRecordMetrics(request: any, response: any): boolean {
    // Only record for requests that include LLM interactions
    return response && (
      response.tokenUsage || 
      response.cost || 
      response.executionTime ||
      request.body?.recordMetrics !== false
    );
  }

  private async recordMetrics(
    request: any, 
    response: any, 
    startTime: number, 
    userId: string, 
    tenantId: string
  ) {
    try {
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Extract metrics from response
      const tokenUsage = response.tokenUsage || {};
      const cost = response.cost || {};
      const quality = response.qualityScores || {};

      const metrics = {
        timestamp: new Date(),
        tenantId,
        userId,
        
        tokenEfficiency: {
          inputTokens: tokenUsage.inputTokens || 0,
          outputTokens: tokenUsage.outputTokens || 0,
          totalTokens: tokenUsage.totalTokens || 0,
          efficiency: this.calculateTokenEfficiency(tokenUsage),
          wastedTokens: this.calculateWastedTokens(tokenUsage),
          optimizationScore: this.calculateOptimizationScore(tokenUsage, cost)
        },
        
        responseQuality: {
          accuracy: quality.accuracy || 0.8,
          relevance: quality.relevance || 0.8,
          completeness: quality.completeness || 0.8,
          clarity: quality.clarity || 0.8,
          overall: this.calculateOverallQuality(quality),
          humanFeedback: null
        },
        
        performance: {
          responseTime,
          throughput: 1000 / responseTime, // requests per second
          errorRate: 0,
          retryCount: request.retryCount || 0,
          timeouts: 0
        },
        
        cost: {
          inputCost: cost.inputCost || 0,
          outputCost: cost.outputCost || 0,
          totalCost: cost.totalCost || 0,
          costPerRequest: cost.totalCost || 0,
          costEfficiency: this.calculateCostEfficiency(tokenUsage, cost)
        },
        
        model: {
          name: request.body?.model || response.model || 'unknown',
          version: 'latest',
          provider: this.extractProvider(request.body?.model || response.model),
          temperature: request.body?.temperature || 0.7,
          maxTokens: request.body?.maxTokens || 2048
        },
        
        context: {
          promptLength: this.getPromptLength(request.body),
          contextLength: this.getContextLength(request.body),
          complexity: this.calculateComplexity(request.body),
          category: request.body?.category || 'general'
        }
      };

      await this.performanceService.recordMetrics(metrics);
    } catch (error) {
      console.error('Failed to record performance metrics:', error);
    }
  }

  private async recordErrorMetrics(
    request: any,
    error: any,
    startTime: number,
    userId: string,
    tenantId: string
  ) {
    try {
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      const metrics = {
        timestamp: new Date(),
        tenantId,
        userId,
        
        tokenEfficiency: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          efficiency: 0,
          wastedTokens: 0,
          optimizationScore: 0
        },
        
        responseQuality: {
          accuracy: 0,
          relevance: 0,
          completeness: 0,
          clarity: 0,
          overall: 0,
          humanFeedback: null
        },
        
        performance: {
          responseTime,
          throughput: 0,
          errorRate: 1,
          retryCount: request.retryCount || 0,
          timeouts: error.code === 'TIMEOUT' ? 1 : 0
        },
        
        cost: {
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          costPerRequest: 0,
          costEfficiency: 0
        },
        
        model: {
          name: request.body?.model || 'unknown',
          version: 'latest',
          provider: this.extractProvider(request.body?.model),
          temperature: request.body?.temperature || 0.7,
          maxTokens: request.body?.maxTokens || 2048
        },
        
        context: {
          promptLength: this.getPromptLength(request.body),
          contextLength: this.getContextLength(request.body),
          complexity: this.calculateComplexity(request.body),
          category: request.body?.category || 'general'
        }
      };

      await this.performanceService.recordMetrics(metrics);
    } catch (metricsError) {
      console.error('Failed to record error metrics:', metricsError);
    }
  }

  // Helper methods

  private calculateTokenEfficiency(tokenUsage: any): number {
    if (!tokenUsage.inputTokens || tokenUsage.inputTokens === 0) return 0;
    return tokenUsage.outputTokens / tokenUsage.inputTokens;
  }

  private calculateWastedTokens(tokenUsage: any): number {
    const expectedTotal = (tokenUsage.inputTokens || 0) + (tokenUsage.outputTokens || 0);
    return Math.max(0, (tokenUsage.totalTokens || 0) - expectedTotal);
  }

  private calculateOptimizationScore(tokenUsage: any, cost: any): number {
    const tokenEfficiency = this.calculateTokenEfficiency(tokenUsage);
    const costEfficiency = this.calculateCostEfficiency(tokenUsage, cost);
    return (tokenEfficiency * 0.6) + (costEfficiency * 0.4);
  }

  private calculateOverallQuality(quality: any): number {
    const scores = [
      quality.accuracy || 0.8,
      quality.relevance || 0.8,
      quality.completeness || 0.8,
      quality.clarity || 0.8
    ];
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  private calculateCostEfficiency(tokenUsage: any, cost: any): number {
    if (!cost.totalCost || cost.totalCost === 0) return 1;
    const outputTokens = tokenUsage.outputTokens || 0;
    return Math.min(outputTokens / (cost.totalCost * 1000), 1); // Normalize
  }

  private extractProvider(model: string): string {
    if (!model) return 'unknown';
    
    if (model.includes('gpt')) return 'openai';
    if (model.includes('claude')) return 'anthropic';
    if (model.includes('gemini') || model.includes('palm')) return 'google';
    if (model.includes('llama')) return 'meta';
    
    return 'custom';
  }

  private getPromptLength(body: any): number {
    const prompt = body?.prompt || body?.messages?.[0]?.content || '';
    return prompt.length;
  }

  private getContextLength(body: any): number {
    if (body?.messages) {
      return body.messages.reduce((total, msg) => total + (msg.content?.length || 0), 0);
    }
    return body?.context?.length || 0;
  }

  private calculateComplexity(body: any): number {
    const promptLength = this.getPromptLength(body);
    const contextLength = this.getContextLength(body);
    
    // Simple complexity calculation based on length and structure
    const lengthFactor = Math.min(promptLength / 1000, 2);
    const contextFactor = Math.min(contextLength / 5000, 2);
    const structureFactor = this.analyzeStructureComplexity(body);
    
    return (lengthFactor + contextFactor + structureFactor) / 6; // 0-1 scale
  }

  private analyzeStructureComplexity(body: any): number {
    let complexity = 0;
    
    // Check for complex patterns
    const prompt = body?.prompt || body?.messages?.[0]?.content || '';
    
    if (prompt.includes('step by step')) complexity += 0.2;
    if (prompt.includes('chain of thought')) complexity += 0.3;
    if (prompt.includes('analyze')) complexity += 0.2;
    if (prompt.includes('compare')) complexity += 0.2;
    if (prompt.includes('examples:')) complexity += 0.1;
    
    // Check for JSON/structured output
    if (prompt.includes('JSON') || prompt.includes('{')) complexity += 0.3;
    
    // Check for multiple tasks
    const taskIndicators = ['1.', '2.', '3.', 'first', 'second', 'then', 'finally'];
    const taskCount = taskIndicators.filter(indicator => prompt.includes(indicator)).length;
    complexity += Math.min(taskCount * 0.1, 0.4);
    
    return Math.min(complexity, 1);
  }
}