import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

export interface PromptDNA {
  fingerprint: string;
  generation: number;
  evolutionScore: number;
  traits: {
    style: StyleTraits;
    complexity: ComplexityTraits;
    structure: StructureTraits;
    effectiveness: EffectivenessTraits;
  };
  genetics: {
    strengths: string[];
    weaknesses: string[];
    mutations: PromptMutation[];
    lineage: LineageInfo[];
    similarPrompts: GeneticMatch[];
  };
  analysis: {
    readabilityScore: number;
    clarityScore: number;
    specificityScore: number;
    completenessScore: number;
    coherenceScore: number;
  };
}

interface StyleTraits {
  primary: 'formal' | 'casual' | 'technical' | 'creative' | 'academic';
  confidence: number;
  markers: string[];
  distribution: Record<string, number>;
}

interface ComplexityTraits {
  level: 'simple' | 'intermediate' | 'advanced' | 'expert';
  score: number;
  metrics: {
    avgWordLength: number;
    avgSentenceLength: number;
    syllablesPerWord: number;
    vocabularyDiversity: number;
    structuralComplexity: number;
  };
}

interface StructureTraits {
  pattern: 'organized' | 'narrative' | 'analytical' | 'instructional' | 'conversational';
  confidence: number;
  coherence: number;
  logicalFlow: number;
  sectionBalance: number;
}

interface EffectivenessTraits {
  clarity: number;
  specificity: number;
  actionability: number;
  completeness: number;
  engagement: number;
}

interface PromptMutation {
  type: 'clarity_enhancement' | 'specificity_boost' | 'structure_improvement' | 'example_injection' | 'constraint_addition';
  description: string;
  impact: 'low' | 'medium' | 'high';
  confidence: number;
  implementation: string;
  estimatedImprovement: number;
}

interface GeneticMatch {
  promptId: string;
  similarity: number;
  sharedTraits: string[];
  differences: string[];
  relationship: 'sibling' | 'cousin' | 'distant' | 'variant';
}

interface LineageInfo {
  ancestorId?: string;
  parentId?: string;
  generation: number;
  mutations: string[];
  creationMethod: 'manual' | 'ai_generated' | 'template_based' | 'evolved';
}

@Injectable()
export class DNAAnalysisService {
  private readonly logger = new Logger(DNAAnalysisService.name);

  constructor(private prisma: PrismaService) {}

  private readonly geneticMarkers = {
    style: {
      formal: [
        'hereby', 'whereas', 'shall', 'pursuant', 'respectively', 'therefore',
        'furthermore', 'moreover', 'nevertheless', 'consequently', 'accordingly'
      ],
      casual: [
        'hey', 'gonna', 'stuff', 'like', 'basically', 'pretty much', 'kind of',
        'sort of', 'you know', 'thing is', 'anyway', 'whatever'
      ],
      technical: [
        'algorithm', 'implementation', 'architecture', 'optimize', 'performance',
        'parameter', 'configuration', 'methodology', 'framework', 'protocol',
        'specification', 'interface', 'integration', 'deployment'
      ],
      creative: [
        'imagine', 'envision', 'craft', 'weave', 'paint', 'storytelling',
        'narrative', 'artistic', 'innovative', 'inspiration', 'vision',
        'creative', 'original', 'unique', 'expressive'
      ],
      academic: [
        'research', 'analysis', 'hypothesis', 'methodology', 'findings',
        'conclusion', 'evidence', 'study', 'investigation', 'literature',
        'theoretical', 'empirical', 'scholarly', 'peer-reviewed'
      ]
    },

    structure: {
      organized: [
        'first', 'second', 'third', 'finally', 'step', 'phase', 'section',
        'next', 'then', 'subsequently', 'following', 'outlined', 'structured'
      ],
      narrative: [
        'once', 'then', 'after', 'meanwhile', 'subsequently', 'during',
        'before', 'while', 'throughout', 'eventually', 'story', 'journey'
      ],
      analytical: [
        'therefore', 'however', 'moreover', 'consequently', 'thus',
        'furthermore', 'nevertheless', 'alternatively', 'specifically',
        'particularly', 'notably', 'significantly'
      ],
      instructional: [
        'should', 'must', 'need to', 'required', 'ensure', 'make sure',
        'remember', 'important', 'note that', 'follow', 'complete', 'perform'
      ],
      conversational: [
        'you', 'your', 'we', 'our', 'let\'s', 'can you', 'would you',
        'please', 'thanks', 'feel free', 'don\'t hesitate', 'question'
      ]
    },

    complexity: {
      simple: {
        avgWordLength: { min: 3, max: 5 },
        sentenceLength: { min: 5, max: 15 },
        syllablesPerWord: { min: 1, max: 2 }
      },
      intermediate: {
        avgWordLength: { min: 4, max: 7 },
        sentenceLength: { min: 10, max: 25 },
        syllablesPerWord: { min: 1.5, max: 2.5 }
      },
      advanced: {
        avgWordLength: { min: 6, max: 9 },
        sentenceLength: { min: 15, max: 35 },
        syllablesPerWord: { min: 2, max: 3.5 }
      },
      expert: {
        avgWordLength: { min: 7, max: 12 },
        sentenceLength: { min: 20, max: 50 },
        syllablesPerWord: { min: 2.5, max: 4 }
      }
    }
  };

  async analyzePromptDNA(promptId: string, promptText: string): Promise<PromptDNA> {
    this.logger.log(`Analyzing DNA for prompt ${promptId}`);

    // Perform comprehensive analysis
    const [
      styleTraits,
      complexityTraits,
      structureTraits,
      effectivenessTraits,
      readabilityScore,
      clarityScore,
      specificityScore,
      completenessScore,
      coherenceScore
    ] = await Promise.all([
      this.analyzeStyle(promptText),
      this.analyzeComplexity(promptText),
      this.analyzeStructure(promptText),
      this.analyzeEffectiveness(promptText),
      this.calculateReadabilityScore(promptText),
      this.calculateClarityScore(promptText),
      this.calculateSpecificityScore(promptText),
      this.calculateCompletenessScore(promptText),
      this.calculateCoherenceScore(promptText)
    ]);

    // Calculate DNA fingerprint
    const fingerprint = this.calculateFingerprint({
      style: styleTraits,
      complexity: complexityTraits,
      structure: structureTraits,
      effectiveness: effectivenessTraits,
      analysis: {
        readabilityScore,
        clarityScore,
        specificityScore,
        completenessScore,
        coherenceScore
      }
    });

    // Find genetic relationships
    const [similarPrompts, lineage] = await Promise.all([
      this.findGeneticMatches(fingerprint, promptText),
      this.traceLineage(promptId)
    ]);

    // Generate mutations and improvements
    const mutations = this.suggestMutations(promptText, {
      style: styleTraits,
      complexity: complexityTraits,
      structure: structureTraits,
      effectiveness: effectivenessTraits
    });

    // Identify strengths and weaknesses
    const strengths = this.identifyStrengths({
      style: styleTraits,
      complexity: complexityTraits,
      structure: structureTraits,
      effectiveness: effectivenessTraits
    });

    const weaknesses = this.identifyWeaknesses({
      style: styleTraits,
      complexity: complexityTraits,
      structure: structureTraits,
      effectiveness: effectivenessTraits
    });

    // Calculate generation and evolution score
    const generation = await this.determineGeneration(fingerprint);
    const evolutionScore = this.calculateEvolutionScore({
      clarity: clarityScore,
      specificity: specificityScore,
      completeness: completenessScore,
      coherence: coherenceScore,
      complexity: complexityTraits.score
    });

    const dna: PromptDNA = {
      fingerprint,
      generation,
      evolutionScore,
      traits: {
        style: styleTraits,
        complexity: complexityTraits,
        structure: structureTraits,
        effectiveness: effectivenessTraits
      },
      genetics: {
        strengths,
        weaknesses,
        mutations,
        lineage,
        similarPrompts
      },
      analysis: {
        readabilityScore,
        clarityScore,
        specificityScore,
        completenessScore,
        coherenceScore
      }
    };

    // Store DNA analysis
    await this.storeDNAAnalysis(promptId, dna);

    return dna;
  }

  private async analyzeStyle(text: string): Promise<StyleTraits> {
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 0);
    const distribution: Record<string, number> = {};

    // Analyze style markers
    for (const [style, markers] of Object.entries(this.geneticMarkers.style)) {
      const matches = markers.filter(marker => 
        text.toLowerCase().includes(marker.toLowerCase())
      ).length;
      distribution[style] = matches / markers.length;
    }

    // Determine primary style
    const primary = Object.entries(distribution)
      .sort(([,a], [,b]) => b - a)[0][0] as StyleTraits['primary'];

    const confidence = distribution[primary] || 0;

    const foundMarkers = Object.entries(this.geneticMarkers.style)
      .flatMap(([style, markers]) => 
        markers.filter(marker => text.toLowerCase().includes(marker.toLowerCase()))
      );

    return {
      primary,
      confidence: Math.min(1, confidence * 2), // Normalize to 0-1
      markers: foundMarkers,
      distribution
    };
  }

  private async analyzeComplexity(text: string): Promise<ComplexityTraits> {
    const words = text.split(/\W+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const avgSentenceLength = words.length / sentences.length;
    const syllablesPerWord = words.reduce((sum, word) => sum + this.countSyllables(word), 0) / words.length;
    
    // Calculate vocabulary diversity (unique words / total words)
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const vocabularyDiversity = uniqueWords.size / words.length;

    // Calculate structural complexity
    const structuralComplexity = this.calculateStructuralComplexity(text);

    const metrics = {
      avgWordLength,
      avgSentenceLength,
      syllablesPerWord,
      vocabularyDiversity,
      structuralComplexity
    };

    // Determine complexity level
    let level: ComplexityTraits['level'] = 'simple';
    let score = 0;

    for (const [complexityLevel, thresholds] of Object.entries(this.geneticMarkers.complexity)) {
      const wordLengthMatch = avgWordLength >= thresholds.avgWordLength.min && avgWordLength <= thresholds.avgWordLength.max;
      const sentenceLengthMatch = avgSentenceLength >= thresholds.sentenceLength.min && avgSentenceLength <= thresholds.sentenceLength.max;
      const syllableMatch = syllablesPerWord >= thresholds.syllablesPerWord.min && syllablesPerWord <= thresholds.syllablesPerWord.max;

      if (wordLengthMatch && sentenceLengthMatch && syllableMatch) {
        level = complexityLevel as ComplexityTraits['level'];
        break;
      }
    }

    // Calculate complexity score
    score = (avgWordLength / 12) * 0.3 + 
            (avgSentenceLength / 50) * 0.3 + 
            (syllablesPerWord / 4) * 0.2 + 
            vocabularyDiversity * 0.2;

    return {
      level,
      score: Math.min(1, score),
      metrics
    };
  }

  private async analyzeStructure(text: string): Promise<StructureTraits> {
    const distribution: Record<string, number> = {};

    // Analyze structure markers
    for (const [pattern, markers] of Object.entries(this.geneticMarkers.structure)) {
      const matches = markers.filter(marker => 
        text.toLowerCase().includes(marker.toLowerCase())
      ).length;
      distribution[pattern] = matches / markers.length;
    }

    // Determine primary pattern
    const pattern = Object.entries(distribution)
      .sort(([,a], [,b]) => b - a)[0][0] as StructureTraits['pattern'];

    const confidence = distribution[pattern] || 0;

    // Calculate coherence and logical flow
    const coherence = this.calculateCoherenceScore(text);
    const logicalFlow = this.calculateLogicalFlow(text);
    const sectionBalance = this.calculateSectionBalance(text);

    return {
      pattern,
      confidence: Math.min(1, confidence * 2),
      coherence,
      logicalFlow,
      sectionBalance
    };
  }

  private async analyzeEffectiveness(text: string): Promise<EffectivenessTraits> {
    return {
      clarity: this.calculateClarityScore(text),
      specificity: this.calculateSpecificityScore(text),
      actionability: this.calculateActionabilityScore(text),
      completeness: this.calculateCompletenessScore(text),
      engagement: this.calculateEngagementScore(text)
    };
  }

  private calculateFingerprint(analysis: any): string {
    const traits = [
      analysis.style.primary,
      analysis.complexity.level,
      analysis.structure.pattern,
      Math.round(analysis.analysis.clarityScore * 100),
      Math.round(analysis.analysis.specificityScore * 100),
      Math.round(analysis.effectiveness.clarity * 100)
    ].join(':');
    
    return crypto.createHash('sha256').update(traits).digest('hex').substring(0, 16);
  }

  private async findGeneticMatches(fingerprint: string, promptText: string, threshold = 0.7): Promise<GeneticMatch[]> {
    // ISSUE: Model 'promptDNAAnalysis' does not exist in Prisma schema
    // FIX: Create PromptDNAAnalysis model with fingerprint, similarity fields
    const candidates = await this.prisma.promptDNAAnalysis.findMany({
      where: {
        fingerprint: { not: fingerprint }
      },
      include: {
        prompt: {
          select: { id: true, content: true }
        }
      },
      take: 100
    });

    const matches: GeneticMatch[] = [];

    for (const candidate of candidates) {
      const similarity = this.calculateSimilarity(fingerprint, candidate.fingerprint);
      
      if (similarity >= threshold) {
        const relationship = this.determineRelationship(similarity);
        const sharedTraits = this.identifySharedTraits(promptText, candidate.prompt.content);
        const differences = this.identifyDifferences(promptText, candidate.prompt.content);

        matches.push({
          promptId: candidate.prompt.id,
          similarity,
          sharedTraits,
          differences,
          relationship
        });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
  }

  private calculateSimilarity(fingerprint1: string, fingerprint2: string): number {
    // Simple similarity calculation based on fingerprint comparison
    let matches = 0;
    const length = Math.min(fingerprint1.length, fingerprint2.length);
    
    for (let i = 0; i < length; i++) {
      if (fingerprint1[i] === fingerprint2[i]) {
        matches++;
      }
    }
    
    return matches / length;
  }

  private determineRelationship(similarity: number): GeneticMatch['relationship'] {
    if (similarity >= 0.9) return 'sibling';
    if (similarity >= 0.8) return 'cousin';
    if (similarity >= 0.7) return 'variant';
    return 'distant';
  }

  private identifySharedTraits(text1: string, text2: string): string[] {
    const traits: string[] = [];
    
    // Simple trait identification based on common patterns
    const patterns = [
      { name: 'uses examples', regex: /example|for instance|such as/i },
      { name: 'asks questions', regex: /\?/g },
      { name: 'uses bullet points', regex: /^[-*•]/m },
      { name: 'formal tone', regex: /shall|must|should|require/i },
      { name: 'casual tone', regex: /hey|gonna|stuff|like/i }
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(text1) && pattern.regex.test(text2)) {
        traits.push(pattern.name);
      }
    }

    return traits;
  }

  private identifyDifferences(text1: string, text2: string): string[] {
    const differences: string[] = [];
    
    const length1 = text1.length;
    const length2 = text2.length;
    
    if (Math.abs(length1 - length2) / Math.max(length1, length2) > 0.5) {
      differences.push('significantly different length');
    }

    // Add more difference detection logic here
    
    return differences;
  }

  private async traceLineage(promptId: string): Promise<LineageInfo[]> {
    // In production, this would trace the prompt's evolution history
    return [{
      generation: 1,
      mutations: [],
      creationMethod: 'manual'
    }];
  }

  private suggestMutations(text: string, traits: any): PromptMutation[] {
    const mutations: PromptMutation[] = [];

    // Analyze for improvement opportunities
    if (traits.effectiveness.clarity < 0.7) {
      mutations.push({
        type: 'clarity_enhancement',
        description: 'Simplify complex sentences and reduce ambiguity',
        impact: 'high',
        confidence: 0.85,
        implementation: this.generateClarityMutation(text),
        estimatedImprovement: 0.2
      });
    }

    if (traits.effectiveness.specificity < 0.6) {
      mutations.push({
        type: 'specificity_boost',
        description: 'Add concrete details and specific examples',
        impact: 'high',
        confidence: 0.8,
        implementation: this.generateSpecificityMutation(text),
        estimatedImprovement: 0.25
      });
    }

    if (!this.hasExamples(text)) {
      mutations.push({
        type: 'example_injection',
        description: 'Add illustrative examples to improve understanding',
        impact: 'medium',
        confidence: 0.9,
        implementation: this.generateExampleMutation(text),
        estimatedImprovement: 0.15
      });
    }

    if (traits.structure.coherence < 0.7) {
      mutations.push({
        type: 'structure_improvement',
        description: 'Reorganize content for better logical flow',
        impact: 'medium',
        confidence: 0.75,
        implementation: this.generateStructureMutation(text),
        estimatedImprovement: 0.18
      });
    }

    return mutations;
  }

  private generateClarityMutation(text: string): string {
    return `Consider breaking down complex sentences and using simpler vocabulary. For example, replace technical jargon with everyday terms where possible.`;
  }

  private generateSpecificityMutation(text: string): string {
    return `Add specific examples, numbers, or concrete details. Instead of "improve performance," specify "reduce response time by 20%" or "increase accuracy to 95%."`;
  }

  private generateExampleMutation(text: string): string {
    return `Add examples section:\n\nExample:\nInput: [specific example input]\nOutput: [expected output format]\n\nThis helps clarify expectations.`;
  }

  private generateStructureMutation(text: string): string {
    return `Reorganize using clear sections:\n1. Context/Background\n2. Specific Task\n3. Requirements\n4. Output Format\n5. Examples`;
  }

  private identifyStrengths(traits: any): string[] {
    const strengths: string[] = [];

    if (traits.effectiveness.clarity > 0.8) {
      strengths.push('Excellent clarity and readability');
    }

    if (traits.effectiveness.specificity > 0.8) {
      strengths.push('High specificity and detail');
    }

    if (traits.structure.coherence > 0.8) {
      strengths.push('Strong logical structure');
    }

    if (traits.complexity.metrics.vocabularyDiversity > 0.7) {
      strengths.push('Rich vocabulary and expression');
    }

    return strengths;
  }

  private identifyWeaknesses(traits: any): string[] {
    const weaknesses: string[] = [];

    if (traits.effectiveness.clarity < 0.6) {
      weaknesses.push('Low clarity - may be confusing');
    }

    if (traits.effectiveness.specificity < 0.5) {
      weaknesses.push('Lacks specific details');
    }

    if (traits.structure.coherence < 0.6) {
      weaknesses.push('Poor logical flow');
    }

    if (traits.effectiveness.completeness < 0.6) {
      weaknesses.push('Incomplete requirements or context');
    }

    return weaknesses;
  }

  private async determineGeneration(fingerprint: string): Promise<number> {
    // Count similar prompts to estimate generation
    const similarCount = await this.prisma.promptDNAAnalysis.count({
      where: {
        fingerprint: {
          startsWith: fingerprint.substring(0, 8)
        }
      }
    });

    return Math.floor(similarCount / 10) + 1;
  }

  private calculateEvolutionScore(metrics: any): number {
    const weights = {
      clarity: 0.25,
      specificity: 0.25,
      completeness: 0.2,
      coherence: 0.2,
      complexity: 0.1
    };

    return (
      metrics.clarity * weights.clarity +
      metrics.specificity * weights.specificity +
      metrics.completeness * weights.completeness +
      metrics.coherence * weights.coherence +
      metrics.complexity * weights.complexity
    );
  }

  // Helper methods for scoring
  private calculateReadabilityScore(text: string): number {
    const words = text.split(/\W+/).filter(w => w.length > 0).length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const syllables = this.countSyllables(text);
    
    // Simplified Flesch reading ease
    const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
    
    return Math.max(0, Math.min(1, score / 100));
  }

  private calculateClarityScore(text: string): number {
    let score = 1.0;
    
    // Deduct for overly complex sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength = text.split(/\W+/).length / sentences.length;
    
    if (avgSentenceLength > 25) score -= 0.2;
    if (avgSentenceLength > 35) score -= 0.2;
    
    // Deduct for ambiguous language
    const ambiguousWords = ['might', 'could', 'maybe', 'possibly', 'perhaps'];
    const ambiguousCount = ambiguousWords.filter(word => 
      text.toLowerCase().includes(word)
    ).length;
    
    score -= (ambiguousCount * 0.1);
    
    return Math.max(0, score);
  }

  private calculateSpecificityScore(text: string): number {
    let score = 0;
    
    // Check for specific indicators
    const specificIndicators = [
      /\d+/, // numbers
      /\b[A-Z]{2,}\b/, // acronyms
      /\b\w+\.\w+\b/, // technical terms with dots
      /"[^"]*"/, // quoted terms
      /\b(exactly|specifically|precisely|particular)\b/i
    ];
    
    for (const indicator of specificIndicators) {
      if (indicator.test(text)) score += 0.2;
    }
    
    return Math.min(1, score);
  }

  private calculateCompletenessScore(text: string): number {
    let score = 0;
    
    // Check for essential components
    const components = [
      { pattern: /\b(task|goal|objective)\b/i, weight: 0.3 },
      { pattern: /\b(context|background|situation)\b/i, weight: 0.2 },
      { pattern: /\b(format|structure|output)\b/i, weight: 0.2 },
      { pattern: /\b(example|instance|sample)\b/i, weight: 0.15 },
      { pattern: /\b(constraint|requirement|limit)\b/i, weight: 0.15 }
    ];
    
    for (const component of components) {
      if (component.pattern.test(text)) {
        score += component.weight;
      }
    }
    
    return Math.min(1, score);
  }

  private calculateCoherenceScore(text: string): number {
    // Simple coherence based on transition words and sentence flow
    const transitionWords = [
      'therefore', 'however', 'moreover', 'furthermore', 'additionally',
      'consequently', 'meanwhile', 'subsequently', 'similarly', 'likewise'
    ];
    
    const transitionCount = transitionWords.filter(word => 
      text.toLowerCase().includes(word)
    ).length;
    
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    
    return Math.min(1, transitionCount / (sentences * 0.2));
  }

  private calculateActionabilityScore(text: string): number {
    const actionWords = [
      'create', 'write', 'analyze', 'generate', 'provide', 'explain',
      'describe', 'list', 'compare', 'evaluate', 'summarize', 'design'
    ];
    
    const actionCount = actionWords.filter(word => 
      text.toLowerCase().includes(word)
    ).length;
    
    return Math.min(1, actionCount * 0.2);
  }

  private calculateEngagementScore(text: string): number {
    let score = 0;
    
    // Check for engaging elements
    if (/\?/.test(text)) score += 0.2; // questions
    if (/!/.test(text)) score += 0.1; // exclamations
    if (/\b(you|your)\b/i.test(text)) score += 0.3; // direct address
    if (/\b(imagine|consider|think)\b/i.test(text)) score += 0.2; // engagement words
    
    return Math.min(1, score);
  }

  private calculateStructuralComplexity(text: string): number {
    let complexity = 0;
    
    // Count nested structures
    const bulletPoints = (text.match(/^[-*•]/gm) || []).length;
    const numberedLists = (text.match(/^\d+\./gm) || []).length;
    const subsections = (text.match(/\n\s*[A-Z][^.\n]*:\s*\n/g) || []).length;
    
    complexity = (bulletPoints * 0.1) + (numberedLists * 0.1) + (subsections * 0.2);
    
    return Math.min(1, complexity);
  }

  private calculateLogicalFlow(text: string): number {
    // Analyze sentence connections and topic consistency
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let connections = 0;
    const connectionWords = ['therefore', 'because', 'since', 'thus', 'so', 'then'];
    
    for (const word of connectionWords) {
      connections += (text.toLowerCase().match(new RegExp(word, 'g')) || []).length;
    }
    
    return Math.min(1, connections / (sentences.length * 0.3));
  }

  private calculateSectionBalance(text: string): number {
    const sections = text.split(/\n\s*\n/).filter(s => s.trim().length > 0);
    
    if (sections.length < 2) return 0.5;
    
    const lengths = sections.map(s => s.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    
    const variance = lengths.reduce((sum, length) => {
      return sum + Math.pow(length - avgLength, 2);
    }, 0) / lengths.length;
    
    const standardDeviation = Math.sqrt(variance);
    const coefficientOfVariation = standardDeviation / avgLength;
    
    return Math.max(0, 1 - coefficientOfVariation);
  }

  private hasExamples(text: string): boolean {
    const exampleIndicators = [
      /\bexample\b/i,
      /\bfor instance\b/i,
      /\bsuch as\b/i,
      /\be\.g\./i,
      /\binput.*output\b/i
    ];
    
    return exampleIndicators.some(pattern => pattern.test(text));
  }

  private countSyllables(text: string): number {
    return text.toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/[aeiouy]+/g, 'a')
      .length;
  }

  private async storeDNAAnalysis(promptId: string, dna: PromptDNA): Promise<void> {
    await this.prisma.promptDNAAnalysis.upsert({
      where: { promptId },
      update: {
        fingerprint: dna.fingerprint,
        generation: dna.generation,
        evolutionScore: dna.evolutionScore,
        traits: dna.traits,
        genetics: dna.genetics,
        analysis: dna.analysis,
        analyzedAt: new Date()
      },
      create: {
        promptId,
        fingerprint: dna.fingerprint,
        generation: dna.generation,
        evolutionScore: dna.evolutionScore,
        traits: dna.traits,
        genetics: dna.genetics,
        analysis: dna.analysis,
        analyzedAt: new Date()
      }
    });
  }

  async getPromptGenealogy(promptId: string): Promise<any> {
    const dna = await this.prisma.promptDNAAnalysis.findUnique({
      where: { promptId }
    });

    if (!dna) {
      throw new BadRequestException('DNA analysis not found for this prompt');
    }

    // Build family tree
    const familyTree = await this.buildFamilyTree(dna.fingerprint);
    
    return {
      promptId,
      fingerprint: dna.fingerprint,
      generation: dna.generation,
      lineage: dna.genetics.lineage,
      familyTree,
      relatedPrompts: dna.genetics.similarPrompts
    };
  }

  private async buildFamilyTree(fingerprint: string): Promise<any> {
    // Implementation for building prompt family tree
    return {
      ancestors: [],
      siblings: [],
      descendants: []
    };
  }

  async evolvePormpt(promptId: string, targetTraits: string[]): Promise<string> {
    const dna = await this.prisma.promptDNAAnalysis.findUnique({
      where: { promptId },
      include: { prompt: true }
    });

    if (!dna) {
      throw new BadRequestException('DNA analysis not found');
    }

    // Apply targeted mutations
    let evolvedPrompt = dna.prompt.content;
    
    for (const trait of targetTraits) {
      evolvedPrompt = this.applyEvolutionStrategy(evolvedPrompt, trait);
    }

    return evolvedPrompt;
  }

  private applyEvolutionStrategy(prompt: string, trait: string): string {
    switch (trait) {
      case 'clarity':
        return this.enhanceClarity(prompt);
      case 'specificity':
        return this.boostSpecificity(prompt);
      case 'structure':
        return this.improveStructure(prompt);
      default:
        return prompt;
    }
  }

  private enhanceClarity(prompt: string): string {
    // Implementation for clarity enhancement
    return prompt + '\n\n[Clarity Enhancement: Break down complex concepts into simpler terms]';
  }

  private boostSpecificity(prompt: string): string {
    // Implementation for specificity boost
    return prompt + '\n\n[Specificity Boost: Add concrete examples and measurable criteria]';
  }

  private improveStructure(prompt: string): string {
    // Implementation for structure improvement
    return `## Task Overview\n${prompt}\n\n## Requirements\n[List specific requirements]\n\n## Output Format\n[Specify desired format]`;
  }
}