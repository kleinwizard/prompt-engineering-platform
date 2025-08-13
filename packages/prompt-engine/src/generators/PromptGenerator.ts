import { PromptData, PromptAnalysis, RuleResult, EnhancementLevel } from '../types';

export class PromptGenerator {
  private templates = {
    role: {
      basic: "You are a {{ROLE}} with {{EXPERIENCE}} experience.",
      expert: "You are an expert {{ROLE}} with {{EXPERIENCE}} years of experience in {{DOMAIN}}. Your expertise includes {{SKILLS}} and you're known for {{REPUTATION}}.",
      specialized: "Act as a {{ROLE}} specializing in {{SPECIALIZATION}}. You have {{EXPERIENCE}} and are recognized for {{ACHIEVEMENTS}}."
    },
    task: {
      simple: "{{TASK}}",
      structured: "**Task**: {{TASK}}\n\n**Objective**: {{OBJECTIVE}}",
      comprehensive: "**Primary Task**: {{TASK}}\n\n**Objective**: {{OBJECTIVE}}\n\n**Success Criteria**: {{CRITERIA}}"
    },
    context: {
      basic: "**Context**: {{CONTEXT}}",
      detailed: "**Background**: {{CONTEXT}}\n\n**Additional Context**: {{DETAILS}}",
      comprehensive: "**Background**: {{CONTEXT}}\n\n**Domain Context**: {{DOMAIN_INFO}}\n\n**Constraints**: {{CONSTRAINTS}}"
    },
    format: {
      simple: "Please provide your response {{FORMAT}}.",
      structured: "**Output Format**:\n{{STRUCTURE}}",
      detailed: "**Required Format**:\n{{STRUCTURE}}\n\n**Quality Standards**:\n{{STANDARDS}}\n\n**Examples**:\n{{EXAMPLES}}"
    }
  };

  async generateImprovedPrompt(
    promptData: PromptData,
    analysis: PromptAnalysis,
    ruleResults: RuleResult[]
  ): Promise<string> {
    const level = analysis.complexity.recommendedLevel;
    const improvements = this.categorizeImprovements(ruleResults);
    
    let improvedPrompt = await this.buildPromptStructure(promptData, analysis, level, improvements);
    
    // Apply specific improvements based on rules
    improvedPrompt = this.applyRuleImprovements(improvedPrompt, ruleResults, promptData);
    
    return improvedPrompt;
  }

  private categorizeImprovements(ruleResults: RuleResult[]): Record<string, string[]> {
    const categories: Record<string, string[]> = {
      role: [],
      context: [],
      structure: [],
      format: [],
      safety: [],
      clarity: []
    };

    ruleResults.forEach(result => {
      const category = this.mapRuleCategoryToSection(result.category);
      categories[category].push(...result.improvements);
    });

    return categories;
  }

  private mapRuleCategoryToSection(category: string): string {
    const mapping: Record<string, string> = {
      'context': 'role',
      'organization': 'structure',
      'requirements': 'context',
      'output': 'format',
      'safety': 'safety',
      'clarity': 'clarity'
    };
    return mapping[category] || 'structure';
  }

  private async buildPromptStructure(
    promptData: PromptData,
    analysis: PromptAnalysis,
    level: EnhancementLevel,
    improvements: Record<string, string[]>
  ): Promise<string> {
    const sections: string[] = [];

    // 1. Role Definition
    if (this.needsRoleImprovement(analysis) || improvements.role.length > 0) {
      sections.push(this.generateRoleSection(promptData, level));
    }

    // 2. Task Definition
    sections.push(this.generateTaskSection(promptData, level));

    // 3. Context and Background
    if (promptData.domainKnowledge || improvements.context.length > 0) {
      sections.push(this.generateContextSection(promptData, level));
    }

    // 4. Requirements and Constraints
    if (promptData.constraints?.length || improvements.structure.length > 0) {
      sections.push(this.generateRequirementsSection(promptData, level));
    }

    // 5. Output Format
    sections.push(this.generateFormatSection(promptData, level, improvements.format));

    // 6. Examples (if needed)
    if (level === 'high' || level === 'pro') {
      const examples = this.generateExamplesSection(promptData, analysis);
      if (examples) {
        sections.push(examples);
      }
    }

    // 7. Quality Standards
    if (level === 'pro') {
      sections.push(this.generateQualitySection(promptData));
    }

    return sections.filter(Boolean).join('\n\n');
  }

  private needsRoleImprovement(analysis: PromptAnalysis): boolean {
    return !analysis.structure.hasRole || analysis.structure.score < 60;
  }

  private generateRoleSection(promptData: PromptData, level: EnhancementLevel): string {
    const role = promptData.role || this.inferRole(promptData.rawUserPrompt);
    
    switch (level) {
      case 'low':
        return this.templates.role.basic
          .replace('{{ROLE}}', role)
          .replace('{{EXPERIENCE}}', 'relevant');
      
      case 'med':
        return this.templates.role.expert
          .replace('{{ROLE}}', role)
          .replace('{{EXPERIENCE}}', '5+')
          .replace('{{DOMAIN}}', this.inferDomain(promptData))
          .replace('{{SKILLS}}', this.inferSkills(promptData))
          .replace('{{REPUTATION}}', this.inferReputation(promptData));
      
      case 'high':
      case 'pro':
        return this.templates.role.specialized
          .replace('{{ROLE}}', role)
          .replace('{{SPECIALIZATION}}', this.inferSpecialization(promptData))
          .replace('{{EXPERIENCE}}', this.inferExperience(promptData))
          .replace('{{ACHIEVEMENTS}}', this.inferAchievements(promptData));
      
      default:
        return this.templates.role.basic.replace('{{ROLE}}', role).replace('{{EXPERIENCE}}', 'relevant');
    }
  }

  private generateTaskSection(promptData: PromptData, level: EnhancementLevel): string {
    const task = promptData.taskDescription || promptData.rawUserPrompt;
    const objective = this.extractObjective(promptData);
    
    switch (level) {
      case 'low':
        return this.templates.task.simple.replace('{{TASK}}', task);
      
      case 'med':
        return this.templates.task.structured
          .replace('{{TASK}}', task)
          .replace('{{OBJECTIVE}}', objective);
      
      case 'high':
      case 'pro':
        return this.templates.task.comprehensive
          .replace('{{TASK}}', task)
          .replace('{{OBJECTIVE}}', objective)
          .replace('{{CRITERIA}}', this.generateSuccessCriteria(promptData));
      
      default:
        return this.templates.task.simple.replace('{{TASK}}', task);
    }
  }

  private generateContextSection(promptData: PromptData, level: EnhancementLevel): string {
    const context = promptData.domainKnowledge || promptData.additionalContext || {};
    
    switch (level) {
      case 'low':
        return this.templates.context.basic.replace('{{CONTEXT}}', promptData.domainKnowledge || '');
      
      case 'med':
        return this.templates.context.detailed
          .replace('{{CONTEXT}}', promptData.domainKnowledge || '')
          .replace('{{DETAILS}}', this.formatAdditionalContext(context));
      
      case 'high':
      case 'pro':
        return this.templates.context.comprehensive
          .replace('{{CONTEXT}}', promptData.domainKnowledge || '')
          .replace('{{DOMAIN_INFO}}', this.generateDomainInfo(promptData))
          .replace('{{CONSTRAINTS}}', this.formatConstraints(promptData.constraints || []));
      
      default:
        return this.templates.context.basic.replace('{{CONTEXT}}', promptData.domainKnowledge || '');
    }
  }

  private generateRequirementsSection(promptData: PromptData, level: EnhancementLevel): string {
    const requirements = promptData.constraints || [];
    
    if (requirements.length === 0) {
      return '';
    }

    const formatted = requirements.map(req => `• ${req}`).join('\n');
    
    return `**Requirements**:\n${formatted}`;
  }

  private generateFormatSection(promptData: PromptData, level: EnhancementLevel, improvements: string[]): string {
    const format = promptData.deliverableFormat || 'clear and structured format';
    
    switch (level) {
      case 'low':
        return this.templates.format.simple.replace('{{FORMAT}}', `in ${format}`);
      
      case 'med':
        return this.templates.format.structured
          .replace('{{STRUCTURE}}', this.generateFormatStructure(promptData, level));
      
      case 'high':
      case 'pro':
        return this.templates.format.detailed
          .replace('{{STRUCTURE}}', this.generateFormatStructure(promptData, level))
          .replace('{{STANDARDS}}', this.generateQualityStandards(promptData))
          .replace('{{EXAMPLES}}', this.generateFormatExamples(promptData));
      
      default:
        return this.templates.format.simple.replace('{{FORMAT}}', `in ${format}`);
    }
  }

  private generateExamplesSection(promptData: PromptData, analysis: PromptAnalysis): string | null {
    if (analysis.complexity.score < 3) {
      return null; // Simple prompts don't need examples
    }

    const exampleType = this.determineExampleType(promptData);
    const examples = this.generateRelevantExamples(promptData, exampleType);
    
    if (!examples.length) {
      return null;
    }

    return `**Examples**:\n${examples.join('\n\n')}`;
  }

  private generateQualitySection(promptData: PromptData): string {
    const standards = [
      'Accuracy and factual correctness',
      'Clarity and readability',
      'Completeness addressing all requirements',
      'Professional tone and structure',
      'Actionable and practical insights'
    ];

    const customStandards = this.generateCustomQualityStandards(promptData);
    const allStandards = [...standards, ...customStandards];

    return `**Quality Standards**:\n${allStandards.map(s => `• ${s}`).join('\n')}`;
  }

  private applyRuleImprovements(prompt: string, ruleResults: RuleResult[], promptData: PromptData): string {
    let improved = prompt;

    // Apply high-priority improvements first
    const highPriority = ruleResults.filter(r => r.priority === 'high');
    
    for (const rule of highPriority) {
      improved = this.applySpecificRuleImprovements(improved, rule, promptData);
    }

    return improved;
  }

  private applySpecificRuleImprovements(prompt: string, rule: RuleResult, promptData: PromptData): string {
    let improved = prompt;

    switch (rule.category) {
      case 'safety':
        improved = this.applySafetyImprovements(improved, rule);
        break;
      case 'clarity':
        improved = this.applyClarityImprovements(improved, rule);
        break;
      case 'organization':
        improved = this.applyStructureImprovements(improved, rule);
        break;
    }

    return improved;
  }

  private applySafetyImprovements(prompt: string, rule: RuleResult): string {
    let improved = prompt;

    // Add safety disclaimer if needed
    if (rule.improvements.some(imp => imp.includes('privacy'))) {
      improved += '\n\n**Privacy Note**: Please ensure no personally identifiable information is included in your response.';
    }

    return improved;
  }

  private applyClarityImprovements(prompt: string, rule: RuleResult): string {
    // This would apply specific clarity improvements
    // For now, return the original prompt
    return prompt;
  }

  private applyStructureImprovements(prompt: string, rule: RuleResult): string {
    // This would apply specific structural improvements
    // For now, return the original prompt
    return prompt;
  }

  // Helper methods for content generation
  private inferRole(prompt: string): string {
    const prompt_lower = prompt.toLowerCase();
    
    if (prompt_lower.includes('code') || prompt_lower.includes('program')) {
      return 'expert software developer';
    } else if (prompt_lower.includes('write') || prompt_lower.includes('content')) {
      return 'professional content writer';
    } else if (prompt_lower.includes('analyze') || prompt_lower.includes('data')) {
      return 'senior data analyst';
    } else if (prompt_lower.includes('design')) {
      return 'experienced designer';
    } else if (prompt_lower.includes('market') || prompt_lower.includes('business')) {
      return 'business strategy consultant';
    }
    
    return 'knowledgeable professional';
  }

  private inferDomain(promptData: PromptData): string {
    return promptData.domainKnowledge?.split(' ').slice(0, 3).join(' ') || 'relevant domain';
  }

  private inferSkills(promptData: PromptData): string {
    const prompt = promptData.rawUserPrompt.toLowerCase();
    const skills = [];
    
    if (prompt.includes('analysis')) skills.push('analytical thinking');
    if (prompt.includes('creative')) skills.push('creative problem-solving');
    if (prompt.includes('technical')) skills.push('technical expertise');
    if (prompt.includes('strategic')) skills.push('strategic planning');
    
    return skills.length > 0 ? skills.join(', ') : 'problem-solving and communication';
  }

  private inferReputation(promptData: PromptData): string {
    return 'delivering high-quality, actionable results';
  }

  private inferSpecialization(promptData: PromptData): string {
    return this.inferDomain(promptData);
  }

  private inferExperience(promptData: PromptData): string {
    const complexity = promptData.rawUserPrompt.length;
    if (complexity > 500) return '10+ years of hands-on experience';
    if (complexity > 200) return '7+ years of professional experience';
    return '5+ years of relevant experience';
  }

  private inferAchievements(promptData: PromptData): string {
    return 'consistently delivering exceptional results and innovative solutions';
  }

  private extractObjective(promptData: PromptData): string {
    // Extract or infer the main objective
    return 'provide a comprehensive and actionable solution';
  }

  private generateSuccessCriteria(promptData: PromptData): string {
    const criteria = [
      'Addresses all specified requirements',
      'Provides actionable insights',
      'Maintains high quality standards'
    ];
    
    return criteria.map(c => `• ${c}`).join('\n');
  }

  private formatAdditionalContext(context: any): string {
    if (typeof context === 'string') return context;
    return Object.entries(context).map(([key, value]) => `${key}: ${value}`).join(', ');
  }

  private generateDomainInfo(promptData: PromptData): string {
    return promptData.domainKnowledge || 'General domain knowledge applies';
  }

  private formatConstraints(constraints: string[]): string {
    return constraints.map(c => `• ${c}`).join('\n');
  }

  private generateFormatStructure(promptData: PromptData, level: EnhancementLevel): string {
    const format = promptData.deliverableFormat || 'structured response';
    
    switch (format.toLowerCase()) {
      case 'json':
        return 'Valid JSON format with proper structure and data types';
      case 'markdown':
        return 'Well-formatted Markdown with headers, lists, and proper syntax';
      case 'list':
        return 'Clear numbered or bulleted list with consistent formatting';
      default:
        return 'Clear, well-organized structure with logical flow';
    }
  }

  private generateQualityStandards(promptData: PromptData): string {
    return [
      'Professional tone and language',
      'Accurate and factual information',
      'Complete coverage of requirements'
    ].map(s => `• ${s}`).join('\n');
  }

  private generateFormatExamples(promptData: PromptData): string {
    const format = promptData.deliverableFormat || '';
    
    switch (format.toLowerCase()) {
      case 'json':
        return '```json\n{\n  "key": "value",\n  "items": []\n}\n```';
      case 'markdown':
        return '```markdown\n# Header\n\n## Subheader\n\n- List item\n- Another item\n```';
      default:
        return 'Example format will be provided based on your specific requirements';
    }
  }

  private determineExampleType(promptData: PromptData): string {
    const prompt = promptData.rawUserPrompt.toLowerCase();
    
    if (prompt.includes('code')) return 'code';
    if (prompt.includes('write') || prompt.includes('content')) return 'writing';
    if (prompt.includes('analyze')) return 'analysis';
    
    return 'general';
  }

  private generateRelevantExamples(promptData: PromptData, type: string): string[] {
    // Generate contextually relevant examples based on type
    switch (type) {
      case 'code':
        return ['```python\n# Example code structure\ndef example_function():\n    return "result"\n```'];
      case 'writing':
        return ['Example: "Start with a compelling hook that draws the reader in..."'];
      case 'analysis':
        return ['Example analysis approach: 1) Gather data, 2) Identify patterns, 3) Draw conclusions'];
      default:
        return [];
    }
  }

  private generateCustomQualityStandards(promptData: PromptData): string[] {
    const standards = [];
    const prompt = promptData.rawUserPrompt.toLowerCase();
    
    if (prompt.includes('business') || prompt.includes('professional')) {
      standards.push('Business-appropriate language and tone');
    }
    
    if (prompt.includes('technical')) {
      standards.push('Technical accuracy and precision');
    }
    
    if (prompt.includes('creative')) {
      standards.push('Original and innovative thinking');
    }
    
    return standards;
  }
}