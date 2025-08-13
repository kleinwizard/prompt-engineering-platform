export interface PromptData {
  userGoal: string;
  rawUserPrompt: string;
  domainKnowledge?: string;
  role?: string;
  tone?: string;
  taskDescription?: string;
  deliverableFormat?: string;
  availableTools?: string[];
  constraints?: string[];
  wordLimit?: number;
  additionalContext?: Record<string, any>;
  enhancementLevel?: EnhancementLevel;
  previousInteractions?: InteractionHistory[];
}

export type EnhancementLevel = 'low' | 'med' | 'high' | 'pro';

export interface InteractionHistory {
  prompt: string;
  response: string;
  timestamp: Date;
  model: string;
}

export interface PromptAnalysis {
  complexity: ComplexityAnalysis;
  structure: StructureAnalysis;
  clarity: ClarityAnalysis;
  completeness: CompletenessAnalysis;
  safety: SafetyAnalysis;
}

export interface ComplexityAnalysis {
  score: number; // 0-6
  factors: ComplexityFactors;
  assessment: string;
  recommendedLevel: EnhancementLevel;
}

export interface ComplexityFactors {
  length: boolean;
  technicalTerms: boolean;
  multipleSteps: boolean;
  requiresTools: boolean;
  specificFormat: boolean;
  creativeTask: boolean;
}

export interface StructureAnalysis {
  hasRole: boolean;
  hasTask: boolean;
  hasConstraints: boolean;
  hasFormat: boolean;
  hasExamples: boolean;
  score: number; // 0-100
}

export interface ClarityAnalysis {
  ambiguityScore: number; // 0-100 (lower is better)
  specificityScore: number; // 0-100
  issues: string[];
  suggestions: string[];
}

export interface CompletenessAnalysis {
  missingElements: string[];
  score: number; // 0-100
  criticalGaps: string[];
}

export interface SafetyAnalysis {
  hasPII: boolean;
  hasHarmfulContent: boolean;
  hasInappropriateInstructions: boolean;
  score: number; // 0-100
  issues: string[];
}

export interface ImprovementResult {
  originalPrompt: string;
  improvedPrompt: string;
  changes: PromptChange[];
  analysis: PromptAnalysis;
  metrics: ImprovementMetrics;
  explanations: ChangeExplanation[];
}

export interface PromptChange {
  type: ChangeType;
  section: string;
  original: string;
  improved: string;
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

export type ChangeType = 
  | 'role_addition'
  | 'constraint_addition'
  | 'format_specification'
  | 'clarity_improvement'
  | 'structure_enhancement'
  | 'safety_improvement'
  | 'context_addition'
  | 'example_addition';

export interface ImprovementMetrics {
  clarityImprovement: number;
  structureImprovement: number;
  completenessImprovement: number;
  safetyImprovement: number;
  overallImprovement: number;
  estimatedTokenIncrease: number;
  estimatedCostIncrease: number;
}

export interface ChangeExplanation {
  change: PromptChange;
  rationale: string;
  benefit: string;
  skillImproved: string[];
}

export interface RuleResult {
  applicable: boolean;
  improvements: string[];
  priority: 'high' | 'medium' | 'low';
  category: string;
}

export interface PromptRubric {
  specificity: RubricCriteria;
  constraints: RubricCriteria;
  structure: RubricCriteria;
  roleDefinition: RubricCriteria;
  outputFormat: RubricCriteria;
  verification: RubricCriteria;
  safety: RubricCriteria;
}

export interface RubricCriteria {
  weight: number;
  maxScore: number;
  description: string;
  levels: RubricLevel[];
}

export interface RubricLevel {
  score: number;
  description: string;
  examples?: string[];
}

export interface SkillScores {
  specificity: number;
  constraints: number;
  structure: number;
  roleDefinition: number;
  outputFormat: number;
  verification: number;
  safety: number;
  overall?: number;
}

export interface CoachingTip {
  category: string;
  title: string;
  description: string;
  example?: string;
  relatedSkills: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}