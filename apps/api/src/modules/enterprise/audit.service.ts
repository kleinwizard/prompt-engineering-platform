import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

interface AuditEvent {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failure' | 'partial';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  timestamp?: Date;
}

export interface ComplianceReport {
  id: string;
  type: 'gdpr' | 'hipaa' | 'sox' | 'iso27001' | 'pci' | 'custom';
  period: {
    startDate: Date;
    endDate: Date;
  };
  totalEvents: number;
  criticalEvents: number;
  findings: ComplianceFinding[];
  recommendations: string[];
  status: 'passed' | 'failed' | 'needs_attention';
  generatedAt: Date;
  generatedBy: string;
  signature: string;
}

interface ComplianceFinding {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  description: string;
  affectedRecords: number;
  remediation: string;
  evidence: string[];
}

export interface DataRetentionPolicy {
  tenantId: string;
  resourceType: string;
  retentionPeriod: number; // days
  archivalPolicy: 'delete' | 'archive' | 'anonymize';
  complianceRequirement: string;
  isActive: boolean;
}

export interface AuditQuery {
  tenantId?: string;
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  riskLevel?: string;
  result?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly sensitiveFields = [
    'password', 'token', 'secret', 'key', 'apiKey', 'accessToken', 
    'refreshToken', 'privateKey', 'certificate', 'ssn', 'creditCard'
  ];

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService
  ) {}

  async logEvent(event: AuditEvent): Promise<void> {
    try {
      // Sanitize sensitive data
      const sanitizedMetadata = this.sanitizeData(event.metadata || {});
      const sanitizedChanges = this.sanitizeData(event.changes || {});

      // Generate event signature for integrity verification
      const signature = this.generateEventSignature(event);

      // Determine compliance categories
      const complianceCategories = this.categorizeForCompliance(event);

      // Create immutable audit log entry
      const auditLog = await this.prisma.auditLog.create({
        data: {
          userId: event.userId,
          tenantId: event.tenantId,
          sessionId: event.sessionId,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId,
          changes: sanitizedChanges,
          metadata: sanitizedMetadata,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          result: event.result,
          riskLevel: event.riskLevel,
          timestamp: event.timestamp || new Date(),
          signature,
          complianceCategories,
          sequenceNumber: await this.getNextSequenceNumber(event.tenantId)
        }
      });

      // Process for real-time compliance monitoring
      await this.processComplianceMonitoring(auditLog);

      // Check for suspicious patterns
      await this.checkSecurityPatterns(event);

      // Archive if required by compliance
      if (this.requiresImmedateArchival(event)) {
        await this.archiveForCompliance(auditLog);
      }

      this.logger.debug(`Audit event logged: ${auditLog.id}`);

    } catch (error) {
      this.logger.error('Failed to log audit event:', error);
      // Critical: audit logging failure should be handled gracefully
      // but also logged to a separate failsafe system
      await this.logAuditFailure(event, error);
    }
  }

  async queryAuditLogs(query: AuditQuery) {
    const where: any = {};

    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.resource) where.resource = query.resource;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
    if (query.result) where.result = query.result;

    if (query.startDate || query.endDate) {
      where.timestamp = {};
      if (query.startDate) where.timestamp.gte = query.startDate;
      if (query.endDate) where.timestamp.lte = query.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, email: true }
          }
        },
        orderBy: { timestamp: 'desc' },
        take: query.limit || 100,
        skip: query.offset || 0
      }),
      this.prisma.auditLog.count({ where })
    ]);

    return {
      logs: logs.map(log => ({
        ...log,
        signatureValid: this.verifyEventSignature(log)
      })),
      total,
      query
    };
  }

  async generateComplianceReport(
    tenantId: string,
    type: ComplianceReport['type'],
    startDate: Date,
    endDate: Date,
    generatedBy: string
  ): Promise<ComplianceReport> {
    this.logger.log(`Generating ${type} compliance report for tenant: ${tenantId}`);

    const reportId = crypto.randomUUID();
    
    // Get relevant audit events for the period
    const auditEvents = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startDate,
          lte: endDate
        },
        complianceCategories: {
          has: type
        }
      },
      orderBy: { timestamp: 'desc' }
    });

    // Generate compliance-specific analysis
    const findings = await this.analyzeComplianceEvents(auditEvents, type);
    const recommendations = this.generateComplianceRecommendations(findings, type);
    const status = this.determineComplianceStatus(findings);

    const report: ComplianceReport = {
      id: reportId,
      type,
      period: { startDate, endDate },
      totalEvents: auditEvents.length,
      criticalEvents: auditEvents.filter(e => e.riskLevel === 'critical').length,
      findings,
      recommendations,
      status,
      generatedAt: new Date(),
      generatedBy,
      signature: this.generateReportSignature(reportId, findings)
    };

    // Store report in compliance archive
    await this.storeComplianceReport(report, tenantId);

    this.logger.log(`Compliance report generated: ${reportId}`);
    return report;
  }

  async getDataRetentionPolicies(tenantId: string): Promise<DataRetentionPolicy[]> {
    return this.prisma.dataRetentionPolicy.findMany({
      where: { tenantId, isActive: true },
      orderBy: { resourceType: 'asc' }
    });
  }

  async setDataRetentionPolicy(policy: Omit<DataRetentionPolicy, 'id'>): Promise<void> {
    await this.prisma.dataRetentionPolicy.upsert({
      where: {
        tenantId_resourceType: {
          tenantId: policy.tenantId,
          resourceType: policy.resourceType
        }
      },
      update: {
        retentionPeriod: policy.retentionPeriod,
        archivalPolicy: policy.archivalPolicy,
        complianceRequirement: policy.complianceRequirement,
        isActive: policy.isActive,
        updatedAt: new Date()
      },
      create: policy
    });
  }

  async enforceDataRetention(tenantId?: string): Promise<{
    processed: number;
    archived: number;
    deleted: number;
    anonymized: number;
  }> {
    this.logger.log('Starting data retention enforcement');

    const policies = tenantId 
      ? await this.getDataRetentionPolicies(tenantId)
      : await this.prisma.dataRetentionPolicy.findMany({ where: { isActive: true } });

    let processed = 0;
    let archived = 0;
    let deleted = 0;
    let anonymized = 0;

    for (const policy of policies) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionPeriod);

      const expiredLogs = await this.prisma.auditLog.findMany({
        where: {
          tenantId: policy.tenantId,
          resource: policy.resourceType,
          timestamp: { lt: cutoffDate }
        }
      });

      for (const log of expiredLogs) {
        switch (policy.archivalPolicy) {
          case 'archive':
            await this.archiveAuditLog(log);
            archived++;
            break;
          case 'delete':
            await this.deleteAuditLog(log.id);
            deleted++;
            break;
          case 'anonymize':
            await this.anonymizeAuditLog(log.id);
            anonymized++;
            break;
        }
        processed++;
      }
    }

    this.logger.log(`Data retention completed: ${processed} records processed`);
    return { processed, archived, deleted, anonymized };
  }

  async validateAuditIntegrity(tenantId: string, startDate: Date, endDate: Date) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        timestamp: { gte: startDate, lte: endDate }
      },
      orderBy: { sequenceNumber: 'asc' }
    });

    const results = {
      totalLogs: logs.length,
      validSignatures: 0,
      invalidSignatures: 0,
      missingLogs: 0,
      tamperedLogs: 0,
      sequenceGaps: 0
    };

    let expectedSequence = logs[0]?.sequenceNumber || 1;

    for (const log of logs) {
      // Verify signature
      if (this.verifyEventSignature(log)) {
        results.validSignatures++;
      } else {
        results.invalidSignatures++;
        results.tamperedLogs++;
      }

      // Check sequence integrity
      if (log.sequenceNumber !== expectedSequence) {
        results.sequenceGaps++;
        results.missingLogs += log.sequenceNumber - expectedSequence;
      }
      expectedSequence = log.sequenceNumber + 1;
    }

    return results;
  }

  async exportComplianceData(
    tenantId: string,
    type: 'gdpr' | 'hipaa' | 'sox' | 'all',
    format: 'json' | 'csv' | 'xml',
    startDate?: Date,
    endDate?: Date
  ) {
    const where: any = { tenantId };

    if (type !== 'all') {
      where.complianceCategories = { has: type };
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const data = await this.prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, email: true }
        }
      },
      orderBy: { timestamp: 'desc' }
    });

    // Format data based on requested format
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'csv':
        return this.convertToCSV(data);
      case 'xml':
        return this.convertToXML(data);
      default:
        return data;
    }
  }

  async getComplianceMetrics(tenantId: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [
      totalEvents,
      criticalEvents,
      failedEvents,
      uniqueUsers,
      topActions,
      riskDistribution
    ] = await Promise.all([
      this.prisma.auditLog.count({
        where: { tenantId, timestamp: { gte: startDate } }
      }),
      this.prisma.auditLog.count({
        where: { tenantId, timestamp: { gte: startDate }, riskLevel: 'critical' }
      }),
      this.prisma.auditLog.count({
        where: { tenantId, timestamp: { gte: startDate }, result: 'failure' }
      }),
      this.prisma.auditLog.findMany({
        where: { tenantId, timestamp: { gte: startDate } },
        distinct: ['userId'],
        select: { userId: true }
      }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { tenantId, timestamp: { gte: startDate } },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 10
      }),
      this.prisma.auditLog.groupBy({
        by: ['riskLevel'],
        where: { tenantId, timestamp: { gte: startDate } },
        _count: { riskLevel: true }
      })
    ]);

    return {
      totalEvents,
      criticalEvents,
      failedEvents,
      uniqueUsers: uniqueUsers.length,
      topActions: topActions.map(action => ({
        action: action.action,
        count: action._count.action
      })),
      riskDistribution: riskDistribution.reduce((acc, risk) => {
        acc[risk.riskLevel] = risk._count.riskLevel;
        return acc;
      }, {} as Record<string, number>),
      complianceScore: this.calculateComplianceScore(totalEvents, criticalEvents, failedEvents)
    };
  }

  // Private helper methods

  private sanitizeData(data: Record<string, any>): Record<string, any> {
    const sanitized = { ...data };

    for (const field of this.sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Deep sanitization for nested objects
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeData(value);
      }
    }

    return sanitized;
  }

  private generateEventSignature(event: AuditEvent): string {
    const signingKey = this.configService.get('AUDIT_SIGNING_KEY') || 'default-key';
    
    const payload = JSON.stringify({
      userId: event.userId,
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      timestamp: event.timestamp?.toISOString(),
      result: event.result
    });

    return crypto
      .createHmac('sha256', signingKey)
      .update(payload)
      .digest('hex');
  }

  private verifyEventSignature(log: any): boolean {
    const expectedSignature = this.generateEventSignature({
      userId: log.userId,
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId,
      timestamp: log.timestamp,
      result: log.result
    } as AuditEvent);

    return log.signature === expectedSignature;
  }

  private categorizeForCompliance(event: AuditEvent): string[] {
    const categories: string[] = [];

    // GDPR - Personal data processing
    if (this.isPersonalDataEvent(event)) {
      categories.push('gdpr');
    }

    // HIPAA - Healthcare data
    if (this.isHealthcareDataEvent(event)) {
      categories.push('hipaa');
    }

    // SOX - Financial controls
    if (this.isFinancialDataEvent(event)) {
      categories.push('sox');
    }

    // ISO27001 - Information security
    if (this.isSecurityEvent(event)) {
      categories.push('iso27001');
    }

    // PCI - Payment card data
    if (this.isPaymentDataEvent(event)) {
      categories.push('pci');
    }

    return categories;
  }

  private isPersonalDataEvent(event: AuditEvent): boolean {
    const personalDataActions = ['user.create', 'user.update', 'user.delete', 'profile.update'];
    const personalDataResources = ['user', 'profile', 'personal_data'];
    
    return personalDataActions.includes(event.action) || 
           personalDataResources.includes(event.resource);
  }

  private isHealthcareDataEvent(event: AuditEvent): boolean {
    const healthcareResources = ['patient', 'medical_record', 'health_data'];
    return healthcareResources.some(resource => 
      event.resource.toLowerCase().includes(resource)
    );
  }

  private isFinancialDataEvent(event: AuditEvent): boolean {
    const financialActions = ['payment.process', 'billing.update', 'financial.report'];
    const financialResources = ['payment', 'billing', 'financial', 'revenue'];
    
    return financialActions.includes(event.action) || 
           financialResources.some(resource => 
             event.resource.toLowerCase().includes(resource)
           );
  }

  private isSecurityEvent(event: AuditEvent): boolean {
    const securityActions = ['login', 'logout', 'permission.change', 'access.grant', 'access.revoke'];
    return securityActions.some(action => event.action.includes(action)) ||
           event.riskLevel === 'high' || event.riskLevel === 'critical';
  }

  private isPaymentDataEvent(event: AuditEvent): boolean {
    const paymentResources = ['credit_card', 'payment_method', 'transaction'];
    return paymentResources.some(resource => 
      event.resource.toLowerCase().includes(resource)
    );
  }

  private async getNextSequenceNumber(tenantId?: string): Promise<number> {
    const lastLog = await this.prisma.auditLog.findFirst({
      where: tenantId ? { tenantId } : {},
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true }
    });

    return (lastLog?.sequenceNumber || 0) + 1;
  }

  private async processComplianceMonitoring(auditLog: any): Promise<void> {
    // Real-time compliance alerts for critical events
    if (auditLog.riskLevel === 'critical') {
      await this.sendComplianceAlert(auditLog);
    }

    // Update compliance metrics
    await this.updateComplianceMetrics(auditLog);
  }

  private async checkSecurityPatterns(event: AuditEvent): Promise<void> {
    // Check for suspicious patterns like multiple failed logins
    if (event.action === 'login' && event.result === 'failure' && event.userId) {
      const recentFailures = await this.prisma.auditLog.count({
        where: {
          userId: event.userId,
          action: 'login',
          result: 'failure',
          timestamp: {
            gte: new Date(Date.now() - 15 * 60 * 1000) // Last 15 minutes
          }
        }
      });

      if (recentFailures >= 5) {
        await this.logEvent({
          ...event,
          action: 'security.suspicious_login_pattern',
          riskLevel: 'high',
          metadata: { failedAttempts: recentFailures }
        });
      }
    }
  }

  private requiresImmedateArchival(event: AuditEvent): boolean {
    return event.riskLevel === 'critical' || 
           event.action.includes('security') ||
           event.resource === 'audit_log';
  }

  private async archiveForCompliance(auditLog: any): Promise<void> {
    // Archive to secure, immutable storage
    await this.prisma.auditArchive.create({
      data: {
        originalId: auditLog.id,
        tenantId: auditLog.tenantId,
        archiveData: auditLog,
        archiveReason: 'compliance_requirement',
        archivedAt: new Date()
      }
    });
  }

  private async logAuditFailure(event: AuditEvent, error: any): Promise<void> {
    // Log to separate failsafe system or file
    this.logger.error('CRITICAL: Audit logging failure', {
      event,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }

  private async analyzeComplianceEvents(events: any[], type: string): Promise<ComplianceFinding[]> {
    const findings: ComplianceFinding[] = [];

    switch (type) {
      case 'gdpr':
        findings.push(...this.analyzeGDPRCompliance(events));
        break;
      case 'hipaa':
        findings.push(...this.analyzeHIPAACompliance(events));
        break;
      case 'sox':
        findings.push(...this.analyzeSOXCompliance(events));
        break;
      case 'iso27001':
        findings.push(...this.analyzeISO27001Compliance(events));
        break;
    }

    return findings;
  }

  private analyzeGDPRCompliance(events: any[]): ComplianceFinding[] {
    const findings: ComplianceFinding[] = [];

    // Check for consent tracking
    const dataProcessingEvents = events.filter(e => 
      e.resource === 'user' && ['create', 'update', 'delete'].includes(e.action)
    );

    const missingConsent = dataProcessingEvents.filter(e => 
      !e.metadata?.consent || !e.metadata?.legalBasis
    );

    if (missingConsent.length > 0) {
      findings.push({
        severity: 'high',
        category: 'consent_tracking',
        description: 'Personal data processing without documented consent or legal basis',
        affectedRecords: missingConsent.length,
        remediation: 'Implement consent tracking for all personal data processing activities',
        evidence: missingConsent.map(e => e.id)
      });
    }

    return findings;
  }

  private analyzeHIPAACompliance(events: any[]): ComplianceFinding[] {
    const findings: ComplianceFinding[] = [];

    // Check for access to PHI without authorization
    const phiAccess = events.filter(e => 
      e.resource.includes('health') || e.resource.includes('medical')
    );

    const unauthorizedAccess = phiAccess.filter(e => 
      !e.metadata?.authorization || !e.metadata?.businessJustification
    );

    if (unauthorizedAccess.length > 0) {
      findings.push({
        severity: 'critical',
        category: 'unauthorized_phi_access',
        description: 'Access to PHI without proper authorization or business justification',
        affectedRecords: unauthorizedAccess.length,
        remediation: 'Implement strict authorization controls for PHI access',
        evidence: unauthorizedAccess.map(e => e.id)
      });
    }

    return findings;
  }

  private analyzeSOXCompliance(events: any[]): ComplianceFinding[] {
    const findings: ComplianceFinding[] = [];

    // Check for financial data changes without approval
    const financialChanges = events.filter(e => 
      e.resource.includes('financial') && e.action === 'update'
    );

    const unapprovedChanges = financialChanges.filter(e => 
      !e.metadata?.approvedBy || !e.metadata?.approvalWorkflow
    );

    if (unapprovedChanges.length > 0) {
      findings.push({
        severity: 'high',
        category: 'unapproved_financial_changes',
        description: 'Financial data modifications without proper approval workflow',
        affectedRecords: unapprovedChanges.length,
        remediation: 'Implement mandatory approval workflows for financial data changes',
        evidence: unapprovedChanges.map(e => e.id)
      });
    }

    return findings;
  }

  private analyzeISO27001Compliance(events: any[]): ComplianceFinding[] {
    const findings: ComplianceFinding[] = [];

    // Check for security incidents
    const securityEvents = events.filter(e => 
      e.riskLevel === 'high' || e.riskLevel === 'critical'
    );

    const unresolvedIncidents = securityEvents.filter(e => 
      !e.metadata?.incidentResolved || !e.metadata?.responseTime
    );

    if (unresolvedIncidents.length > 0) {
      findings.push({
        severity: 'medium',
        category: 'incident_response',
        description: 'Security incidents without documented resolution or response',
        affectedRecords: unresolvedIncidents.length,
        remediation: 'Implement incident response procedures with resolution tracking',
        evidence: unresolvedIncidents.map(e => e.id)
      });
    }

    return findings;
  }

  private generateComplianceRecommendations(findings: ComplianceFinding[], type: string): string[] {
    const recommendations: string[] = [];

    if (findings.some(f => f.severity === 'critical')) {
      recommendations.push('Immediate action required: Address critical compliance violations');
    }

    switch (type) {
      case 'gdpr':
        recommendations.push('Implement comprehensive consent management system');
        recommendations.push('Establish data subject rights fulfillment procedures');
        break;
      case 'hipaa':
        recommendations.push('Strengthen PHI access controls and authorization workflows');
        recommendations.push('Implement comprehensive audit trail for all PHI access');
        break;
      case 'sox':
        recommendations.push('Establish segregation of duties for financial controls');
        recommendations.push('Implement automated approval workflows for financial changes');
        break;
    }

    return recommendations;
  }

  private determineComplianceStatus(findings: ComplianceFinding[]): ComplianceReport['status'] {
    if (findings.some(f => f.severity === 'critical')) {
      return 'failed';
    }
    if (findings.some(f => f.severity === 'high')) {
      return 'needs_attention';
    }
    return 'passed';
  }

  private generateReportSignature(reportId: string, findings: ComplianceFinding[]): string {
    const signingKey = this.configService.get('AUDIT_SIGNING_KEY') || 'default-key';
    
    const payload = JSON.stringify({
      reportId,
      findingsHash: crypto.createHash('sha256').update(JSON.stringify(findings)).digest('hex'),
      timestamp: new Date().toISOString()
    });

    return crypto
      .createHmac('sha256', signingKey)
      .update(payload)
      .digest('hex');
  }

  private async storeComplianceReport(report: ComplianceReport, tenantId: string): Promise<void> {
    await this.prisma.complianceReport.create({
      data: {
        id: report.id,
        tenantId,
        type: report.type,
        periodStart: report.period.startDate,
        periodEnd: report.period.endDate,
        totalEvents: report.totalEvents,
        criticalEvents: report.criticalEvents,
        findings: report.findings,
        recommendations: report.recommendations,
        status: report.status,
        generatedBy: report.generatedBy,
        signature: report.signature,
        reportData: report
      }
    });
  }

  private async sendComplianceAlert(auditLog: any): Promise<void> {
    // Send real-time alerts for critical compliance events
    this.logger.warn('Critical compliance event detected', {
      eventId: auditLog.id,
      action: auditLog.action,
      resource: auditLog.resource,
      riskLevel: auditLog.riskLevel
    });
  }

  private async updateComplianceMetrics(auditLog: any): Promise<void> {
    // Update real-time compliance metrics
    const today = new Date().toISOString().split('T')[0];
    
    await this.prisma.complianceMetrics.upsert({
      where: {
        tenantId_date: {
          tenantId: auditLog.tenantId || 'global',
          date: today
        }
      },
      update: {
        totalEvents: { increment: 1 },
        criticalEvents: auditLog.riskLevel === 'critical' ? { increment: 1 } : undefined,
        failedEvents: auditLog.result === 'failure' ? { increment: 1 } : undefined
      },
      create: {
        tenantId: auditLog.tenantId || 'global',
        date: today,
        totalEvents: 1,
        criticalEvents: auditLog.riskLevel === 'critical' ? 1 : 0,
        failedEvents: auditLog.result === 'failure' ? 1 : 0
      }
    });
  }

  private calculateComplianceScore(total: number, critical: number, failed: number): number {
    if (total === 0) return 100;
    
    const criticalPenalty = (critical / total) * 50;
    const failurePenalty = (failed / total) * 30;
    
    return Math.max(0, 100 - criticalPenalty - failurePenalty);
  }

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        return typeof value === 'string' ? `"${value}"` : value;
      });
      csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
  }

  private convertToXML(data: any[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<audit_logs>\n';
    
    for (const log of data) {
      xml += '  <log>\n';
      for (const [key, value] of Object.entries(log)) {
        xml += `    <${key}>${value}</${key}>\n`;
      }
      xml += '  </log>\n';
    }
    
    xml += '</audit_logs>';
    return xml;
  }

  private async archiveAuditLog(log: any): Promise<void> {
    await this.archiveForCompliance(log);
    await this.deleteAuditLog(log.id);
  }

  private async deleteAuditLog(logId: string): Promise<void> {
    await this.prisma.auditLog.delete({
      where: { id: logId }
    });
  }

  private async anonymizeAuditLog(logId: string): Promise<void> {
    await this.prisma.auditLog.update({
      where: { id: logId },
      data: {
        userId: null,
        ipAddress: '[ANONYMIZED]',
        userAgent: '[ANONYMIZED]',
        metadata: {},
        changes: {}
      }
    });
  }
}