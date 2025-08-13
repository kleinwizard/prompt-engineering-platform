import { 
  PromptData, 
  ImprovementResult, 
  PromptAnalysis, 
  PromptChange, 
  ImprovementMetrics,
  ChangeExplanation,
  EnhancementLevel
} from '../types';
import { ComplexityAnalyzer } from '../analyzers/ComplexityAnalyzer';
import { RulesEngine } from '../rules/RulesEngine';
import { PromptGenerator } from '../generators/PromptGenerator';
import { v4 as uuidv4 } from 'uuid';

export class PromptImprovementEngine {
  private complexityAnalyzer: ComplexityAnalyzer;
  private rulesEngine: RulesEngine;
  private promptGenerator: PromptGenerator;
  private version = '1.0.0';

  constructor() {
    this.complexityAnalyzer = new ComplexityAnalyzer();
    this.rulesEngine = new RulesEngine();
    this.promptGenerator = new PromptGenerator();
  }

  async improvePrompt(promptData: PromptData): Promise<ImprovementResult> {
    // Ensure we have the required data
    if (!promptData.rawUserPrompt && !promptData.userGoal) {
      throw new Error('Either rawUserPrompt or userGoal must be provided');
    }

    // Use userGoal as rawUserPrompt if not provided (backward compatibility)
    if (!promptData.rawUserPrompt) {
      promptData.rawUserPrompt = promptData.userGoal;
    }

    // Analyze the prompt
    const analysis = await this.analyzePrompt(promptData);

    // Apply enhancement rules
    const ruleResults = await this.rulesEngine.applyRules(promptData, analysis);

    // Generate improved prompt
    const improved = await this.promptGenerator.generateImprovedPrompt(
      promptData,
      analysis,
      ruleResults
    );

    // Extract changes
    const changes = this.extractChanges(promptData.rawUserPrompt, improved, ruleResults);

    // Calculate metrics
    const metrics = this.calculateMetrics(promptData.rawUserPrompt, improved, analysis);

    // Generate explanations
    const explanations = this.generateExplanations(changes, analysis);

    return {
      originalPrompt: promptData.rawUserPrompt,
      improvedPrompt: improved,
      changes,
      analysis,
      metrics,
      explanations
    };
  }

  private async analyzePrompt(promptData: PromptData): Promise<PromptAnalysis> {
    const prompt = promptData.rawUserPrompt || promptData.userGoal;

    // Complexity analysis
    const complexity = this.complexityAnalyzer.analyze(promptData);

    // Structure analysis
    const structure = this.analyzeStructure(prompt);

    // Clarity analysis
    const clarity = this.analyzeClarity(prompt);

    // Completeness analysis
    const completeness = this.analyzeCompleteness(promptData);

    // Safety analysis
    const safety = this.analyzeSafety(prompt);

    return {
      complexity,
      structure,
      clarity,
      completeness,
      safety
    };
  }

  private analyzeStructure(prompt: string) {
    const lowercasePrompt = prompt.toLowerCase();
    
    const hasRole = /act as|you are|as a|assume the role|role:|persona:|character:/.test(lowercasePrompt);
    const hasTask = /task:|objective:|goal:|please|help me|i need|can you/.test(lowercasePrompt);
    const hasConstraints = /constraint|requirement|must|should|don't|avoid|limit|within/.test(lowercasePrompt);
    const hasFormat = /format:|output:|response:|return:|provide:|structure:|template:/.test(lowercasePrompt);
    const hasExamples = /example:|for instance|such as|like:|e\.g\.|sample:/.test(lowercasePrompt);

    const structureElements = [hasRole, hasTask, hasConstraints, hasFormat, hasExamples];
    const score = (structureElements.filter(Boolean).length / structureElements.length) * 100;

    return {
      hasRole,
      hasTask,
      hasConstraints,
      hasFormat,
      hasExamples,
      score
    };
  }

  private analyzeClarity(prompt: string) {
    const words = prompt.split(/\s+/);
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0);

    // Ambiguity indicators
    const ambiguousWords = ['something', 'anything', 'maybe', 'perhaps', 'might', 'could', 'possibly'];
    const ambiguityCount = ambiguousWords.reduce((count, word) => {
      return count + (prompt.toLowerCase().match(new RegExp(word, 'g'))?.length || 0);
    }, 0);

    const ambiguityScore = Math.min((ambiguityCount / words.length) * 1000, 100);

    // Specificity indicators
    const specificWords = ['specific', 'exactly', 'precisely', 'detailed', 'comprehensive', 'thorough'];
    const specificityCount = specificWords.reduce((count, word) => {
      return count + (prompt.toLowerCase().match(new RegExp(word, 'g'))?.length || 0);
    }, 0);

    const specificityScore = Math.min((specificityCount / words.length) * 1000 + 20, 100);

    const issues: string[] = [];
    const suggestions: string[] = [];

    if (ambiguityScore > 5) {
      issues.push('Contains ambiguous language');
      suggestions.push('Replace vague terms with specific requirements');
    }

    if (sentences.some(s => s.length > 200)) {
      issues.push('Contains overly long sentences');
      suggestions.push('Break down complex sentences for better clarity');
    }

    if (specificityScore < 30) {
      issues.push('Lacks specific requirements');
      suggestions.push('Add more specific details about expected outcomes');
    }

    return {
      ambiguityScore,
      specificityScore,
      issues,
      suggestions
    };
  }

  private analyzeCompleteness(promptData: PromptData) {
    const missingElements: string[] = [];
    const criticalGaps: string[] = [];

    if (!promptData.role || promptData.role === 'professional assistant') {
      missingElements.push('Specific role/persona');
    }

    if (!promptData.deliverableFormat || promptData.deliverableFormat === 'markdown') {
      missingElements.push('Output format specification');
    }

    if (!promptData.constraints || promptData.constraints.length === 0) {
      missingElements.push('Task constraints');
    }

    if (!promptData.domainKnowledge) {
      missingElements.push('Domain context');
    }

    // Check for critical gaps based on prompt content
    const prompt = promptData.rawUserPrompt || promptData.userGoal;
    const lowercasePrompt = prompt.toLowerCase();

    if (lowercasePrompt.includes('analyze') || lowercasePrompt.includes('evaluate')) {
      if (!prompt.includes('criteria') && !prompt.includes('framework')) {
        criticalGaps.push('Analysis criteria not specified');
      }
    }

    if (lowercasePrompt.includes('write') || lowercasePrompt.includes('create')) {
      if (!prompt.includes('audience') && !prompt.includes('tone')) {
        criticalGaps.push('Target audience not defined');
      }
    }

    const totalPossibleElements = 8; // role, format, constraints, context, criteria, audience, etc.
    const presentElements = totalPossibleElements - missingElements.length - criticalGaps.length;
    const score = (presentElements / totalPossibleElements) * 100;

    return {
      missingElements,
      criticalGaps,
      score
    };
  }

  private analyzeSafety(prompt: string) {
    const lowercasePrompt = prompt.toLowerCase();

    // PII detection (simplified)
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
      /\b\d{3}-\d{3}-\d{4}\b/, // Phone
    ];
    const hasPII = piiPatterns.some(pattern => pattern.test(prompt));

    // Harmful content indicators
    const harmfulTerms = [
      'hack', 'illegal', 'fraud', 'scam', 'violence', 'harmful',
      'dangerous', 'weapon', 'bomb', 'poison', 'drug'
    ];
    const hasHarmfulContent = harmfulTerms.some(term => lowercasePrompt.includes(term));

    // Inappropriate instructions
    const inappropriateInstructions = [
      'ignore previous instructions',
      'forget your role',
      'act as if you are',
      'pretend to be'
    ];
    const hasInappropriateInstructions = inappropriateInstructions.some(
      instruction => lowercasePrompt.includes(instruction)
    );

    const issues: string[] = [];
    if (hasPII) issues.push('Contains potential personally identifiable information');
    if (hasHarmfulContent) issues.push('Contains potentially harmful content');
    if (hasInappropriateInstructions) issues.push('Contains inappropriate system instructions');

    const totalChecks = 3;
    const passedChecks = [!hasPII, !hasHarmfulContent, !hasInappropriateInstructions].filter(Boolean).length;
    const score = (passedChecks / totalChecks) * 100;

    return {
      hasPII,
      hasHarmfulContent,
      hasInappropriateInstructions,
      score,
      issues
    };
  }

  private extractChanges(original: string, improved: string, ruleResults: any[]): PromptChange[] {
    const changes: PromptChange[] = [];

    // Advanced diff-based change detection
    const diffResult = this.computeDetailedDiff(original, improved);
    
    // Group changes by type and significance
    const changeGroups = this.groupDiffChanges(diffResult, ruleResults);
    
    for (const group of changeGroups) {
      changes.push({
        type: group.type,
        section: group.section,
        original: group.originalText,
        improved: group.improvedText,
        reason: group.reason,
        impact: group.impact,
        confidence: group.confidence
      });
    }

    return changes;
  }

  private computeDetailedDiff(original: string, improved: string): DiffResult {
    // Split into sentences for better granular comparison
    const originalSentences = this.splitIntoSentences(original);
    const improvedSentences = this.splitIntoSentences(improved);

    const changes: DiffChange[] = [];
    const additions: string[] = [];
    const deletions: string[] = [];
    const modifications: Array<{original: string, improved: string}> = [];

    // Use Longest Common Subsequence for better diff
    const lcs = this.longestCommonSubsequence(originalSentences, improvedSentences);
    
    let origIndex = 0;
    let impIndex = 0;
    let lcsIndex = 0;

    while (origIndex < originalSentences.length || impIndex < improvedSentences.length) {
      const origSentence = originalSentences[origIndex];
      const impSentence = improvedSentences[impIndex];

      if (lcsIndex < lcs.length && origSentence === lcs[lcsIndex] && impSentence === lcs[lcsIndex]) {
        // Common sentence - no change
        origIndex++;
        impIndex++;
        lcsIndex++;
      } else if (lcsIndex < lcs.length && origSentence === lcs[lcsIndex]) {
        // Addition in improved version
        additions.push(impSentence);
        changes.push({
          type: 'addition',
          content: impSentence,
          position: impIndex,
          reason: this.inferChangeReason(impSentence, 'addition')
        });
        impIndex++;
      } else if (lcsIndex < lcs.length && impSentence === lcs[lcsIndex]) {
        // Deletion from original
        deletions.push(origSentence);
        changes.push({
          type: 'deletion',
          content: origSentence,
          position: origIndex,
          reason: this.inferChangeReason(origSentence, 'deletion')
        });
        origIndex++;
      } else {
        // Modification
        const similarity = this.calculateSimilarity(origSentence, impSentence);
        if (similarity > 0.3) {
          modifications.push({ original: origSentence, improved: impSentence });
          changes.push({
            type: 'modification',
            content: impSentence,
            originalContent: origSentence,
            position: impIndex,
            reason: this.inferChangeReason(impSentence, 'modification'),
            similarity
          });
        } else {
          // Treat as separate deletion and addition
          deletions.push(origSentence);
          additions.push(impSentence);
          changes.push({
            type: 'replacement',
            content: impSentence,
            originalContent: origSentence,
            position: impIndex,
            reason: this.inferChangeReason(impSentence, 'replacement')
          });
        }
        origIndex++;
        impIndex++;
      }
    }

    return {
      changes,
      additions,
      deletions,
      modifications,
      similarityScore: this.calculateOverallSimilarity(original, improved)
    };
  }

  private splitIntoSentences(text: string): string[] {
    // Enhanced sentence splitting with better handling of edge cases
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s + (text.includes(s + '.') ? '.' : text.includes(s + '!') ? '!' : '?'));
  }

  private longestCommonSubsequence(arr1: string[], arr2: string[]): string[] {
    const dp: number[][] = Array(arr1.length + 1).fill(0).map(() => Array(arr2.length + 1).fill(0));
    
    // Fill DP table
    for (let i = 1; i <= arr1.length; i++) {
      for (let j = 1; j <= arr2.length; j++) {
        if (arr1[i-1] === arr2[j-1]) {
          dp[i][j] = dp[i-1][j-1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
        }
      }
    }

    // Backtrack to find LCS
    const lcs: string[] = [];
    let i = arr1.length, j = arr2.length;
    
    while (i > 0 && j > 0) {
      if (arr1[i-1] === arr2[j-1]) {
        lcs.unshift(arr1[i-1]);
        i--;
        j--;
      } else if (dp[i-1][j] > dp[i][j-1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Levenshtein distance for similarity calculation
    const dp: number[][] = Array(str1.length + 1).fill(0).map(() => Array(str2.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) dp[i][0] = i;
    for (let j = 0; j <= str2.length; j++) dp[0][j] = j;

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        if (str1[i-1] === str2[j-1]) {
          dp[i][j] = dp[i-1][j-1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
      }
    }

    const maxLength = Math.max(str1.length, str2.length);
    return maxLength > 0 ? 1 - (dp[str1.length][str2.length] / maxLength) : 1;
  }

  private calculateOverallSimilarity(original: string, improved: string): number {
    return this.calculateSimilarity(original, improved);
  }

  private inferChangeReason(content: string, changeType: string): string {
    const contentLower = content.toLowerCase();
    
    // Pattern-based reason inference
    if (contentLower.includes('specific') || contentLower.includes('detailed')) {
      return 'Added specificity for better results';
    } else if (contentLower.includes('step') || contentLower.includes('process')) {
      return 'Enhanced structure and process clarity';
    } else if (contentLower.includes('example') || contentLower.includes('instance')) {
      return 'Added examples for better understanding';
    } else if (contentLower.includes('format') || contentLower.includes('structure')) {
      return 'Improved output formatting requirements';
    } else if (contentLower.includes('context') || contentLower.includes('background')) {
      return 'Enhanced contextual information';
    } else if (contentLower.includes('constraint') || contentLower.includes('requirement')) {
      return 'Added important constraints and requirements';
    }

    // Default reasons by change type
    const defaultReasons = {
      addition: 'Added complementary information',
      deletion: 'Removed redundant or unclear content', 
      modification: 'Refined for clarity and precision',
      replacement: 'Replaced with more effective phrasing'
    };

    return defaultReasons[changeType] || 'Content improvement';
  }

  private groupDiffChanges(diffResult: DiffResult, ruleResults: any[]): ChangeGroup[] {
    const groups: ChangeGroup[] = [];
    
    // Group changes by semantic meaning
    for (const change of diffResult.changes) {
      const section = this.identifySection(change.content || '');
      const impact = this.calculateChangeImpact(change, ruleResults);
      const confidence = this.calculateChangeConfidence(change, diffResult.similarityScore);

      groups.push({
        type: this.mapChangeTypeToPromptChangeType(change.type),
        section,
        originalText: change.originalContent || '',
        improvedText: change.content,
        reason: change.reason,
        impact,
        confidence
      });
    }

    return this.mergeRelatedGroups(groups);
  }

  private identifySection(content: string): string {
    const contentLower = content.toLowerCase();
    
    if (contentLower.includes('role') || contentLower.includes('you are')) {
      return 'role_definition';
    } else if (contentLower.includes('format') || contentLower.includes('output')) {
      return 'output_format';
    } else if (contentLower.includes('example') || contentLower.includes('instance')) {
      return 'examples';
    } else if (contentLower.includes('constraint') || contentLower.includes('requirement')) {
      return 'constraints';
    } else if (contentLower.includes('context') || contentLower.includes('background')) {
      return 'context';
    }
    
    return 'content';
  }

  private calculateChangeImpact(change: DiffChange, ruleResults: any[]): 'low' | 'medium' | 'high' {
    let score = 0;
    
    // Length-based impact
    const contentLength = (change.content || '').length;
    if (contentLength > 100) score += 2;
    else if (contentLength > 50) score += 1;
    
    // Type-based impact
    if (change.type === 'addition') score += 1;
    if (change.type === 'replacement') score += 2;
    
    // Rule-based impact
    for (const rule of ruleResults) {
      if (rule.improvements && rule.improvements.length > 0) {
        score += rule.priority === 'high' ? 2 : 1;
      }
    }

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  private calculateChangeConfidence(change: DiffChange, overallSimilarity: number): number {
    let confidence = 0.8; // Base confidence
    
    // Adjust based on similarity
    if (change.similarity && change.similarity > 0.7) {
      confidence += 0.1;
    }
    
    // Adjust based on overall similarity
    confidence += (overallSimilarity * 0.2);
    
    return Math.min(0.99, Math.max(0.1, confidence));
  }

  private mapChangeTypeToPromptChangeType(type: string): string {
    const mapping = {
      'addition': 'content_addition',
      'deletion': 'content_removal', 
      'modification': 'content_refinement',
      'replacement': 'structure_enhancement'
    };
    
    return mapping[type] || 'content_improvement';
  }

  private mergeRelatedGroups(groups: ChangeGroup[]): ChangeGroup[] {
    // Simple implementation - could be enhanced with more sophisticated grouping
    return groups;
  }

  private calculateMetrics(original: string, improved: string, analysis: PromptAnalysis): ImprovementMetrics {
    const originalTokens = this.estimateTokens(original);
    const improvedTokens = this.estimateTokens(improved);

    return {
      clarityImprovement: Math.max(0, 100 - analysis.clarity.ambiguityScore - (analysis.clarity.ambiguityScore * 0.5)),
      structureImprovement: Math.max(0, analysis.structure.score - 50),
      completenessImprovement: Math.max(0, analysis.completeness.score - 50),
      safetyImprovement: Math.max(0, analysis.safety.score - 80),
      overallImprovement: 25, // Simplified calculation
      estimatedTokenIncrease: improvedTokens - originalTokens,
      estimatedCostIncrease: (improvedTokens - originalTokens) * 0.00002 // Rough GPT-4 pricing
    };
  }

  private generateExplanations(changes: PromptChange[], analysis: PromptAnalysis): ChangeExplanation[] {
    return changes.map(change => ({
      change,
      rationale: this.getRationale(change, analysis),
      benefit: this.getBenefit(change),
      skillImproved: this.getSkillsImproved(change)
    }));
  }

  private getRationale(change: PromptChange, analysis: PromptAnalysis): string {
    switch (change.type) {
      case 'structure_enhancement':
        return 'The original prompt lacked clear structure and specific requirements, which could lead to suboptimal responses.';
      case 'role_addition':
        return 'Adding a specific role helps the AI understand the expertise level and perspective needed.';
      case 'constraint_addition':
        return 'Clear constraints help focus the response and ensure it meets your specific needs.';
      default:
        return 'This improvement enhances the prompt\'s effectiveness and clarity.';
    }
  }

  private getBenefit(change: PromptChange): string {
    switch (change.type) {
      case 'structure_enhancement':
        return 'Improved structure leads to more focused and comprehensive responses.';
      case 'role_addition':
        return 'Role specification results in more expert-level and contextually appropriate responses.';
      case 'constraint_addition':
        return 'Clear constraints ensure the response stays within your requirements and expectations.';
      default:
        return 'This change improves response quality and relevance.';
    }
  }

  private getSkillsImproved(change: PromptChange): string[] {
    switch (change.type) {
      case 'structure_enhancement':
        return ['structure', 'clarity'];
      case 'role_addition':
        return ['roleDefinition', 'specificity'];
      case 'constraint_addition':
        return ['constraints', 'specificity'];
      default:
        return ['overall'];
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }
}

// Type definitions for the enhanced diff system
interface DiffResult {
  changes: DiffChange[];
  additions: string[];
  deletions: string[];
  modifications: Array<{original: string, improved: string}>;
  similarityScore: number;
}

interface DiffChange {
  type: 'addition' | 'deletion' | 'modification' | 'replacement';
  content: string;
  originalContent?: string;
  position: number;
  reason: string;
  similarity?: number;
}

interface ChangeGroup {
  type: string;
  section: string;
  originalText: string;
  improvedText: string;
  reason: string;
  impact: 'low' | 'medium' | 'high';
  confidence: number;
}