import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async log(data: {
    userId: string;
    action: string;
    resource: string;
    resourceId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }) {
    try {
      const auditEntry = await this.prisma.auditLog.create({
        data: {
          userId: data.userId,
          action: data.action,
          resource: data.resource,
          resourceId: data.resourceId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          metadata: data.metadata ? JSON.stringify(data.metadata) : null,
          timestamp: new Date(),
        },
      });

      this.logger.log(`Audit log created: ${data.action} on ${data.resource} by user ${data.userId}`);
      return auditEntry;
    } catch (error) {
      this.logger.error('Failed to create audit log', error);
      throw error;
    }
  }

  async logSensitiveAction(
    userId: string,
    action: string,
    details: Record<string, any>
  ) {
    // Log to both database and external service
    await this.log({
      userId,
      action,
      resource: 'sensitive',
      metadata: details
    });

    // Also send to SIEM if configured
    const siemEndpoint = this.configService.get('SIEM_ENDPOINT');
    if (siemEndpoint) {
      await this.sendToSIEM({ userId, action, details });
    }

    // Send to security monitoring service
    await this.sendToSecurityMonitoring({
      userId,
      action,
      details,
      timestamp: new Date(),
      severity: this.determineSeverity(action),
    });
  }

  async logDataAccess(data: {
    userId: string;
    resource: string;
    resourceId: string;
    accessType: 'read' | 'write' | 'delete';
    ipAddress?: string;
    userAgent?: string;
    success: boolean;
    metadata?: Record<string, any>;
  }) {
    await this.log({
      userId: data.userId,
      action: `data_${data.accessType}`,
      resource: data.resource,
      resourceId: data.resourceId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      metadata: {
        ...data.metadata,
        success: data.success,
        accessType: data.accessType,
      },
    });
  }

  async logPrivilegeChange(data: {
    adminUserId: string;
    targetUserId: string;
    action: 'grant' | 'revoke';
    privilege: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    await this.logSensitiveAction(data.adminUserId, 'privilege_change', {
      targetUserId: data.targetUserId,
      action: data.action,
      privilege: data.privilege,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    });
  }

  async logAuthenticationEvent(data: {
    userId?: string;
    email?: string;
    event: 'login_success' | 'login_failure' | 'logout' | 'password_change' | 'account_locked';
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }) {
    await this.log({
      userId: data.userId || 'anonymous',
      action: `auth_${data.event}`,
      resource: 'authentication',
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      metadata: {
        ...data.metadata,
        email: data.email,
        event: data.event,
      },
    });
  }

  async logSystemEvent(data: {
    action: string;
    resource: string;
    details: Record<string, any>;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }) {
    await this.log({
      userId: 'system',
      action: data.action,
      resource: data.resource,
      metadata: {
        ...data.details,
        severity: data.severity || 'medium',
        systemEvent: true,
      },
    });

    // Alert on critical system events
    if (data.severity === 'critical') {
      await this.sendCriticalAlert({
        action: data.action,
        resource: data.resource,
        details: data.details,
        timestamp: new Date(),
      });
    }
  }

  async getAuditLogs(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (filters.userId && filters.userId !== 'all') {
      where.userId = filters.userId;
    }

    if (filters.action) {
      where.action = { contains: filters.action, mode: 'insensitive' };
    }

    if (filters.resource) {
      where.resource = { contains: filters.resource, mode: 'insensitive' };
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate;
      }
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
        take: filters.limit || 100,
        skip: filters.offset || 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  async generateComplianceReport(options: {
    startDate: Date;
    endDate: Date;
    reportType: 'gdpr' | 'hipaa' | 'sox' | 'pci';
  }) {
    const relevantActions = this.getRelevantActionsForCompliance(options.reportType);
    
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: { in: relevantActions },
        timestamp: {
          gte: options.startDate,
          lte: options.endDate,
        },
      },
      include: {
        user: {
          select: { id: true, username: true, email: true }
        }
      },
      orderBy: { timestamp: 'desc' },
    });

    const summary = {
      totalEvents: logs.length,
      uniqueUsers: new Set(logs.map(log => log.userId)).size,
      eventsByAction: this.groupByAction(logs),
      eventsByUser: this.groupByUser(logs),
      complianceStatus: this.assessComplianceStatus(logs, options.reportType),
      recommendations: this.generateComplianceRecommendations(logs, options.reportType),
    };

    return {
      reportType: options.reportType,
      period: {
        start: options.startDate,
        end: options.endDate,
      },
      summary,
      logs,
      generatedAt: new Date(),
    };
  }

  private async sendToSIEM(data: any) {
    try {
      const siemEndpoint = this.configService.get('SIEM_ENDPOINT');
      const siemApiKey = this.configService.get('SIEM_API_KEY');

      if (!siemEndpoint) {
        this.logger.debug('SIEM endpoint not configured');
        return;
      }

      await axios.post(siemEndpoint, {
        eventType: 'audit_log',
        timestamp: new Date().toISOString(),
        ...data,
      }, {
        headers: {
          'Authorization': `Bearer ${siemApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      this.logger.debug('Audit log sent to SIEM successfully');
    } catch (error) {
      this.logger.error('Failed to send audit log to SIEM', error);
    }
  }

  private async sendToSecurityMonitoring(data: any) {
    try {
      // Send to internal security monitoring
      await this.prisma.securityEvent.create({
        data: {
          type: 'audit_event',
          severity: data.severity,
          details: JSON.stringify(data),
          timestamp: data.timestamp,
          userId: data.userId,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create security event', error);
    }
  }

  private async sendCriticalAlert(data: any) {
    try {
      // Send critical alerts via multiple channels
      const alertChannels = [
        this.sendEmailAlert(data),
        this.sendSlackAlert(data),
        this.sendSMSAlert(data),
      ];

      await Promise.allSettled(alertChannels);
    } catch (error) {
      this.logger.error('Failed to send critical alert', error);
    }
  }

  private async sendEmailAlert(data: any) {
    // Implementation would integrate with email service
    this.logger.warn('Critical security event detected', data);
  }

  private async sendSlackAlert(data: any) {
    // Implementation would integrate with Slack
    this.logger.warn('Critical security event - Slack notification needed', data);
  }

  private async sendSMSAlert(data: any) {
    // Implementation would integrate with SMS service
    this.logger.warn('Critical security event - SMS notification needed', data);
  }

  private determineSeverity(action: string): 'low' | 'medium' | 'high' | 'critical' {
    const criticalActions = ['privilege_change', 'data_deletion', 'security_configuration_change'];
    const highActions = ['user_creation', 'user_deletion', 'sensitive_data_access'];
    const mediumActions = ['login_failure', 'permission_change', 'configuration_change'];

    if (criticalActions.includes(action)) return 'critical';
    if (highActions.includes(action)) return 'high';
    if (mediumActions.includes(action)) return 'medium';
    return 'low';
  }

  private getRelevantActionsForCompliance(reportType: string): string[] {
    const complianceActions = {
      gdpr: ['data_read', 'data_write', 'data_delete', 'consent_granted', 'consent_revoked', 'data_export'],
      hipaa: ['patient_data_access', 'phi_access', 'data_read', 'data_write', 'audit_log_access'],
      sox: ['financial_data_access', 'report_generation', 'data_modification', 'access_control_change'],
      pci: ['card_data_access', 'payment_processing', 'security_event', 'access_control_change'],
    };

    return complianceActions[reportType] || [];
  }

  private groupByAction(logs: any[]) {
    return logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {});
  }

  private groupByUser(logs: any[]) {
    return logs.reduce((acc, log) => {
      const username = log.user?.username || 'Unknown';
      acc[username] = (acc[username] || 0) + 1;
      return acc;
    }, {});
  }

  private assessComplianceStatus(logs: any[], reportType: string): string {
    // Simple compliance assessment logic
    const requiredEvents = this.getRequiredEventsForCompliance(reportType);
    const actualEvents = new Set(logs.map(log => log.action));
    const missingEvents = requiredEvents.filter(event => !actualEvents.has(event));

    if (missingEvents.length === 0) {
      return 'compliant';
    } else if (missingEvents.length <= requiredEvents.length * 0.2) {
      return 'mostly_compliant';
    } else {
      return 'non_compliant';
    }
  }

  private getRequiredEventsForCompliance(reportType: string): string[] {
    const requiredEvents = {
      gdpr: ['data_read', 'data_write', 'consent_granted'],
      hipaa: ['phi_access', 'audit_log_access'],
      sox: ['financial_data_access', 'report_generation'],
      pci: ['card_data_access', 'security_event'],
    };

    return requiredEvents[reportType] || [];
  }

  private generateComplianceRecommendations(logs: any[], reportType: string): string[] {
    const recommendations = [];

    if (logs.length === 0) {
      recommendations.push('No audit events found. Ensure audit logging is properly configured.');
    }

    const uniqueUsers = new Set(logs.map(log => log.userId)).size;
    if (uniqueUsers < 2) {
      recommendations.push('Limited user activity detected. Review user access patterns.');
    }

    const recentLogs = logs.filter(log => 
      new Date(log.timestamp).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
    );
    
    if (recentLogs.length === 0) {
      recommendations.push('No recent audit activity. Verify system is actively being used.');
    }

    return recommendations;
  }
}