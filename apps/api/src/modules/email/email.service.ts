import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as SendGrid from '@sendgrid/mail';
import * as AWS from 'aws-sdk';
import * as handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  template?: string;
  context?: Record<string, any>;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
  }>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  priority?: 'high' | 'normal' | 'low';
  headers?: Record<string, string>;
}

export interface EmailTemplate {
  name: string;
  subject: string;
  html: string;
  text?: string;
  variables: string[];
}

export interface EmailQueueItem extends EmailOptions {
  id: string;
  retries: number;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  error?: string;
  createdAt: Date;
  processedAt?: Date;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private provider: 'smtp' | 'sendgrid' | 'ses';
  private ses: AWS.SES | null = null;
  private templates: Map<string, handlebars.TemplateDelegate> = new Map();
  private emailQueue: EmailQueueItem[] = [];
  private isProcessingQueue = false;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.initializeEmailProvider();
    this.loadEmailTemplates();
    this.startQueueProcessor();
  }

  private async initializeEmailProvider(): Promise<void> {
    this.provider = this.configService.get('EMAIL_PROVIDER', 'smtp') as any;

    switch (this.provider) {
      case 'sendgrid':
        this.initializeSendGrid();
        break;
      case 'ses':
        this.initializeAWSSES();
        break;
      case 'smtp':
      default:
        this.initializeSMTP();
        break;
    }

    this.logger.log(`Email service initialized with provider: ${this.provider}`);
  }

  private initializeSMTP(): void {
    const host = this.configService.get('SMTP_HOST');
    const port = this.configService.get('SMTP_PORT', 587);
    const secure = this.configService.get('SMTP_SECURE', false);
    const user = this.configService.get('SMTP_USER');
    const pass = this.configService.get('SMTP_PASS');

    if (!host || !user || !pass) {
      this.logger.warn('SMTP configuration incomplete, email service disabled');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });

    // Verify connection
    this.transporter.verify((error) => {
      if (error) {
        this.logger.error('SMTP connection failed:', error);
      } else {
        this.logger.log('SMTP server connection verified');
      }
    });
  }

  private initializeSendGrid(): void {
    const apiKey = this.configService.get('SENDGRID_API_KEY');
    
    if (!apiKey) {
      this.logger.warn('SendGrid API key not configured');
      return;
    }

    SendGrid.setApiKey(apiKey);
    this.logger.log('SendGrid initialized successfully');
  }

  private initializeAWSSES(): void {
    const region = this.configService.get('AWS_REGION', 'us-east-1');
    const accessKeyId = this.configService.get('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get('AWS_SECRET_ACCESS_KEY');

    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn('AWS SES credentials not configured');
      return;
    }

    AWS.config.update({
      accessKeyId,
      secretAccessKey,
      region,
    });

    this.ses = new AWS.SES({ apiVersion: '2010-12-01' });
    this.logger.log('AWS SES initialized successfully');
  }

  private async loadEmailTemplates(): Promise<void> {
    try {
      const templatesDir = path.join(__dirname, 'templates');
      
      // Default templates
      const defaultTemplates = {
        'welcome': {
          subject: 'Welcome to Prompt Engineering Platform!',
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                  .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                  .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                  .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>Welcome, {{firstName}}!</h1>
                  </div>
                  <div class="content">
                    <p>Thank you for joining the Prompt Engineering Platform. We're excited to have you on board!</p>
                    <p>Get started by:</p>
                    <ul>
                      <li>Creating your first prompt</li>
                      <li>Exploring our template library</li>
                      <li>Joining a challenge</li>
                      <li>Completing learning paths</li>
                    </ul>
                    <center>
                      <a href="{{dashboardUrl}}" class="button">Go to Dashboard</a>
                    </center>
                    <p>If you have any questions, feel free to reach out to our support team.</p>
                  </div>
                  <div class="footer">
                    <p>&copy; 2024 Prompt Engineering Platform. All rights reserved.</p>
                    <p><a href="{{unsubscribeUrl}}">Unsubscribe</a> | <a href="{{preferencesUrl}}">Email Preferences</a></p>
                  </div>
                </div>
              </body>
            </html>
          `,
          text: 'Welcome {{firstName}}! Thank you for joining the Prompt Engineering Platform.',
        },
        'password-reset': {
          subject: 'Password Reset Request',
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: #ff6b6b; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                  .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                  .button { display: inline-block; padding: 12px 30px; background: #ff6b6b; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                  .code { background: #fff; padding: 15px; border: 2px dashed #ddd; font-size: 24px; font-weight: bold; text-align: center; margin: 20px 0; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>Password Reset</h1>
                  </div>
                  <div class="content">
                    <p>Hi {{firstName}},</p>
                    <p>We received a request to reset your password. Use the code below to reset it:</p>
                    <div class="code">{{resetCode}}</div>
                    <p>Or click the button below:</p>
                    <center>
                      <a href="{{resetUrl}}" class="button">Reset Password</a>
                    </center>
                    <p><strong>This code will expire in 1 hour.</strong></p>
                    <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
                  </div>
                </div>
              </body>
            </html>
          `,
          text: 'Password reset code: {{resetCode}}. This code will expire in 1 hour.',
        },
        'notification-digest': {
          subject: 'Your Weekly Digest - {{weekRange}}',
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                  .content { background: #f9f9f9; padding: 30px; }
                  .stat-box { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #667eea; }
                  .notification-item { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>Your Weekly Activity</h1>
                    <p>{{weekRange}}</p>
                  </div>
                  <div class="content">
                    <h2>📊 Your Stats</h2>
                    <div class="stat-box">
                      <strong>Prompts Created:</strong> {{promptsCreated}}<br>
                      <strong>Templates Used:</strong> {{templatesUsed}}<br>
                      <strong>Challenges Completed:</strong> {{challengesCompleted}}<br>
                      <strong>Points Earned:</strong> {{pointsEarned}}
                    </div>
                    
                    <h2>🔔 Recent Notifications</h2>
                    {{#each notifications}}
                    <div class="notification-item">
                      <strong>{{this.title}}</strong><br>
                      {{this.message}}<br>
                      <small>{{this.time}}</small>
                    </div>
                    {{/each}}
                  </div>
                </div>
              </body>
            </html>
          `,
          text: 'Your weekly digest for {{weekRange}}',
        },
      };

      // Compile templates
      for (const [name, template] of Object.entries(defaultTemplates)) {
        const htmlTemplate = handlebars.compile(template.html);
        const textTemplate = template.text ? handlebars.compile(template.text) : null;
        
        this.templates.set(`${name}-html`, htmlTemplate);
        if (textTemplate) {
          this.templates.set(`${name}-text`, textTemplate);
        }
      }

      this.logger.log(`Loaded ${this.templates.size} email templates`);
    } catch (error) {
      this.logger.error('Failed to load email templates:', error);
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      // Add to queue for processing
      const queueItem: EmailQueueItem = {
        ...options,
        id: this.generateId(),
        retries: 0,
        status: 'pending',
        createdAt: new Date(),
      };

      this.emailQueue.push(queueItem);
      
      // Process immediately if not already processing
      if (!this.isProcessingQueue) {
        this.processQueue();
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to queue email:', error);
      return false;
    }
  }

  async sendTemplateEmail(
    to: string | string[],
    templateName: string,
    context: Record<string, any>,
  ): Promise<boolean> {
    try {
      const htmlTemplate = this.templates.get(`${templateName}-html`);
      const textTemplate = this.templates.get(`${templateName}-text`);

      if (!htmlTemplate) {
        throw new Error(`Template ${templateName} not found`);
      }

      // Add default context values
      const enrichedContext = {
        ...context,
        appName: 'Prompt Engineering Platform',
        appUrl: this.configService.get('APP_URL', 'http://localhost:3000'),
        dashboardUrl: `${this.configService.get('APP_URL')}/dashboard`,
        unsubscribeUrl: `${this.configService.get('APP_URL')}/unsubscribe`,
        preferencesUrl: `${this.configService.get('APP_URL')}/preferences`,
        currentYear: new Date().getFullYear(),
      };

      const html = htmlTemplate(enrichedContext);
      const text = textTemplate ? textTemplate(enrichedContext) : this.htmlToText(html);

      // Determine subject based on template
      let subject = 'Notification from Prompt Engineering Platform';
      if (templateName === 'welcome') {
        subject = 'Welcome to Prompt Engineering Platform!';
      } else if (templateName === 'password-reset') {
        subject = 'Password Reset Request';
      } else if (templateName === 'notification-digest') {
        subject = `Your Weekly Digest - ${context.weekRange}`;
      }

      return await this.sendEmail({
        to,
        subject,
        html,
        text,
      });
    } catch (error) {
      this.logger.error(`Failed to send template email ${templateName}:`, error);
      return false;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.emailQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.emailQueue.length > 0) {
      const item = this.emailQueue.find(i => i.status === 'pending');
      if (!item) break;

      item.status = 'processing';
      
      try {
        await this.sendEmailViaProvider(item);
        item.status = 'sent';
        item.processedAt = new Date();
        
        // Log successful send
        await this.logEmailSent(item);
        
        // Remove from queue
        const index = this.emailQueue.indexOf(item);
        if (index > -1) {
          this.emailQueue.splice(index, 1);
        }
      } catch (error) {
        this.logger.error(`Failed to send email ${item.id}:`, error);
        item.error = error.message;
        item.retries++;
        
        if (item.retries >= 3) {
          item.status = 'failed';
          await this.logEmailFailed(item);
          
          // Remove from queue
          const index = this.emailQueue.indexOf(item);
          if (index > -1) {
            this.emailQueue.splice(index, 1);
          }
        } else {
          item.status = 'pending';
          // Retry after delay
          await this.delay(Math.pow(2, item.retries) * 1000);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  private async sendEmailViaProvider(options: EmailOptions): Promise<void> {
    switch (this.provider) {
      case 'sendgrid':
        await this.sendViaSendGrid(options);
        break;
      case 'ses':
        await this.sendViaAWSSES(options);
        break;
      case 'smtp':
      default:
        await this.sendViaSMTP(options);
        break;
    }
  }

  private async sendViaSMTP(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: this.configService.get('EMAIL_FROM', 'noreply@promptplatform.com'),
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo,
      priority: options.priority,
      headers: options.headers,
      attachments: options.attachments,
    };

    await this.transporter.sendMail(mailOptions);
  }

  private async sendViaSendGrid(options: EmailOptions): Promise<void> {
    const msg = {
      to: options.to,
      from: this.configService.get('EMAIL_FROM', 'noreply@promptplatform.com'),
      subject: options.subject,
      text: options.text || 'No text content',
      html: options.html || options.text || 'No content',
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo,
    };

    await SendGrid.send(msg as any);
  }

  private async sendViaAWSSES(options: EmailOptions): Promise<void> {
    if (!this.ses) {
      throw new Error('AWS SES not configured');
    }

    const params: AWS.SES.SendEmailRequest = {
      Source: this.configService.get('EMAIL_FROM', 'noreply@promptplatform.com'),
      Destination: {
        ToAddresses: Array.isArray(options.to) ? options.to : [options.to],
        CcAddresses: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
        BccAddresses: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
      },
      Message: {
        Subject: { Data: options.subject },
        Body: {
          Html: options.html ? { Data: options.html } : undefined,
          Text: { Data: options.text || 'No text content' },
        },
      },
    };

    await this.ses.sendEmail(params).promise();
  }

  private async logEmailSent(item: EmailQueueItem): Promise<void> {
    try {
      await this.prisma.emailLog.create({
        data: {
          to: Array.isArray(item.to) ? item.to.join(', ') : item.to,
          subject: item.subject,
          status: 'sent',
          provider: this.provider,
          sentAt: item.processedAt,
          metadata: {
            id: item.id,
            template: item.template,
          },
        },
      });
    } catch (error) {
      this.logger.warn('Failed to log email sent:', error);
    }
  }

  private async logEmailFailed(item: EmailQueueItem): Promise<void> {
    try {
      // Log failed email attempt
      await this.prisma.emailLog.create({
        data: {
          to: Array.isArray(item.to) ? item.to.join(', ') : item.to,
          subject: item.subject,
          status: 'failed',
          provider: this.provider,
          error: item.error,
          metadata: {
            id: item.id,
            template: item.template,
            retries: item.retries,
          },
        },
      });
    } catch (error) {
      this.logger.warn('Failed to log email failure:', error);
    }
  }

  private startQueueProcessor(): void {
    // Process queue every 10 seconds
    setInterval(() => {
      if (!this.isProcessingQueue && this.emailQueue.length > 0) {
        this.processQueue();
      }
    }, 10000);
  }

  private htmlToText(html: string): string {
    // Simple HTML to text conversion
    return html
      .replace(/<style[^>]*>.*?<\/style>/gi, '')
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public utility methods

  async verifyEmailConfiguration(): Promise<boolean> {
    try {
      switch (this.provider) {
        case 'smtp':
          if (!this.transporter) return false;
          await this.transporter.verify();
          return true;
        case 'sendgrid':
          // SendGrid doesn't have a verify method, check if API key is set
          return !!this.configService.get('SENDGRID_API_KEY');
        case 'ses':
          if (!this.ses) return false;
          await this.ses.getSendQuota().promise();
          return true;
        default:
          return false;
      }
    } catch (error) {
      this.logger.error('Email configuration verification failed:', error);
      return false;
    }
  }

  getQueueStatus(): {
    pending: number;
    processing: number;
    failed: number;
    total: number;
  } {
    const pending = this.emailQueue.filter(i => i.status === 'pending').length;
    const processing = this.emailQueue.filter(i => i.status === 'processing').length;
    const failed = this.emailQueue.filter(i => i.status === 'failed').length;

    return {
      pending,
      processing,
      failed,
      total: this.emailQueue.length,
    };
  }

  clearFailedEmails(): void {
    this.emailQueue = this.emailQueue.filter(i => i.status !== 'failed');
  }
}