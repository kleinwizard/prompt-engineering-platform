import { PromptData, PromptAnalysis, RuleResult } from '../types';

export class RulesEngine {
  private rules: PromptRule[] = [
    new SpecificityRule(),
    new StructureRule(),
    new RoleDefinitionRule(),
    new ConstraintRule(),
    new FormatSpecificationRule(),
    new ExampleRule(),
    new SafetyRule(),
    new ClarityRule(),
  ];

  async applyRules(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult[]> {
    const results: RuleResult[] = [];

    for (const rule of this.rules) {
      const result = await rule.evaluate(promptData, analysis);
      if (result.applicable) {
        results.push(result);
      }
    }

    return results.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }
}

abstract class PromptRule {
  abstract name: string;
  abstract category: string;
  abstract evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult>;
}

class SpecificityRule extends PromptRule {
  name = 'Specificity Enhancement';
  category = 'clarity';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const prompt = promptData.rawUserPrompt;
    const improvements: string[] = [];
    
    // Check for vague terms
    const vagueTerms = ['something', 'anything', 'stuff', 'things', 'good', 'bad', 'nice'];
    const foundVague = vagueTerms.filter(term => 
      prompt.toLowerCase().includes(term)
    );

    if (foundVague.length > 0) {
      improvements.push(`Replace vague terms: ${foundVague.join(', ')}`);
    }

    // Check for specific measurements
    if (!prompt.match(/\d+\s*(words|characters|items|examples|steps)/i)) {
      improvements.push('Add specific quantities or measurements');
    }

    // Check for concrete examples
    if (!prompt.toLowerCase().includes('example') && !prompt.includes('e.g.')) {
      improvements.push('Consider adding concrete examples');
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'high',
      category: this.category,
    };
  }
}

class StructureRule extends PromptRule {
  name = 'Structure Enhancement';
  category = 'organization';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];

    if (!analysis.structure.hasRole) {
      improvements.push('Add a clear role or persona definition');
    }

    if (!analysis.structure.hasTask) {
      improvements.push('Explicitly state the task or objective');
    }

    if (!analysis.structure.hasConstraints) {
      improvements.push('Include relevant constraints or requirements');
    }

    if (!analysis.structure.hasFormat) {
      improvements.push('Specify desired output format');
    }

    // Check for logical flow
    const sentences = promptData.rawUserPrompt.split(/[.!?]+/);
    if (sentences.length > 3 && !promptData.rawUserPrompt.match(/first|then|next|finally|step/i)) {
      improvements.push('Add transitional words for better flow');
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'high',
      category: this.category,
    };
  }
}

class RoleDefinitionRule extends PromptRule {
  name = 'Role Definition';
  category = 'context';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];
    
    if (!promptData.role || promptData.role === 'professional assistant') {
      const prompt = promptData.rawUserPrompt.toLowerCase();
      
      // Suggest specific roles based on content
      if (prompt.includes('code') || prompt.includes('programming')) {
        improvements.push('Specify role: "expert software engineer" or "senior developer"');
      } else if (prompt.includes('write') || prompt.includes('content')) {
        improvements.push('Specify role: "professional copywriter" or "content strategist"');
      } else if (prompt.includes('analyze') || prompt.includes('data')) {
        improvements.push('Specify role: "experienced data analyst" or "research specialist"');
      } else if (prompt.includes('design') || prompt.includes('creative')) {
        improvements.push('Specify role: "creative director" or "UX designer"');
      } else {
        improvements.push('Add specific expertise role relevant to your task');
      }
    }

    // Check for role expertise specification
    if (promptData.role && !promptData.role.includes('expert') && !promptData.role.includes('senior')) {
      improvements.push('Consider specifying expertise level (expert, senior, experienced)');
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'medium',
      category: this.category,
    };
  }
}

class ConstraintRule extends PromptRule {
  name = 'Constraint Specification';
  category = 'requirements';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];
    const prompt = promptData.rawUserPrompt;

    if (!promptData.constraints || promptData.constraints.length === 0) {
      improvements.push('Add specific constraints or requirements');
      
      // Suggest constraint types based on content
      if (prompt.includes('write') || prompt.includes('create')) {
        improvements.push('Consider adding: tone, audience, length constraints');
      }
      
      if (prompt.includes('analyze') || prompt.includes('evaluate')) {
        improvements.push('Consider adding: analysis framework, criteria, scope');
      }
    }

    // Check for word/length limits
    if (!prompt.match(/\d+\s*(words|characters|pages|items)/i) && !promptData.wordLimit) {
      improvements.push('Specify desired length or quantity');
    }

    // Check for quality standards
    if (!prompt.includes('quality') && !prompt.includes('standard') && !prompt.includes('criteria')) {
      improvements.push('Define quality standards or success criteria');
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'medium',
      category: this.category,
    };
  }
}

class FormatSpecificationRule extends PromptRule {
  name = 'Format Specification';
  category = 'output';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];

    if (!analysis.structure.hasFormat) {
      const prompt = promptData.rawUserPrompt.toLowerCase();
      
      if (prompt.includes('list')) {
        improvements.push('Specify list format: numbered, bulleted, or structured');
      } else if (prompt.includes('report') || prompt.includes('analysis')) {
        improvements.push('Specify report structure: executive summary, sections, conclusions');
      } else if (prompt.includes('code')) {
        improvements.push('Specify code format: language, comments, explanations needed');
      } else {
        improvements.push('Specify desired output format (paragraph, list, table, JSON, etc.)');
      }
    }

    // Check for structure requirements
    if (!promptData.rawUserPrompt.includes('structure') && !promptData.rawUserPrompt.includes('format')) {
      improvements.push('Consider specifying internal structure requirements');
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'medium',
      category: this.category,
    };
  }
}

class ExampleRule extends PromptRule {
  name = 'Example Enhancement';
  category = 'clarity';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];
    const prompt = promptData.rawUserPrompt;

    if (!analysis.structure.hasExamples && prompt.length > 100) {
      improvements.push('Consider adding examples to clarify expectations');
      
      // Suggest example types
      if (prompt.includes('format') || prompt.includes('structure')) {
        improvements.push('Add format examples showing desired style');
      }
      
      if (prompt.includes('tone') || prompt.includes('style')) {
        improvements.push('Provide tone/style examples');
      }
    }

    // Check for complex tasks without examples
    if (prompt.includes('complex') || prompt.includes('detailed') || prompt.includes('comprehensive')) {
      if (!prompt.includes('example') && !prompt.includes('e.g.')) {
        improvements.push('Complex tasks benefit from concrete examples');
      }
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'low',
      category: this.category,
    };
  }
}

class SafetyRule extends PromptRule {
  name = 'Safety Enhancement';
  category = 'safety';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];

    if (analysis.safety.score < 90) {
      if (analysis.safety.hasPII) {
        improvements.push('Remove or redact personally identifiable information');
      }
      
      if (analysis.safety.hasHarmfulContent) {
        improvements.push('Review content for potentially harmful elements');
      }
      
      if (analysis.safety.hasInappropriateInstructions) {
        improvements.push('Remove system manipulation attempts');
      }
    }

    // Add safety guidelines for sensitive topics
    const prompt = promptData.rawUserPrompt.toLowerCase();
    if (prompt.includes('personal') || prompt.includes('private')) {
      improvements.push('Add privacy protection guidelines');
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'high',
      category: this.category,
    };
  }
}

class ClarityRule extends PromptRule {
  name = 'Clarity Enhancement';
  category = 'clarity';

  async evaluate(promptData: PromptData, analysis: PromptAnalysis): Promise<RuleResult> {
    const improvements: string[] = [];

    if (analysis.clarity.ambiguityScore > 10) {
      improvements.push('Reduce ambiguous language for clearer instructions');
    }

    if (analysis.clarity.specificityScore < 50) {
      improvements.push('Increase specificity with concrete details');
    }

    // Check sentence length
    const sentences = promptData.rawUserPrompt.split(/[.!?]+/);
    const longSentences = sentences.filter(s => s.split(' ').length > 25);
    
    if (longSentences.length > 0) {
      improvements.push('Break down overly long sentences for clarity');
    }

    // Check for technical jargon without explanation
    const jargonWords = ['API', 'SDK', 'ML', 'AI', 'B2B', 'SaaS', 'ROI', 'KPI'];
    const foundJargon = jargonWords.filter(word => 
      promptData.rawUserPrompt.includes(word)
    );

    if (foundJargon.length > 0) {
      improvements.push(`Consider explaining technical terms: ${foundJargon.join(', ')}`);
    }

    return {
      applicable: improvements.length > 0,
      improvements,
      priority: 'medium',
      category: this.category,
    };
  }
}