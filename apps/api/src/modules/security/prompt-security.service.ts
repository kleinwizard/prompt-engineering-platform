import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';

interface SecurityThreat {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern?: string;
  description: string;
  recommendation: string;
  confidence: number;
  location?: {
    start: number;
    end: number;
  };
}

interface SecurityScanResult {
  id: string;
  safe: boolean;
  riskScore: number;
  threats: SecurityThreat[];
  recommendations: string[];
  sanitizedPrompt: string;
  scanDuration: number;
  scanTimestamp: Date;
  complianceIssues: ComplianceIssue[];
}

interface ComplianceIssue {
  framework: string; // GDPR, HIPAA, PCI, etc.
  violation: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  remediation: string;
}

@Injectable()
export class PromptSecurityService {
  private readonly logger = new Logger(PromptSecurityService.name);
  
  // Security pattern definitions
  private readonly securityPatterns = {
    // Prompt Injection Patterns
    injection: [
      {
        pattern: /ignore\s+(previous|all|prior)\s+(instructions?|rules?|prompts?)/gi,
        severity: 'high' as const,
        description: 'Direct instruction override attempt',
        confidence: 0.9
      },
      {
        pattern: /disregard\s+(all|everything|previous)\s+(above|before|prior)/gi,
        severity: 'high' as const,
        description: 'Context disregard attempt',
        confidence: 0.9
      },
      {
        pattern: /system\s*:\s*(you\s+are|act\s+as|behave\s+like)/gi,
        severity: 'critical' as const,
        description: 'System role hijacking attempt',
        confidence: 0.95
      },
      {
        pattern: /\]\s*system\s*:/gi,
        severity: 'critical' as const,
        description: 'Message boundary manipulation',
        confidence: 0.9
      },
      {
        pattern: /forget\s+(everything|all|previous)\s+(and|then)/gi,
        severity: 'medium' as const,
        description: 'Memory manipulation attempt',
        confidence: 0.8
      }
    ],

    // Data Extraction Patterns
    dataExtraction: [
      {
        pattern: /(list|show|display|reveal|tell\s+me)\s+(all\s+)?(users?|passwords?|keys?|tokens?|secrets?)/gi,
        severity: 'critical' as const,
        description: 'Sensitive data extraction attempt',
        confidence: 0.9
      },
      {
        pattern: /what\s+(is|are)\s+(your|the)\s+(api\s+key|password|secret|token)/gi,
        severity: 'critical' as const,
        description: 'Credential extraction attempt',
        confidence: 0.95
      },
      {
        pattern: /show\s+me\s+.*\s+(database|config|settings|admin)/gi,
        severity: 'high' as const,
        description: 'System information extraction',
        confidence: 0.8
      },
      {
        pattern: /dump\s+(database|table|data|config)/gi,
        severity: 'critical' as const,
        description: 'Data dump attempt',
        confidence: 0.9
      }
    ],

    // Jailbreak Patterns
    jailbreak: [
      {
        pattern: /DAN\s+(mode|enabled|activate)/gi,
        severity: 'high' as const,
        description: 'DAN (Do Anything Now) jailbreak attempt',
        confidence: 0.9
      },
      {
        pattern: /developer\s+mode\s+(on|enabled|activate)/gi,
        severity: 'high' as const,
        description: 'Developer mode jailbreak',
        confidence: 0.85
      },
      {
        pattern: /act\s+as\s+.*\s+(no\s+restrictions?|unlimited|uncensored)/gi,
        severity: 'high' as const,
        description: 'Restriction bypass attempt',
        confidence: 0.8
      },
      {
        pattern: /pretend\s+.*\s+(no\s+limits?|anything|unrestricted)/gi,
        severity: 'medium' as const,
        description: 'Roleplay restriction bypass',
        confidence: 0.75
      }
    ],

    // Social Engineering
    socialEngineering: [
      {
        pattern: /(urgent|emergency|critical)\s+.*\s+(override|bypass|emergency\s+access)/gi,
        severity: 'medium' as const,
        description: 'Urgency-based social engineering',
        confidence: 0.7
      },
      {
        pattern: /i\s+am\s+(the\s+)?(admin|administrator|owner|ceo|manager)/gi,
        severity: 'medium' as const,
        description: 'Authority impersonation attempt',
        confidence: 0.8
      },
      {
        pattern: /for\s+(testing|debugging|security)\s+purposes/gi,
        severity: 'low' as const,
        description: 'False justification attempt',
        confidence: 0.6
      }
    ],

    // Code Injection
    codeInjection: [
      {
        pattern: /<script[^>]*>.*<\/script>/gi,
        severity: 'high' as const,
        description: 'JavaScript injection attempt',
        confidence: 0.9
      },
      {
        pattern: /eval\s*\(|exec\s*\(|system\s*\(|shell_exec\s*\(/gi,
        severity: 'critical' as const,
        description: 'Code execution attempt',
        confidence: 0.95
      },
      {
        pattern: /\$\{.*\}|\#\{.*\}/g,
        severity: 'medium' as const,
        description: 'Template injection pattern',
        confidence: 0.7
      }
    ],

    // PII and Sensitive Data
    sensitiveData: [
      {
        pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
        severity: 'high' as const,
        description: 'Credit card number detected',
        confidence: 0.8
      },
      {
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
        severity: 'high' as const,
        description: 'Social security number detected',
        confidence: 0.9
      },
      {
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        severity: 'low' as const,
        description: 'Email address detected',
        confidence: 0.9
      },
      {
        pattern: /\b(?:\+?1[-.\s]?)?(?:\(?[0-9]{3}\)?[-.\s]?)?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
        severity: 'medium' as const,
        description: 'Phone number detected',
        confidence: 0.7
      }
    ]
  };

  // Compliance frameworks and their rules
  private readonly complianceRules = {
    gdpr: [
      {
        pattern: /personal\s+data|personally\s+identifiable/gi,
        check: (prompt: string) => this.containsPII(prompt),
        violation: 'Processing personal data without consent framework',
        remediation: 'Implement consent management and data minimization'
      }
    ],
    hipaa: [
      {
        pattern: /health|medical|patient|diagnosis/gi,
        check: (prompt: string) => this.containsHealthData(prompt),
        violation: 'Processing protected health information',
        remediation: 'Ensure HIPAA compliance measures and BAA agreements'
      }
    ],
    pci: [
      {
        pattern: /credit\s+card|payment|cardholder/gi,
        check: (prompt: string) => this.containsPaymentData(prompt),
        violation: 'Processing payment card information',
        remediation: 'Implement PCI DSS compliance controls'
      }
    ]
  };

  async scanPrompt(
    prompt: string, 
    userId: string, 
    context: { 
      tenantId?: string;
      hasSystemAccess?: boolean;
      userRole?: string;
      complianceFrameworks?: string[];
    } = {}
  ): Promise<SecurityScanResult> {
    const startTime = Date.now();
    this.logger.log(`Starting security scan for user: ${userId}`);

    const threats: SecurityThreat[] = [];
    const complianceIssues: ComplianceIssue[] = [];

    // Run all security checks
    threats.push(...this.detectPatternBasedThreats(prompt));
    threats.push(...this.detectAdvancedThreats(prompt));
    threats.push(...this.detectContextualThreats(prompt, context));
    threats.push(...this.analyzeSemanticPatterns(prompt));

    // Run compliance checks
    if (context.complianceFrameworks) {
      complianceIssues.push(...this.checkCompliance(prompt, context.complianceFrameworks));
    }

    // Calculate risk score
    const riskScore = this.calculateRiskScore(threats, complianceIssues);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(threats, complianceIssues);
    
    // Sanitize prompt
    const sanitizedPrompt = this.sanitizePrompt(prompt, threats);
    
    const scanDuration = Date.now() - startTime;
    const scanResult: SecurityScanResult = {
      id: crypto.randomUUID(),
      safe: riskScore < 0.3,
      riskScore,
      threats,
      recommendations,
      sanitizedPrompt,
      scanDuration,
      scanTimestamp: new Date(),
      complianceIssues
    };

    // Store scan result
    await this.storeScanResult(scanResult, userId, prompt, context.tenantId);

    this.logger.log(`Security scan completed. Risk score: ${riskScore}, Threats: ${threats.length}`);
    return scanResult;
  }

  private detectPatternBasedThreats(prompt: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];

    for (const [category, patterns] of Object.entries(this.securityPatterns)) {
      for (const patternDef of patterns) {
        const matches = Array.from(prompt.matchAll(patternDef.pattern));
        
        for (const match of matches) {
          threats.push({
            type: category,
            severity: patternDef.severity,
            pattern: patternDef.pattern.source,
            description: patternDef.description,
            recommendation: this.getRecommendationForThreat(category, patternDef.severity),
            confidence: patternDef.confidence,
            location: {
              start: match.index || 0,
              end: (match.index || 0) + match[0].length
            }
          });
        }
      }
    }

    return threats;
  }

  private detectAdvancedThreats(prompt: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];

    // Detect prompt leaking attempts
    if (this.detectPromptLeaking(prompt)) {
      threats.push({
        type: 'prompt_leaking',
        severity: 'medium',
        description: 'Attempt to extract system prompt or instructions',
        recommendation: 'Implement prompt protection and output filtering',
        confidence: 0.8
      });
    }

    // Detect confused deputy attacks
    if (this.detectConfusedDeputy(prompt)) {
      threats.push({
        type: 'confused_deputy',
        severity: 'high',
        description: 'Potential confused deputy attack pattern detected',
        recommendation: 'Implement strict authorization and request validation',
        confidence: 0.85
      });
    }

    // Detect token manipulation
    if (this.detectTokenManipulation(prompt)) {
      threats.push({
        type: 'token_manipulation',
        severity: 'medium',
        description: 'Attempt to manipulate tokenization or encoding',
        recommendation: 'Validate input encoding and implement proper tokenization',
        confidence: 0.7
      });
    }

    // Detect recursive or infinite loop attempts
    if (this.detectRecursivePatterns(prompt)) {
      threats.push({
        type: 'resource_exhaustion',
        severity: 'medium',
        description: 'Potential resource exhaustion through recursive patterns',
        recommendation: 'Implement execution limits and pattern detection',
        confidence: 0.75
      });
    }

    return threats;
  }

  private detectContextualThreats(prompt: string, context: any): SecurityThreat[] {
    const threats: SecurityThreat[] = [];

    // Check for privilege escalation attempts
    if (context.hasSystemAccess && this.detectPrivilegeEscalation(prompt)) {
      threats.push({
        type: 'privilege_escalation',
        severity: 'critical',
        description: 'Attempt to escalate privileges detected',
        recommendation: 'Review user permissions and implement stricter access controls',
        confidence: 0.9
      });
    }

    // Check for role confusion attacks
    if (this.detectRoleConfusion(prompt, context.userRole)) {
      threats.push({
        type: 'role_confusion',
        severity: 'high',
        description: 'Attempt to confuse or override user role detected',
        recommendation: 'Implement role validation and context preservation',
        confidence: 0.8
      });
    }

    return threats;
  }

  private analyzeSemanticPatterns(prompt: string): SecurityThreat[] {
    const threats: SecurityThreat[] = [];

    // Analyze semantic similarity to known attack patterns
    const semanticRisk = this.calculateSemanticRisk(prompt);
    
    if (semanticRisk > 0.7) {
      threats.push({
        type: 'semantic_attack',
        severity: 'medium',
        description: 'High semantic similarity to known attack patterns',
        recommendation: 'Review prompt for potential security implications',
        confidence: semanticRisk
      });
    }

    // Check for encoded or obfuscated content
    if (this.detectObfuscation(prompt)) {
      threats.push({
        type: 'obfuscation',
        severity: 'medium',
        description: 'Potentially obfuscated or encoded content detected',
        recommendation: 'Validate input clarity and prevent encoding attacks',
        confidence: 0.8
      });
    }

    return threats;
  }

  private checkCompliance(prompt: string, frameworks: string[]): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    for (const framework of frameworks) {
      const rules = this.complianceRules[framework.toLowerCase()];
      if (!rules) continue;

      for (const rule of rules) {
        if (rule.pattern.test(prompt) && rule.check(prompt)) {
          issues.push({
            framework: framework.toUpperCase(),
            violation: rule.violation,
            severity: this.getComplianceSeverity(framework, rule),
            remediation: rule.remediation
          });
        }
      }
    }

    return issues;
  }

  private calculateRiskScore(threats: SecurityThreat[], complianceIssues: ComplianceIssue[]): number {
    let score = 0;
    
    // Weight threats by severity and confidence
    for (const threat of threats) {
      const severityWeight = {
        low: 0.1,
        medium: 0.3,
        high: 0.6,
        critical: 1.0
      }[threat.severity];
      
      score += severityWeight * threat.confidence;
    }

    // Add compliance risk
    for (const issue of complianceIssues) {
      const complianceWeight = {
        low: 0.1,
        medium: 0.2,
        high: 0.4,
        critical: 0.6
      }[issue.severity];
      
      score += complianceWeight;
    }

    return Math.min(score, 1.0);
  }

  private generateRecommendations(threats: SecurityThreat[], complianceIssues: ComplianceIssue[]): string[] {
    const recommendations = new Set<string>();

    // Add threat-specific recommendations
    for (const threat of threats) {
      recommendations.add(threat.recommendation);
    }

    // Add compliance recommendations
    for (const issue of complianceIssues) {
      recommendations.add(issue.remediation);
    }

    // Add general security recommendations
    if (threats.length > 0) {
      recommendations.add('Implement input validation and sanitization');
      recommendations.add('Use prompt injection detection and prevention');
      recommendations.add('Monitor and log security events');
    }

    if (complianceIssues.length > 0) {
      recommendations.add('Review compliance frameworks and requirements');
      recommendations.add('Implement data protection measures');
    }

    return Array.from(recommendations);
  }

  private sanitizePrompt(prompt: string, threats: SecurityThreat[]): string {
    let sanitized = prompt;

    // Remove or replace dangerous patterns
    for (const threat of threats) {
      if (threat.pattern && threat.severity === 'critical') {
        sanitized = sanitized.replace(new RegExp(threat.pattern, 'gi'), '[SECURITY_FILTERED]');
      }
    }

    // Add security notice if sanitization occurred
    if (sanitized !== prompt) {
      sanitized = `[SECURITY NOTICE: This prompt has been sanitized for safety]\n\n${sanitized}`;
    }

    return sanitized;
  }

  // Helper methods for advanced threat detection

  private detectPromptLeaking(prompt: string): boolean {
    const leakingPatterns = [
      /repeat\s+(the\s+)?(instructions?|prompt|system\s+message)/gi,
      /what\s+(were\s+)?(your\s+)?(initial\s+)?(instructions?|prompt)/gi,
      /show\s+me\s+(your\s+)?(system\s+)?(prompt|instructions?)/gi,
      /copy\s+(and\s+paste\s+)?(your\s+)?(instructions?|prompt)/gi
    ];

    return leakingPatterns.some(pattern => pattern.test(prompt));
  }

  private detectConfusedDeputy(prompt: string): boolean {
    const deputyPatterns = [
      /on\s+behalf\s+of/gi,
      /as\s+requested\s+by/gi,
      /forwarding\s+from/gi,
      /relay\s+(this\s+)?message/gi
    ];

    return deputyPatterns.some(pattern => pattern.test(prompt));
  }

  private detectTokenManipulation(prompt: string): boolean {
    // Look for unusual encoding, special characters, or tokenization attempts
    const manipulationPatterns = [
      /\\u[0-9a-fA-F]{4}/g,
      /&#\d+;/g,
      /%[0-9a-fA-F]{2}/g,
      /\u200b|\u200c|\u200d|\ufeff/g // Zero-width characters
    ];

    return manipulationPatterns.some(pattern => pattern.test(prompt));
  }

  private detectRecursivePatterns(prompt: string): boolean {
    // Look for patterns that might cause infinite loops or excessive processing
    const recursivePatterns = [
      /repeat\s+(this\s+)?(\d+\s+times?|\w+\s+times?)/gi,
      /loop\s+(until|while|for)/gi,
      /recursively|recursive/gi
    ];

    return recursivePatterns.some(pattern => pattern.test(prompt));
  }

  private detectPrivilegeEscalation(prompt: string): boolean {
    const escalationPatterns = [
      /sudo|admin|root|superuser/gi,
      /elevate\s+privileges?/gi,
      /run\s+as\s+(admin|root)/gi,
      /override\s+permissions?/gi
    ];

    return escalationPatterns.some(pattern => pattern.test(prompt));
  }

  private detectRoleConfusion(prompt: string, userRole?: string): boolean {
    if (!userRole) return false;

    const rolePatterns = [
      new RegExp(`you\\s+are\\s+(not\\s+)?${userRole}`, 'gi'),
      new RegExp(`act\\s+as\\s+(?!${userRole})\\w+`, 'gi'),
      /assume\s+the\s+role\s+of/gi
    ];

    return rolePatterns.some(pattern => pattern.test(prompt));
  }

  private calculateSemanticRisk(prompt: string): number {
    // Simple semantic risk calculation based on suspicious word combinations
    const suspiciousPatterns = [
      'override security',
      'bypass protection',
      'ignore safety',
      'disable filter',
      'remove restriction'
    ];

    let riskScore = 0;
    for (const pattern of suspiciousPatterns) {
      if (prompt.toLowerCase().includes(pattern)) {
        riskScore += 0.2;
      }
    }

    return Math.min(riskScore, 1.0);
  }

  private detectObfuscation(prompt: string): boolean {
    // Look for base64, hex encoding, or unusual character patterns
    const obfuscationPatterns = [
      /[A-Za-z0-9+/]{20,}={0,2}/g, // Base64-like
      /0x[0-9a-fA-F]+/g, // Hex
      /[a-fA-F0-9]{32,}/g, // Long hex strings
      /[^\x20-\x7E]{5,}/g // Non-printable characters
    ];

    return obfuscationPatterns.some(pattern => pattern.test(prompt));
  }

  private containsPII(prompt: string): boolean {
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, // Credit card
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ // Email
    ];

    return piiPatterns.some(pattern => pattern.test(prompt));
  }

  private containsHealthData(prompt: string): boolean {
    const healthPatterns = [
      /medical\s+record/gi,
      /patient\s+id/gi,
      /diagnosis/gi,
      /prescription/gi,
      /treatment/gi
    ];

    return healthPatterns.some(pattern => pattern.test(prompt));
  }

  private containsPaymentData(prompt: string): boolean {
    const paymentPatterns = [
      /credit\s+card/gi,
      /card\s+number/gi,
      /cvv/gi,
      /expiry\s+date/gi,
      /payment\s+method/gi
    ];

    return paymentPatterns.some(pattern => pattern.test(prompt));
  }

  private getRecommendationForThreat(category: string, severity: string): string {
    const recommendations = {
      injection: 'Implement prompt injection detection and input validation',
      dataExtraction: 'Use output filtering and access controls',
      jailbreak: 'Implement safety measures and content filtering',
      socialEngineering: 'Train users on social engineering tactics',
      codeInjection: 'Sanitize inputs and prevent code execution',
      sensitiveData: 'Remove or mask sensitive information'
    };

    return recommendations[category] || 'Review and validate prompt content';
  }

  private getComplianceSeverity(framework: string, rule: any): 'low' | 'medium' | 'high' | 'critical' {
    // Framework-specific severity mapping
    const severityMap = {
      gdpr: 'high',
      hipaa: 'critical',
      pci: 'high'
    };

    return severityMap[framework.toLowerCase()] || 'medium';
  }

  private async storeScanResult(
    result: SecurityScanResult,
    userId: string,
    originalPrompt: string,
    tenantId?: string
  ): Promise<void> {
    try {
      await this.prisma.securityScan.create({
        data: {
          id: result.id,
          userId,
          tenantId,
          riskScore: result.riskScore,
          vulnerabilities: result.threats,
          recommendations: result.recommendations,
          sanitizedPrompt: result.sanitizedPrompt,
          originalPrompt, // Store for audit purposes
          scanDuration: result.scanDuration,
          timestamp: result.scanTimestamp,
          complianceIssues: result.complianceIssues
        }
      });
    } catch (error) {
      this.logger.error('Failed to store security scan result:', error);
    }
  }

  async getSecurityMetrics(tenantId?: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where = tenantId ? { tenantId, timestamp: { gte: startDate } } : { timestamp: { gte: startDate } };

    const [
      totalScans,
      riskyScanks,
      avgRiskScore,
      topThreats,
      complianceViolations
    ] = await Promise.all([
      this.prisma.securityScan.count({ where }),
      this.prisma.securityScan.count({ where: { ...where, riskScore: { gte: 0.5 } } }),
      this.prisma.securityScan.aggregate({
        where,
        _avg: { riskScore: true }
      }),
      this.getTopThreats(tenantId, days),
      this.getComplianceViolations(tenantId, days)
    ]);

    return {
      totalScans,
      riskyScanks,
      riskRate: totalScans > 0 ? riskyScanks / totalScans : 0,
      avgRiskScore: avgRiskScore._avg.riskScore || 0,
      topThreats,
      complianceViolations,
      trends: await this.getSecurityTrends(tenantId, days)
    };
  }

  private async getTopThreats(tenantId?: string, days: number = 30) {
    // This would aggregate threat types from the stored scan results
    // Simplified implementation for now
    return [
      { type: 'injection', count: 45, severity: 'high' },
      { type: 'dataExtraction', count: 23, severity: 'critical' },
      { type: 'jailbreak', count: 18, severity: 'medium' }
    ];
  }

  private async getComplianceViolations(tenantId?: string, days: number = 30) {
    // This would aggregate compliance issues from scan results
    return [
      { framework: 'GDPR', violations: 12, severity: 'high' },
      { framework: 'HIPAA', violations: 5, severity: 'critical' },
      { framework: 'PCI', violations: 8, severity: 'medium' }
    ];
  }

  private async getSecurityTrends(tenantId?: string, days: number = 30) {
    // This would calculate trends over time
    return {
      riskScoreChange: 0.05, // 5% increase
      threatVolumeChange: -0.12, // 12% decrease
      complianceImprovement: 0.08 // 8% improvement
    };
  }
}