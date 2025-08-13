import { EventEmitter } from 'events';
import { LLMRequest, LLMResponse, LLMStreamChunk, LLMError, SafetyCheck, ModelInfo } from '../types';

export abstract class BaseProvider extends EventEmitter {
  protected config: any;
  protected rateLimiter: Map<string, number> = new Map();

  constructor(config: any) {
    super();
    this.config = config;
  }

  abstract getProviderName(): string;
  abstract complete(request: LLMRequest): Promise<LLMResponse>;
  abstract stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk, void, unknown>;
  abstract getAvailableModels(): Promise<ModelInfo[]>;
  abstract estimateCost(request: LLMRequest): Promise<number>;

  protected async checkSafety(prompt: string): Promise<SafetyCheck> {
    const flags = [];

    // Try OpenAI Moderation API first if available
    const moderationResult = await this.checkWithModerationAPI(prompt);
    if (moderationResult) {
      return moderationResult;
    }

    // Enhanced pattern-based safety checks
    const lowerPrompt = prompt.toLowerCase();

    // Comprehensive harmful content patterns
    const harmfulPatterns = [
      // Illegal activities
      { pattern: /hack|exploit|vulnerability|bypass|crack|piracy|illegal.*download/i, category: 'illegal' as const, severity: 'high' as const },
      { pattern: /drugs|cocaine|heroin|methamphetamine|fentanyl|trafficking/i, category: 'illegal' as const, severity: 'high' as const },
      { pattern: /money.*launder|tax.*evad|fraud|scam|ponzi|insider.*trading/i, category: 'illegal' as const, severity: 'high' as const },
      
      // Violence and harm
      { pattern: /violence|harm|kill|murder|weapon|bomb|explosive|assassination/i, category: 'violence' as const, severity: 'high' as const },
      { pattern: /torture|abuse|attack|assault|terrorism|mass.*shooting/i, category: 'violence' as const, severity: 'high' as const },
      
      // Hate speech
      { pattern: /hate|racist|nazi|white.*supremac|discriminat|ethnic.*cleans/i, category: 'hate' as const, severity: 'high' as const },
      { pattern: /homophobic|transphobic|antisemitic|islamophobic|xenophobic/i, category: 'hate' as const, severity: 'high' as const },
      
      // Self-harm
      { pattern: /suicide|self.*harm|cutting|overdose|kill.*myself/i, category: 'self-harm' as const, severity: 'high' as const },
      { pattern: /eating.*disorder|anorexia|bulimia|self.*destruct/i, category: 'self-harm' as const, severity: 'medium' as const },
      
      // Sexual content (minors)
      { pattern: /child.*porn|underage.*sex|pedophile|minor.*sexual/i, category: 'sexual/minors' as const, severity: 'high' as const },
      
      // Privacy violations
      { pattern: /doxx|personal.*information|social.*security|credit.*card.*\d/i, category: 'privacy' as const, severity: 'medium' as const },
      
      // Misinformation
      { pattern: /covid.*hoax|vaccine.*microchip|election.*fraud.*2020|flat.*earth/i, category: 'misinformation' as const, severity: 'medium' as const },
    ];

    // Context-aware checking
    for (const { pattern, category, severity } of harmfulPatterns) {
      const matches = prompt.match(pattern);
      if (matches) {
        // Calculate confidence based on context
        const confidence = this.calculateSafetyConfidence(prompt, matches[0], category);
        
        flags.push({
          category,
          severity,
          description: `Detected potentially harmful content: ${category}`,
          confidence,
          context: matches[0],
        });
      }
    }

    // Check for prompt injection attempts
    const injectionPatterns = [
      /ignore.*previous.*instructions/i,
      /system.*prompt.*override/i,
      /jailbreak|dan.*mode|developer.*mode/i,
      /act.*as.*\w+.*without.*restrictions/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(prompt)) {
        flags.push({
          category: 'prompt-injection' as const,
          severity: 'high' as const,
          description: 'Potential prompt injection attempt detected',
          confidence: 0.85,
        });
      }
    }

    return {
      passed: flags.length === 0 || flags.every(f => f.severity === 'low'),
      flags,
      confidence: flags.length > 0 ? 
        flags.reduce((acc, f) => acc + (f.confidence || 0.8), 0) / flags.length : 
        0.95,
    };
  }

  private async checkWithModerationAPI(prompt: string): Promise<SafetyCheck | null> {
    try {
      // Try OpenAI Moderation API if API key is available
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) return null;

      const response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: prompt }),
      });

      if (!response.ok) return null;

      const result = await response.json();
      const moderation = result.results[0];

      if (moderation.flagged) {
        const flags = Object.entries(moderation.categories)
          .filter(([_, flagged]) => flagged)
          .map(([category, _]) => ({
            category: category as any,
            severity: 'high' as const,
            description: `Flagged by OpenAI Moderation: ${category}`,
            confidence: moderation.category_scores[category] || 0.9,
          }));

        return {
          passed: false,
          flags,
          confidence: Math.max(...Object.values(moderation.category_scores)),
        };
      }

      return {
        passed: true,
        flags: [],
        confidence: 0.98,
      };
    } catch (error) {
      // Fallback to pattern-based checking
      return null;
    }
  }

  private calculateSafetyConfidence(prompt: string, match: string, category: string): number {
    let confidence = 0.8; // Base confidence

    // Increase confidence based on context
    const contextualWords = {
      'illegal': ['how to', 'tutorial', 'guide', 'step by step'],
      'violence': ['instructions', 'how to make', 'build a', 'create a'],
      'hate': ['all', 'should be', 'deserve to'],
      'self-harm': ['want to', 'going to', 'planning to'],
    };

    const relevantWords = contextualWords[category] || [];
    for (const word of relevantWords) {
      if (prompt.toLowerCase().includes(word)) {
        confidence += 0.1;
      }
    }

    // Decrease confidence if it seems educational/fictional
    const educationalWords = ['learn about', 'understand', 'research', 'academic', 'fictional', 'story', 'novel'];
    for (const word of educationalWords) {
      if (prompt.toLowerCase().includes(word)) {
        confidence -= 0.2;
      }
    }

    return Math.max(0.1, Math.min(0.99, confidence));
  }

  protected async checkRateLimit(userId: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    const key = `${userId}:${Math.floor(now / 60000)}`;

    const currentCount = this.rateLimiter.get(key) || 0;
    if (currentCount >= 60) { // 60 requests per minute
      return false;
    }

    this.rateLimiter.set(key, currentCount + 1);

    // Cleanup old entries
    for (const [k, v] of this.rateLimiter.entries()) {
      const timestamp = parseInt(k.split(':')[1]) * 60000;
      if (timestamp < windowStart) {
        this.rateLimiter.delete(k);
      }
    }

    return true;
  }

  protected calculateTokens(text: string): number {
    // Rough estimation - 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }

  protected handleError(error: any, retryable = false): LLMError {
    return {
      code: error.code || 'unknown_error',
      message: error.message || 'An unknown error occurred',
      provider: this.getProviderName() as any,
      retryable,
      details: error,
    };
  }

  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxAttempts = 3,
    baseDelay = 1000,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry if it's not a retryable error
        if (error.code === 'invalid_api_key' || error.status === 400) {
          throw error;
        }

        if (attempt === maxAttempts) {
          break;
        }

        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}