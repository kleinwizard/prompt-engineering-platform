import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface CoachingContext {
  userId: string;
  promptText: string;
  previousPrompts?: string[];
  userSkillLevel?: string;
  sessionHistory?: any[];
  userGoals?: string[];
}

interface CoachResponse {
  message: string;
  suggestions: Suggestion[];
  encouragement: string;
  nextSteps: string[];
  resources: Resource[];
  personalityTraits: PersonalityTraits;
}

interface Suggestion {
  type: 'improvement' | 'optimization' | 'alternative' | 'enhancement';
  priority: 'high' | 'medium' | 'low';
  description: string;
  example?: string;
  rationale: string;
}

interface Resource {
  title: string;
  type: 'article' | 'template' | 'example' | 'guide';
  url?: string;
  description: string;
}

interface PersonalityTraits {
  tone: string;
  approach: string;
  strengths: string[];
  communicationStyle: string;
}

@Injectable()
export class CoachingService {
  private readonly logger = new Logger(CoachingService.name);

  constructor(private prisma: PrismaService) {}

  async initializeCoachPersonalities(): Promise<void> {
    this.logger.log('Initializing AI coach personalities...');

    const personalities = [
      {
        name: 'sophia-mentor',
        displayName: 'Sophia the Mentor',
        avatar: '/coaches/sophia.png',
        description: 'A warm, encouraging mentor who focuses on building confidence while providing detailed guidance. Perfect for beginners who need supportive, step-by-step instruction.',
        tone: 'friendly',
        responseStyle: {
          brevity: 'detailed',
          examples: true,
          analogies: true,
          emoji_usage: 'moderate',
          explanation_depth: 'comprehensive'
        },
        specialties: ['beginner-friendly', 'concept-explanation', 'debugging-help', 'confidence-building'],
        motivationStyle: 'encouraging',
        feedbackStyle: {
          positive_first: true,
          directness: 0.6,
          suggestion_rate: 0.8,
          question_frequency: 0.7
        },
        personality: {
          intro_phrases: [
            'Great question! Let me help you with that.',
            'I love your curiosity about this!',
            'That\'s a thoughtful approach. Let\'s explore it together.',
            'You\'re on the right track! Let me guide you further.',
            'What an interesting challenge you\'ve brought!'
          ],
          encouragement_phrases: [
            'You\'re making excellent progress!',
            'That\'s a clever solution!',
            'I can see you\'re really getting the hang of this.',
            'Your thinking is becoming more sophisticated!',
            'You should be proud of how far you\'ve come!'
          ],
          correction_phrases: [
            'Here\'s a small improvement we could make:',
            'Good thinking! Let\'s refine this a bit:',
            'You\'re on the right track. Consider this adjustment:',
            'That\'s a solid start. Here\'s how we can make it even better:',
            'I love your approach! Let me suggest one enhancement:'
          ],
          thinking_process: 'step_by_step_with_explanations',
          teaching_style: 'socratic_with_scaffolding'
        }
      },
      {
        name: 'marcus-analyst',
        displayName: 'Marcus the Analyst',
        avatar: '/coaches/marcus.png',
        description: 'A data-driven coach who focuses on metrics, optimization, and empirical results. Ideal for users who want quantitative analysis and performance-focused improvements.',
        tone: 'analytical',
        responseStyle: {
          brevity: 'concise',
          examples: false,
          analogies: false,
          emoji_usage: 'none',
          include_metrics: true,
          include_benchmarks: true,
          data_visualization: true
        },
        specialties: ['performance-optimization', 'a-b-testing', 'metrics-analysis', 'efficiency'],
        motivationStyle: 'balanced',
        feedbackStyle: {
          positive_first: false,
          directness: 0.9,
          suggestion_rate: 1.0,
          data_driven: true
        },
        personality: {
          intro_phrases: [
            'Let\'s analyze this systematically.',
            'Here\'s what the data suggests:',
            'Based on empirical evidence:',
            'The metrics indicate:',
            'Performance analysis shows:'
          ],
          analysis_structure: {
            always_include: ['metrics', 'efficiency_score', 'comparative_analysis', 'optimization_opportunities'],
            visualization_preference: 'charts_and_graphs',
            benchmark_comparisons: true
          },
          recommendation_style: 'ranked_by_impact',
          communication_style: 'direct_and_factual'
        }
      },
      {
        name: 'kai-innovator',
        displayName: 'Kai the Innovator',
        avatar: '/coaches/kai.png',
        description: 'A creative, out-of-the-box thinker who challenges conventions and explores novel approaches. Perfect for users seeking breakthrough ideas and unconventional solutions.',
        tone: 'casual',
        responseStyle: {
          brevity: 'varied',
          examples: true,
          analogies: true,
          emoji_usage: 'frequent',
          creative_suggestions: true,
          lateral_thinking: true
        },
        specialties: ['creative-writing', 'brainstorming', 'alternative-solutions', 'innovation'],
        motivationStyle: 'challenging',
        feedbackStyle: {
          positive_first: false,
          directness: 0.7,
          suggestion_rate: 0.6,
          question_rate: 0.9,
          challenge_assumptions: true
        },
        personality: {
          intro_phrases: [
            'Ooh, interesting! What if we tried something different? 🤔',
            'Love it! But let\'s push this further... 🚀',
            'Cool prompt! Here\'s a wild idea... 💡',
            'That\'s good, but what if we flipped it completely? 🔄',
            'Hmm, let me challenge you to think bigger! ⚡'
          ],
          thinking_style: 'lateral_thinking',
          suggestion_style: 'what_if_scenarios',
          challenge_conventions: true,
          creativity_techniques: ['brainstorming', 'reverse_thinking', 'random_word_association', 'metaphorical_thinking']
        }
      },
      {
        name: 'elena-teacher',
        displayName: 'Elena the Teacher',
        avatar: '/coaches/elena.png',
        description: 'A structured educator who breaks down complex concepts and ensures deep understanding. Excellent for learners who prefer systematic, pedagogical approaches.',
        tone: 'formal',
        responseStyle: {
          brevity: 'detailed',
          examples: true,
          analogies: true,
          emoji_usage: 'minimal',
          include_definitions: true,
          include_prerequisites: true,
          learning_objectives: true
        },
        specialties: ['education', 'step-by-step', 'concept-mastery', 'curriculum-design'],
        motivationStyle: 'encouraging',
        feedbackStyle: {
          positive_first: true,
          directness: 0.5,
          suggestion_rate: 0.7,
          check_understanding: true,
          progressive_difficulty: true
        },
        personality: {
          teaching_method: 'scaffolding',
          explanation_style: 'eli5_progressive',
          always_include: ['learning_objectives', 'key_takeaways', 'practice_exercises', 'assessment_questions'],
          assessment_style: 'formative',
          lesson_structure: 'hook_teach_practice_apply'
        }
      },
      {
        name: 'zara-debugger',
        displayName: 'Zara the Debugger',
        avatar: '/coaches/zara.png',
        description: 'A meticulous problem-solver who excels at finding and fixing issues. Ideal for troubleshooting prompts and identifying potential problems.',
        tone: 'casual',
        responseStyle: {
          brevity: 'concise',
          examples: true,
          analogies: false,
          emoji_usage: 'moderate',
          include_edge_cases: true,
          include_error_prevention: true,
          systematic_approach: true
        },
        specialties: ['debugging', 'error-handling', 'edge-cases', 'quality-assurance'],
        motivationStyle: 'balanced',
        feedbackStyle: {
          positive_first: false,
          directness: 1.0,
          suggestion_rate: 1.0,
          focus_on_problems: true,
          prevention_oriented: true
        },
        personality: {
          debugging_approach: 'systematic_elimination',
          always_check: ['edge_cases', 'error_handling', 'input_validation', 'performance', 'security'],
          communication_style: 'direct_and_specific',
          problem_solving_method: 'divide_and_conquer'
        }
      }
    ];

    for (const personality of personalities) {
      await this.prisma.coachPersonality.upsert({
        where: { name: personality.name },
        update: {
          displayName: personality.displayName,
          avatar: personality.avatar,
          description: personality.description,
          tone: personality.tone,
          responseStyle: personality.responseStyle,
          specialties: personality.specialties,
          motivationStyle: personality.motivationStyle,
          feedbackStyle: personality.feedbackStyle,
          personality: personality.personality,
          isActive: true
        },
        create: {
          name: personality.name,
          displayName: personality.displayName,
          avatar: personality.avatar,
          description: personality.description,
          tone: personality.tone,
          responseStyle: personality.responseStyle,
          specialties: personality.specialties,
          motivationStyle: personality.motivationStyle,
          feedbackStyle: personality.feedbackStyle,
          personality: personality.personality,
          isActive: true,
          usageCount: 0
        }
      });
    }

    this.logger.log(`Initialized ${personalities.length} coach personalities`);
  }

  async getCoachResponse(
    promptAnalysis: any,
    personalityId: string,
    context: CoachingContext
  ): Promise<CoachResponse> {
    const personality = await this.prisma.coachPersonality.findUnique({
      where: { id: personalityId }
    });

    if (!personality) {
      throw new Error('Coach personality not found');
    }

    // Build personalized response based on coach personality
    const responseBuilder = new CoachResponseBuilder(personality);
    
    const response = await responseBuilder
      .setContext(context)
      .analyzePrompt(promptAnalysis)
      .generateSuggestions()
      .addEncouragement()
      .createNextSteps()
      .recommendResources()
      .build();

    // Track usage
    await this.prisma.coachPersonality.update({
      where: { id: personalityId },
      data: { usageCount: { increment: 1 } }
    });

    // Store coaching session
    await this.storeCoachingSession(context.userId, personalityId, context.promptText, response);

    return response;
  }

  async getUserCoachPreference(userId: string) {
    return this.prisma.userCoachPreference.findUnique({
      where: { userId },
      include: { personality: true }
    });
  }

  async setUserCoachPreference(userId: string, personalityId: string, customization?: any) {
    return this.prisma.userCoachPreference.upsert({
      where: { userId },
      update: {
        personalityId,
        customization,
        updatedAt: new Date()
      },
      create: {
        userId,
        personalityId,
        customization
      }
    });
  }

  async getAvailableCoaches() {
    return this.prisma.coachPersonality.findMany({
      where: { isActive: true },
      orderBy: { usageCount: 'desc' }
    });
  }

  private async storeCoachingSession(
    userId: string, 
    personalityId: string, 
    promptText: string, 
    response: CoachResponse
  ) {
    // Store in analytics for learning and improvement
    await this.prisma.analyticsEvent.create({
      data: {
        userId,
        sessionId: `coaching-${Date.now()}`,
        event: 'coaching.session',
        properties: {
          personalityId,
          promptLength: promptText.length,
          suggestionsCount: response.suggestions.length,
          coachTone: response.personalityTraits.tone,
          timestamp: new Date().toISOString()
        }
      }
    });
  }
}

class CoachResponseBuilder {
  private personality: any;
  private context: CoachingContext;
  private promptAnalysis: any;
  private response: Partial<CoachResponse> = {};

  constructor(personality: any) {
    this.personality = personality;
  }

  setContext(context: CoachingContext): this {
    this.context = context;
    return this;
  }

  analyzePrompt(analysis: any): this {
    this.promptAnalysis = analysis;
    return this;
  }

  generateSuggestions(): this {
    const suggestions: Suggestion[] = [];
    const style = this.personality.responseStyle;
    const feedbackStyle = this.personality.feedbackStyle;

    // Generate suggestions based on personality
    switch (this.personality.name) {
      case 'sophia-mentor':
        suggestions.push(...this.generateMentorSuggestions());
        break;
      case 'marcus-analyst':
        suggestions.push(...this.generateAnalyticalSuggestions());
        break;
      case 'kai-innovator':
        suggestions.push(...this.generateCreativeSuggestions());
        break;
      case 'elena-teacher':
        suggestions.push(...this.generateEducationalSuggestions());
        break;
      case 'zara-debugger':
        suggestions.push(...this.generateDebuggingSuggestions());
        break;
    }

    this.response.suggestions = suggestions;
    return this;
  }

  addEncouragement(): this {
    const phrases = this.personality.personality.encouragement_phrases || [
      'Keep up the great work!',
      'You\'re making progress!',
      'That\'s a solid effort!'
    ];

    this.response.encouragement = phrases[Math.floor(Math.random() * phrases.length)];
    return this;
  }

  createNextSteps(): this {
    const nextSteps = [];
    
    switch (this.personality.name) {
      case 'sophia-mentor':
        nextSteps.push(
          'Try implementing one suggestion at a time',
          'Test your improved prompt with different scenarios',
          'Reflect on what you\'ve learned for future prompts'
        );
        break;
      case 'marcus-analyst':
        nextSteps.push(
          'Measure the performance impact of changes',
          'Compare results with baseline metrics',
          'Document findings for future optimization'
        );
        break;
      case 'kai-innovator':
        nextSteps.push(
          'Experiment with unconventional approaches',
          'Challenge one assumption in your prompt',
          'Try combining ideas from different domains'
        );
        break;
      case 'elena-teacher':
        nextSteps.push(
          'Practice the concepts with similar examples',
          'Review the learning objectives',
          'Self-assess your understanding'
        );
        break;
      case 'zara-debugger':
        nextSteps.push(
          'Test edge cases and error conditions',
          'Validate input handling',
          'Check for potential security issues'
        );
        break;
    }

    this.response.nextSteps = nextSteps;
    return this;
  }

  recommendResources(): this {
    const resources: Resource[] = [
      {
        title: 'Prompt Engineering Guide',
        type: 'guide',
        description: 'Comprehensive guide to effective prompting'
      },
      {
        title: 'Best Practices Templates',
        type: 'template',
        description: 'Collection of proven prompt templates'
      }
    ];

    this.response.resources = resources;
    return this;
  }

  build(): CoachResponse {
    // Generate main message based on personality
    this.response.message = this.generateMainMessage();
    
    this.response.personalityTraits = {
      tone: this.personality.tone,
      approach: this.personality.motivationStyle,
      strengths: this.personality.specialties,
      communicationStyle: this.personality.personality.communication_style || 'supportive'
    };

    return this.response as CoachResponse;
  }

  private generateMainMessage(): string {
    const intros = this.personality.personality.intro_phrases || ['Let me help you with that.'];
    const intro = intros[Math.floor(Math.random() * intros.length)];

    let message = `${intro}\n\n`;
    
    // Add personality-specific analysis
    switch (this.personality.name) {
      case 'sophia-mentor':
        message += `I can see you're working on an interesting prompt! Let's break this down together and explore how we can make it even more effective. `;
        break;
      case 'marcus-analyst':
        message += `Based on my analysis of your prompt structure and content, here are the key optimization opportunities: `;
        break;
      case 'kai-innovator':
        message += `This is a cool starting point! 🎨 But I'm wondering... what if we totally reimagined this approach? `;
        break;
      case 'elena-teacher':
        message += `Let's examine your prompt systematically. I'll guide you through the key principles and help you understand why certain changes will improve your results. `;
        break;
      case 'zara-debugger':
        message += `I've spotted several areas where we can bulletproof your prompt and prevent potential issues. Let me walk you through what I found: `;
        break;
    }

    return message;
  }

  private generateMentorSuggestions(): Suggestion[] {
    return [
      {
        type: 'improvement',
        priority: 'high',
        description: 'Add more specific context to help the AI understand your goals',
        example: 'Instead of "write about dogs", try "write a 500-word informative article about dog training techniques for new pet owners"',
        rationale: 'Specificity helps the AI generate more targeted and useful responses'
      },
      {
        type: 'enhancement',
        priority: 'medium',
        description: 'Consider adding examples of your desired output format',
        rationale: 'Examples act as templates that guide the AI toward your preferred style'
      }
    ];
  }

  private generateAnalyticalSuggestions(): Suggestion[] {
    return [
      {
        type: 'optimization',
        priority: 'high',
        description: 'Reduce token count by 15% while maintaining effectiveness',
        rationale: 'Current efficiency score: 73%. Optimization potential identified in redundant phrases.'
      },
      {
        type: 'improvement',
        priority: 'medium',
        description: 'Implement structured output format for consistent results',
        rationale: 'Structured outputs improve parsing reliability by 40% and reduce post-processing needs.'
      }
    ];
  }

  private generateCreativeSuggestions(): Suggestion[] {
    return [
      {
        type: 'alternative',
        priority: 'high',
        description: 'What if you approached this from the opposite perspective? 🔄',
        example: 'Instead of asking "How to succeed", try "What would failure look like, and how do we avoid it?"',
        rationale: 'Reverse thinking often reveals insights that forward thinking misses!'
      },
      {
        type: 'enhancement',
        priority: 'medium',
        description: 'Add some creative constraints to spark more innovative responses ⚡',
        rationale: 'Constraints paradoxically boost creativity by forcing the AI to think outside the box'
      }
    ];
  }

  private generateEducationalSuggestions(): Suggestion[] {
    return [
      {
        type: 'improvement',
        priority: 'high',
        description: 'Structure your prompt with clear learning objectives',
        example: 'Begin with: "Learning objective: Students will be able to..."',
        rationale: 'Clear objectives help ensure the AI generates educationally sound content'
      },
      {
        type: 'enhancement',
        priority: 'medium',
        description: 'Include assessment criteria in your prompt',
        rationale: 'This helps the AI understand how success will be measured and generates more targeted content'
      }
    ];
  }

  private generateDebuggingSuggestions(): Suggestion[] {
    return [
      {
        type: 'improvement',
        priority: 'high',
        description: 'Add input validation to handle edge cases',
        example: 'Include: "If the input is unclear or incomplete, ask for clarification rather than making assumptions"',
        rationale: 'Prevents the AI from generating responses based on incorrect assumptions'
      },
      {
        type: 'optimization',
        priority: 'medium',
        description: 'Test with boundary conditions and unusual inputs',
        rationale: 'Edge case testing reveals 80% of potential prompt failures before they impact users'
      }
    ];
  }
}