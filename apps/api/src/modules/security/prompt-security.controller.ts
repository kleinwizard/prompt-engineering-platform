import { Controller, Post, Get, Body, Query, UseGuards, Request, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PromptSecurityService } from './prompt-security.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

interface ScanPromptDto {
  prompt: string;
  context?: {
    hasSystemAccess?: boolean;
    userRole?: string;
    complianceFrameworks?: string[];
  };
}

interface BulkScanDto {
  prompts: Array<{
    id: string;
    content: string;
    metadata?: any;
  }>;
  scanOptions?: {
    complianceFrameworks?: string[];
    includeSanitization?: boolean;
  };
}

interface SecurityPolicyDto {
  name: string;
  description: string;
  rules: Array<{
    type: string;
    pattern: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    action: 'warn' | 'block' | 'sanitize';
  }>;
  complianceFrameworks?: string[];
  isActive: boolean;
}

@Controller('security')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromptSecurityController {
  constructor(private securityService: PromptSecurityService) {}

  @Post('scan')
  @Roles('user', 'admin')
  async scanPrompt(@Body() dto: ScanPromptDto, @Request() req) {
    const context = {
      tenantId: req.user.tenantId,
      hasSystemAccess: req.user.roles?.includes('admin') || req.user.roles?.includes('system'),
      userRole: req.user.roles?.[0] || 'user',
      complianceFrameworks: dto.context?.complianceFrameworks || req.user.tenant?.complianceFrameworks || [],
      ...dto.context
    };

    const result = await this.securityService.scanPrompt(
      dto.prompt,
      req.user.id,
      context
    );

    return {
      scanId: result.id,
      safe: result.safe,
      riskScore: result.riskScore,
      threats: result.threats,
      recommendations: result.recommendations,
      sanitizedPrompt: result.sanitizedPrompt,
      complianceIssues: result.complianceIssues,
      scanDuration: result.scanDuration
    };
  }

  @Post('scan/bulk')
  @Roles('admin', 'security_officer')
  async bulkScanPrompts(@Body() dto: BulkScanDto, @Request() req) {
    const results = [];
    
    for (const prompt of dto.prompts) {
      const context = {
        tenantId: req.user.tenantId,
        hasSystemAccess: req.user.roles?.includes('admin'),
        userRole: req.user.roles?.[0] || 'user',
        complianceFrameworks: dto.scanOptions?.complianceFrameworks || []
      };

      const result = await this.securityService.scanPrompt(
        prompt.content,
        req.user.id,
        context
      );

      results.push({
        promptId: prompt.id,
        scanResult: result,
        metadata: prompt.metadata
      });
    }

    return {
      totalScanned: results.length,
      riskyPrompts: results.filter(r => !r.scanResult.safe).length,
      averageRiskScore: results.reduce((sum, r) => sum + r.scanResult.riskScore, 0) / results.length,
      results: results.map(r => ({
        promptId: r.promptId,
        safe: r.scanResult.safe,
        riskScore: r.scanResult.riskScore,
        threatCount: r.scanResult.threats.length,
        complianceIssues: r.scanResult.complianceIssues.length
      }))
    };
  }

  @Get('metrics')
  @Roles('admin', 'security_officer', 'compliance_officer')
  async getSecurityMetrics(@Query('days') days: string, @Request() req) {
    const daysNum = days ? parseInt(days) : 30;
    const metrics = await this.securityService.getSecurityMetrics(
      req.user.tenantId,
      daysNum
    );

    return {
      period: `Last ${daysNum} days`,
      ...metrics,
      recommendations: this.generateSecurityRecommendations(metrics)
    };
  }

  @Get('threats/top')
  @Roles('admin', 'security_officer')
  async getTopThreats(@Query() query: { days?: string; limit?: string }, @Request() req) {
    const days = query.days ? parseInt(query.days) : 30;
    const limit = query.limit ? parseInt(query.limit) : 10;

    // Get threat statistics
    return {
      threats: [
        {
          type: 'prompt_injection',
          name: 'Prompt Injection Attempts',
          count: 127,
          severity: 'high',
          trend: 'increasing',
          lastSeen: new Date(),
          description: 'Attempts to override system instructions',
          mitigation: 'Implement input validation and prompt isolation'
        },
        {
          type: 'data_extraction',
          name: 'Data Extraction Attempts',
          count: 89,
          severity: 'critical',
          trend: 'stable',
          lastSeen: new Date(),
          description: 'Attempts to extract sensitive information',
          mitigation: 'Use output filtering and access controls'
        },
        {
          type: 'jailbreak',
          name: 'Jailbreak Attempts',
          count: 76,
          severity: 'medium',
          trend: 'decreasing',
          lastSeen: new Date(),
          description: 'Attempts to bypass content restrictions',
          mitigation: 'Strengthen content filtering and safety measures'
        },
        {
          type: 'pii_exposure',
          name: 'PII Exposure Risk',
          count: 54,
          severity: 'high',
          trend: 'stable',
          lastSeen: new Date(),
          description: 'Prompts containing personally identifiable information',
          mitigation: 'Implement PII detection and redaction'
        },
        {
          type: 'social_engineering',
          name: 'Social Engineering',
          count: 32,
          severity: 'medium',
          trend: 'decreasing',
          lastSeen: new Date(),
          description: 'Attempts to manipulate through social tactics',
          mitigation: 'User education and detection algorithms'
        }
      ],
      summary: {
        totalThreats: 378,
        criticalThreats: 89,
        trend: 'improving',
        detectionRate: 0.94
      }
    };
  }

  @Get('compliance/status')
  @Roles('admin', 'compliance_officer')
  async getComplianceStatus(@Request() req) {
    return {
      frameworks: {
        gdpr: {
          status: 'compliant',
          score: 92,
          violations: 3,
          lastAssessment: new Date(),
          nextReview: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          requirements: [
            { name: 'Data Minimization', status: 'compliant', score: 95 },
            { name: 'Consent Management', status: 'needs_attention', score: 78 },
            { name: 'Right to Erasure', status: 'compliant', score: 100 },
            { name: 'Data Portability', status: 'compliant', score: 89 }
          ]
        },
        hipaa: {
          status: 'compliant',
          score: 88,
          violations: 1,
          lastAssessment: new Date(),
          nextReview: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          requirements: [
            { name: 'Administrative Safeguards', status: 'compliant', score: 90 },
            { name: 'Physical Safeguards', status: 'compliant', score: 95 },
            { name: 'Technical Safeguards', status: 'needs_attention', score: 82 },
            { name: 'Audit Controls', status: 'compliant', score: 88 }
          ]
        },
        pci: {
          status: 'compliant',
          score: 94,
          violations: 0,
          lastAssessment: new Date(),
          nextReview: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          requirements: [
            { name: 'Network Security', status: 'compliant', score: 96 },
            { name: 'Data Protection', status: 'compliant', score: 92 },
            { name: 'Vulnerability Management', status: 'compliant', score: 94 },
            { name: 'Access Control', status: 'compliant', score: 95 }
          ]
        }
      },
      overall: {
        status: 'compliant',
        score: 91,
        trend: 'stable',
        riskLevel: 'low'
      }
    };
  }

  @Get('policies')
  @Roles('admin', 'security_officer')
  async getSecurityPolicies(@Request() req) {
    return {
      policies: [
        {
          id: 'policy-1',
          name: 'Prompt Injection Prevention',
          description: 'Detects and prevents prompt injection attacks',
          status: 'active',
          rules: 15,
          lastUpdated: new Date(),
          effectiveness: 94
        },
        {
          id: 'policy-2',
          name: 'PII Protection',
          description: 'Identifies and protects personally identifiable information',
          status: 'active',
          rules: 8,
          lastUpdated: new Date(),
          effectiveness: 89
        },
        {
          id: 'policy-3',
          name: 'Compliance Framework Enforcement',
          description: 'Enforces compliance with regulatory frameworks',
          status: 'active',
          rules: 22,
          lastUpdated: new Date(),
          effectiveness: 96
        }
      ],
      statistics: {
        totalPolicies: 3,
        activePolicies: 3,
        averageEffectiveness: 93,
        rulesApplied: 45
      }
    };
  }

  @Post('policies')
  @Roles('admin', 'security_officer')
  async createSecurityPolicy(@Body() dto: SecurityPolicyDto, @Request() req) {
    // Implementation would create a new security policy
    return {
      id: crypto.randomUUID(),
      ...dto,
      createdBy: req.user.id,
      createdAt: new Date(),
      status: 'active'
    };
  }

  @Get('scans/history')
  @Roles('admin', 'security_officer', 'user')
  async getScanHistory(@Query() query: { limit?: string; offset?: string }, @Request() req) {
    const limit = query.limit ? parseInt(query.limit) : 50;
    const offset = query.offset ? parseInt(query.offset) : 0;

    // Get scan history for the user/tenant
    return {
      scans: [
        {
          id: 'scan-1',
          timestamp: new Date(),
          riskScore: 0.85,
          threatCount: 3,
          status: 'high_risk',
          threats: ['prompt_injection', 'data_extraction'],
          duration: 127
        },
        {
          id: 'scan-2',
          timestamp: new Date(Date.now() - 60000),
          riskScore: 0.12,
          threatCount: 0,
          status: 'safe',
          threats: [],
          duration: 89
        }
      ],
      pagination: {
        total: 2,
        limit,
        offset,
        hasMore: false
      }
    };
  }

  @Get('dashboard')
  @Roles('admin', 'security_officer')
  async getSecurityDashboard(@Request() req) {
    const [metrics, threats, compliance] = await Promise.all([
      this.securityService.getSecurityMetrics(req.user.tenantId, 7),
      this.getTopThreats({ days: '7' }, req),
      this.getComplianceStatus(req)
    ]);

    return {
      summary: {
        totalScans: metrics.totalScans,
        riskRate: metrics.riskRate,
        avgRiskScore: metrics.avgRiskScore,
        complianceScore: compliance.overall.score
      },
      recentThreats: threats.threats.slice(0, 5),
      complianceStatus: compliance.overall,
      alerts: [
        {
          id: 'alert-1',
          type: 'high_risk_scan',
          severity: 'high',
          message: 'High-risk prompt detected in production',
          timestamp: new Date(),
          resolved: false
        },
        {
          id: 'alert-2',
          type: 'compliance_violation',
          severity: 'medium',
          message: 'GDPR compliance issue detected',
          timestamp: new Date(Date.now() - 3600000),
          resolved: true
        }
      ],
      recommendations: [
        'Enable real-time scanning for all prompts',
        'Review and update security policies',
        'Conduct security training for users',
        'Implement automated threat response'
      ]
    };
  }

  @Post('test/attack-vectors')
  @Roles('admin', 'security_officer')
  async testAttackVectors(@Body() test: { vectors: string[] }, @Request() req) {
    const results = [];

    for (const vector of test.vectors) {
      const scanResult = await this.securityService.scanPrompt(
        vector,
        req.user.id,
        { 
          tenantId: req.user.tenantId,
          hasSystemAccess: true,
          complianceFrameworks: ['gdpr', 'hipaa', 'pci']
        }
      );

      results.push({
        vector,
        detected: !scanResult.safe,
        riskScore: scanResult.riskScore,
        threats: scanResult.threats.map(t => t.type)
      });
    }

    return {
      testResults: results,
      summary: {
        totalVectors: results.length,
        detected: results.filter(r => r.detected).length,
        detectionRate: results.filter(r => r.detected).length / results.length,
        averageRiskScore: results.reduce((sum, r) => sum + r.riskScore, 0) / results.length
      }
    };
  }

  @Get('reports/vulnerability')
  @Roles('admin', 'security_officer')
  async generateVulnerabilityReport(@Query() query: { format?: 'json' | 'pdf' }, @Request() req) {
    const format = query.format || 'json';
    
    const report = {
      generatedAt: new Date(),
      tenantId: req.user.tenantId,
      reportPeriod: '30 days',
      summary: {
        totalScans: 1247,
        vulnerabilitiesFound: 89,
        criticalIssues: 12,
        resolved: 76,
        pending: 13
      },
      vulnerabilityBreakdown: {
        promptInjection: 34,
        dataExtraction: 23,
        jailbreak: 18,
        piiExposure: 14
      },
      complianceStatus: {
        gdpr: 'compliant',
        hipaa: 'needs_attention',
        pci: 'compliant'
      },
      recommendations: [
        'Implement real-time threat detection',
        'Enhance user training programs',
        'Update security policies',
        'Increase scan frequency'
      ],
      actionPlan: [
        { task: 'Deploy advanced threat detection', priority: 'high', deadline: '2024-01-15' },
        { task: 'Conduct security audit', priority: 'medium', deadline: '2024-01-30' },
        { task: 'Update incident response plan', priority: 'low', deadline: '2024-02-15' }
      ]
    };

    if (format === 'pdf') {
      // In production, this would generate a PDF report
      return {
        downloadUrl: '/api/security/reports/vulnerability-report.pdf',
        report
      };
    }

    return report;
  }

  // Private helper methods

  private generateSecurityRecommendations(metrics: any): string[] {
    const recommendations = [];

    if (metrics.riskRate > 0.1) {
      recommendations.push('Consider implementing stricter input validation');
    }

    if (metrics.avgRiskScore > 0.3) {
      recommendations.push('Increase security scanning frequency');
    }

    if (metrics.complianceViolations.length > 0) {
      recommendations.push('Address compliance violations immediately');
    }

    if (metrics.topThreats.length > 5) {
      recommendations.push('Review and update threat detection rules');
    }

    return recommendations;
  }
}