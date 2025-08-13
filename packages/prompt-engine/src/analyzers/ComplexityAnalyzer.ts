import { ComplexityAnalysis, ComplexityFactors, EnhancementLevel, PromptData } from '../types';

export class ComplexityAnalyzer {
  private readonly technicalTerms = [
    'algorithm', 'optimize', 'architecture', 'implementation', 
    'analysis', 'strategy', 'framework', 'detailed', 'comprehensive',
    'methodology', 'systematic', 'evaluation', 'assessment', 'research',
    'integration', 'specification', 'requirements', 'development',
    'performance', 'scalability', 'security', 'validation'
  ];

  private readonly multiStepIndicators = [
    'steps', 'process', 'workflow', 'pipeline', 'sequence', 'plan',
    'phase', 'stage', 'procedure', 'methodology', 'approach',
    'first', 'then', 'next', 'finally', 'after', 'before'
  ];

  private readonly toolRequirements = [
    'search', 'calculate', 'retrieve', 'analyze', 'data', 'research',
    'query', 'database', 'api', 'web', 'scrape', 'parse',
    'visualize', 'chart', 'graph', 'table', 'export'
  ];

  private readonly formatRequirements = [
    'json', 'xml', 'csv', 'table', 'report', 'presentation', 'email',
    'markdown', 'html', 'yaml', 'format', 'template', 'structure'
  ];

  private readonly creativeIndicators = [
    'create', 'design', 'innovate', 'brainstorm', 'imagine', 'write',
    'compose', 'generate', 'invent', 'creative', 'original', 'unique',
    'artistic', 'story', 'narrative', 'poem', 'song'
  ];

  analyze(promptData: PromptData, context: Record<string, any> = {}): ComplexityAnalysis {
    const prompt = promptData.rawUserPrompt || promptData.userGoal;
    const lowercasePrompt = prompt.toLowerCase();
    const words = prompt.split(/\s+/);

    const factors: ComplexityFactors = {
      length: words.length > 15,
      technicalTerms: this.technicalTerms.some(term => lowercasePrompt.includes(term)),
      multipleSteps: this.multiStepIndicators.some(indicator => lowercasePrompt.includes(indicator)),
      requiresTools: this.toolRequirements.some(tool => lowercasePrompt.includes(tool)),
      specificFormat: this.formatRequirements.some(format => lowercasePrompt.includes(format)),
      creativeTask: this.creativeIndicators.some(creative => lowercasePrompt.includes(creative))
    };

    const score = this.calculateScore(factors, promptData, context);
    const { level, assessment } = this.determineLevel(score);

    return {
      score,
      factors,
      assessment,
      recommendedLevel: level
    };
  }

  private calculateScore(
    factors: ComplexityFactors, 
    promptData: PromptData, 
    context: Record<string, any>
  ): number {
    let score = 0;

    // Base factors
    if (factors.length) score += 1;
    if (factors.technicalTerms) score += 1.5;
    if (factors.multipleSteps) score += 1.5;
    if (factors.requiresTools) score += 1;
    if (factors.specificFormat) score += 1;
    if (factors.creativeTask) score += 0.5;

    // Additional context factors
    if (promptData.constraints && promptData.constraints.length > 0) score += 0.5;
    if (promptData.domainKnowledge && promptData.domainKnowledge.length > 50) score += 0.5;
    if (promptData.additionalContext && Object.keys(promptData.additionalContext).length > 0) score += 0.5;
    if (promptData.previousInteractions && promptData.previousInteractions.length > 0) score += 1;

    // Word count modifier
    const words = (promptData.rawUserPrompt || promptData.userGoal).split(/\s+/).length;
    if (words > 50) score += 1;
    if (words > 100) score += 1;

    return Math.min(score, 6);
  }

  private determineLevel(score: number): { level: EnhancementLevel; assessment: string } {
    if (score <= 1) {
      return {
        level: 'low',
        assessment: 'Simple, direct question requiring minimal enhancement'
      };
    } else if (score <= 3) {
      return {
        level: 'med',
        assessment: 'Moderate complexity requiring structured approach and clear guidance'
      };
    } else if (score <= 5) {
      return {
        level: 'high',
        assessment: 'Complex task needing detailed planning and expert-level optimization'
      };
    } else {
      return {
        level: 'pro',
        assessment: 'Highly complex multifaceted project requiring comprehensive prompt engineering'
      };
    }
  }

  getComplexityInsights(analysis: ComplexityAnalysis): string[] {
    const insights: string[] = [];

    if (analysis.factors.technicalTerms) {
      insights.push('Technical terminology detected - consider adding domain expertise context');
    }

    if (analysis.factors.multipleSteps) {
      insights.push('Multi-step process identified - break down into clear sequential instructions');
    }

    if (analysis.factors.requiresTools) {
      insights.push('Tool usage required - specify available tools and their usage context');
    }

    if (analysis.factors.specificFormat) {
      insights.push('Specific output format needed - provide clear formatting requirements and examples');
    }

    if (analysis.factors.creativeTask) {
      insights.push('Creative task detected - balance creativity with constraints for optimal results');
    }

    if (analysis.score >= 4) {
      insights.push('High complexity task - consider adding validation checkpoints and quality criteria');
    }

    return insights;
  }
}