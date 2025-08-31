import { Injectable } from '@nestjs/common';

export interface PromptAnalysis {
  score: number;
  feedback: string;
  suggestions: string[];
  issues: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
}

@Injectable()
export class PromptAnalysisService {
  async analyzePrompt(prompt: string): Promise<PromptAnalysis> {
    // Analyze prompt quality and provide feedback
    const analysis: PromptAnalysis = {
      score: this.calculateScore(prompt),
      feedback: this.generateFeedback(prompt),
      suggestions: this.generateSuggestions(prompt),
      issues: this.identifyIssues(prompt),
    };

    return analysis;
  }

  private calculateScore(prompt: string): number {
    let score = 50; // Base score
    
    // Length check
    if (prompt.length > 50 && prompt.length < 1000) score += 10;
    
    // Clarity check
    if (prompt.includes('?')) score += 5;
    if (prompt.toLowerCase().includes('please')) score += 5;
    
    // Specificity check
    if (prompt.split(' ').length > 10) score += 10;
    
    // Context check
    if (prompt.toLowerCase().includes('context') || prompt.toLowerCase().includes('example')) {
      score += 15;
    }

    return Math.min(100, Math.max(0, score));
  }

  private generateFeedback(prompt: string): string {
    const score = this.calculateScore(prompt);
    
    if (score >= 80) return 'Excellent prompt with clear instructions and good structure.';
    if (score >= 60) return 'Good prompt with room for improvement in clarity or specificity.';
    if (score >= 40) return 'Adequate prompt but could benefit from more detail and examples.';
    return 'Prompt needs significant improvement in clarity and structure.';
  }

  private generateSuggestions(prompt: string): string[] {
    const suggestions = [];
    
    if (prompt.length < 20) {
      suggestions.push('Consider adding more detail to your prompt');
    }
    
    if (!prompt.includes('?') && !prompt.includes('.')) {
      suggestions.push('End with a clear question or instruction');
    }
    
    if (!prompt.toLowerCase().includes('example')) {
      suggestions.push('Consider providing examples for better results');
    }

    return suggestions;
  }

  private identifyIssues(prompt: string): Array<{ type: string; severity: 'low' | 'medium' | 'high'; message: string }> {
    const issues = [];
    
    if (prompt.length > 2000) {
      issues.push({
        type: 'length',
        severity: 'medium' as const,
        message: 'Prompt is very long and may exceed token limits',
      });
    }
    
    if (prompt.length < 10) {
      issues.push({
        type: 'length',
        severity: 'high' as const,
        message: 'Prompt is too short to be effective',
      });
    }

    return issues;
  }
}