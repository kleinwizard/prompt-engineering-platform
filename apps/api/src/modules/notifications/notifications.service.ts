import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';

interface NotificationData {
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
  actionUrl?: string;
  actionText?: string;
  imageUrl?: string;
  expiresAt?: Date;
}

interface NotificationPreferences {
  emailNotifications: boolean;
  pushNotifications: boolean;
  inAppNotifications: boolean;
  weeklyDigest: boolean;
  communityUpdates: boolean;
  promptUpdates: boolean;
  challengeUpdates: boolean;
  learningUpdates: boolean;
  marketingEmails: boolean;
  types: {
    [key: string]: {
      email: boolean;
      push: boolean;
      inApp: boolean;
    };
  };
}

interface EmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
  variables: Record<string, string>;
}

interface NotificationBatch {
  userId: string;
  notifications: NotificationData[];
  deliveryTime: Date;
  digest: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  
  @WebSocketServer()
  private server: Server;

  private readonly emailQueue: NotificationBatch[] = [];
  private readonly pushQueue: NotificationData[] = [];
  private readonly digestQueue: Map<string, NotificationData[]> = new Map();

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
  ) {
    // Initialize web push
    this.initializeWebPush();
    // Process notification queues every minute
    setInterval(() => {
      this.processEmailQueue().catch(error => 
        this.logger.error('Failed to process email queue', error)
      );
      this.processPushQueue().catch(error => 
        this.logger.error('Failed to process push queue', error)
      );
    }, 60000);

    // Process digest queue daily at 9 AM
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 9 && now.getMinutes() === 0) {
        this.processDigestQueue().catch(error => 
          this.logger.error('Failed to process digest queue', error)
        );
      }
    }, 60000);
  }

  async createNotification(
    userId: string,
    notificationData: NotificationData,
  ): Promise<void> {
    const {
      type,
      title,
      message,
      data = {},
      priority = 'medium',
      category = 'general',
      actionUrl,
      actionText,
      imageUrl,
      expiresAt,
    } = notificationData;

    // Get user's notification preferences
    const preferences = await this.getUserPreferences(userId);

    // Create notification in database
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data,
        priority,
        category,
        actionUrl,
        actionText,
        imageUrl,
        expiresAt,
      },
    });

    // Send in-app notification if enabled
    if (preferences.inAppNotifications && preferences.types[type]?.inApp !== false) {
      await this.sendInAppNotification(userId, notification);
    }

    // Queue email notification if enabled
    if (preferences.emailNotifications && preferences.types[type]?.email !== false) {
      await this.queueEmailNotification(userId, notification);
    }

    // Queue push notification if enabled
    if (preferences.pushNotifications && preferences.types[type]?.push !== false) {
      await this.queuePushNotification(userId, notification);
    }

    // Track analytics
    await this.trackNotificationAnalytics('notification.created', {
      userId,
      type,
      priority,
      category,
    });

    this.logger.log(`Notification created for user ${userId}: ${type}`);
  }

  async bulkCreateNotifications(
    userIds: string[],
    notificationData: NotificationData,
  ): Promise<void> {
    const notifications = userIds.map(userId => ({
      userId,
      ...notificationData,
      data: notificationData.data || {},
    }));

    await this.prisma.notification.createMany({
      data: notifications,
    });

    // Process each notification for delivery
    for (const userId of userIds) {
      const preferences = await this.getUserPreferences(userId);
      const notification = notifications.find(n => n.userId === userId);

      if (!notification) continue;

      // Send in-app notification
      if (preferences.inAppNotifications && preferences.types[notification.type]?.inApp !== false) {
        await this.sendInAppNotification(userId, notification);
      }

      // Queue other delivery methods
      if (preferences.emailNotifications && preferences.types[notification.type]?.email !== false) {
        await this.queueEmailNotification(userId, notification);
      }

      if (preferences.pushNotifications && preferences.types[notification.type]?.push !== false) {
        await this.queuePushNotification(userId, notification);
      }
    }

    this.logger.log(`Bulk notifications created for ${userIds.length} users: ${notificationData.type}`);
  }

  async getUserNotifications(
    userId: string,
    page = 1,
    limit = 20,
    unreadOnly = false,
  ): Promise<{
    notifications: any[];
    total: number;
    unreadCount: number;
  }> {
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return { notifications, total, unreadCount };
  }

  async markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    // Emit real-time update
    this.sendToUser(userId, 'notification:read', { notificationId });

    // Track analytics
    await this.trackNotificationAnalytics('notification.read', {
      userId,
      notificationId,
      type: notification.type,
      timeToRead: Date.now() - notification.createdAt.getTime(),
    });
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    // Emit real-time update
    this.sendToUser(userId, 'notifications:read_all', {
      count: result.count,
    });

    // Track analytics
    await this.trackNotificationAnalytics('notifications.read_all', {
      userId,
      count: result.count,
    });

    this.logger.log(`Marked ${result.count} notifications as read for user ${userId}`);
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    // Emit real-time update
    this.sendToUser(userId, 'notification:deleted', { notificationId });

    this.logger.log(`Notification ${notificationId} deleted for user ${userId}`);
  }

  async updateUserPreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    // ISSUE: Model 'userPreferences' referenced but may have different field names
    // FIX: Verify UserPreferences model has emailNotifications, pushNotifications fields
    const updatedPreferences = await this.prisma.userPreferences.upsert({
      where: { userId },
      update: {
        emailNotifications: preferences.emailNotifications,
        pushNotifications: preferences.pushNotifications,
        weeklyDigest: preferences.weeklyDigest,
        communityUpdates: preferences.communityUpdates,
        notificationSettings: preferences.types ? JSON.stringify(preferences.types) : undefined,
      },
      create: {
        userId,
        emailNotifications: preferences.emailNotifications ?? true,
        pushNotifications: preferences.pushNotifications ?? true,
        weeklyDigest: preferences.weeklyDigest ?? true,
        communityUpdates: preferences.communityUpdates ?? true,
        notificationSettings: preferences.types ? JSON.stringify(preferences.types) : '{}',
      },
    });

    this.logger.log(`Updated notification preferences for user ${userId}`);
    
    return this.formatNotificationPreferences(updatedPreferences);
  }

  async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    // ISSUE: Model 'userPreferences' may not have all notification-specific fields
    // FIX: Ensure UserPreferences model includes notification settings fields
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
    });

    if (!preferences) {
      // Return default preferences
      return {
        emailNotifications: true,
        pushNotifications: true,
        inAppNotifications: true,
        weeklyDigest: true,
        communityUpdates: true,
        promptUpdates: true,
        challengeUpdates: true,
        learningUpdates: true,
        marketingEmails: false,
        types: {},
      };
    }

    return this.formatNotificationPreferences(preferences);
  }

  async getNotificationStats(userId: string, timeframe = '30d'): Promise<{
    totalSent: number;
    totalRead: number;
    readRate: number;
    avgTimeToRead: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    const { startDate, endDate } = this.parseTimeframe(timeframe);

    const [notifications, readNotifications] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { id: true, type: true, priority: true, createdAt: true, readAt: true },
      }),
      this.prisma.notification.findMany({
        where: {
          userId,
          readAt: { gte: startDate, lte: endDate },
        },
        select: { createdAt: true, readAt: true },
      }),
    ]);

    const totalSent = notifications.length;
    const totalRead = notifications.filter(n => n.readAt).length;
    const readRate = totalSent > 0 ? (totalRead / totalSent) * 100 : 0;

    // Calculate average time to read
    const readTimes = readNotifications
      .map(n => n.readAt!.getTime() - n.createdAt.getTime())
      .filter(time => time > 0);
    const avgTimeToRead = readTimes.length > 0 
      ? readTimes.reduce((sum, time) => sum + time, 0) / readTimes.length 
      : 0;

    // Group by type and priority
    const byType = notifications.reduce((acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byPriority = notifications.reduce((acc, n) => {
      acc[n.priority] = (acc[n.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalSent,
      totalRead,
      readRate,
      avgTimeToRead,
      byType,
      byPriority,
    };
  }

  // Event listeners for automatic notifications

  @OnEvent('prompt.created')
  async handlePromptCreated(payload: any): Promise<void> {
    const { userId, promptId, title, category, isPublic } = payload;

    if (isPublic) {
      // ISSUE: getFollowers method references 'follow' model that doesn't exist
      // FIX: Create Follow model or update method to use existing relationships
      // Notify followers
      const followers = await this.getFollowers(userId);
      if (followers.length > 0) {
        await this.bulkCreateNotifications(
          followers.map(f => f.followerId),
          {
            type: 'prompt_created',
            title: 'New Prompt from a User You Follow',
            message: `A new ${category} prompt "${title}" was created`,
            data: { promptId, authorId: userId, category },
            category: 'social',
            actionUrl: `/prompts/${promptId}`,
            actionText: 'View Prompt',
            priority: 'low',
          }
        );
      }
    }
  }

  @OnEvent('prompt.forked')
  async handlePromptForked(payload: any): Promise<void> {
    const { originalUserId, userId, originalPromptId, forkedPromptId } = payload;

    if (originalUserId !== userId) {
      const user = await this.getUser(userId);
      await this.createNotification(originalUserId, {
        type: 'prompt_forked',
        title: 'Your Prompt Was Forked',
        message: `${user.username} forked your prompt`,
        data: { originalPromptId, forkedPromptId, forkedBy: userId },
        category: 'engagement',
        actionUrl: `/prompts/${forkedPromptId}`,
        actionText: 'View Fork',
        priority: 'medium',
      });
    }
  }

  @OnEvent('challenge.new')
  async handleNewChallenge(payload: any): Promise<void> {
    const { challengeId, title, category, difficulty } = payload;

    // Notify all users who are interested in challenges
    const interestedUsers = await this.prisma.user.findMany({
      where: {
        preferences: {
          communityUpdates: true,
          challengeUpdates: true,
        },
      },
      select: { id: true },
    });

    if (interestedUsers.length > 0) {
      await this.bulkCreateNotifications(
        interestedUsers.map(u => u.id),
        {
          type: 'new_challenge',
          title: 'New Challenge Available',
          message: `A new ${difficulty} ${category} challenge "${title}" is now available`,
          data: { challengeId, category, difficulty },
          category: 'challenges',
          actionUrl: `/challenges/${challengeId}`,
          actionText: 'Join Challenge',
          priority: 'medium',
        }
      );
    }
  }

  @OnEvent('badge.earned')
  async handleBadgeEarned(payload: any): Promise<void> {
    const { userId, badgeId, badgeName, badgeDescription, points } = payload;

    await this.createNotification(userId, {
      type: 'badge_earned',
      title: 'Badge Earned!',
      message: `Congratulations! You earned the "${badgeName}" badge`,
      data: { badgeId, points },
      category: 'achievements',
      actionUrl: `/profile?tab=badges`,
      actionText: 'View Badge',
      priority: 'high',
    });
  }

  @OnEvent('level.up')
  async handleLevelUp(payload: any): Promise<void> {
    const { userId, newLevel, totalPoints } = payload;

    await this.createNotification(userId, {
      type: 'level_up',
      title: 'Level Up!',
      message: `Congratulations! You've reached Level ${newLevel}`,
      data: { newLevel, totalPoints },
      category: 'achievements',
      actionUrl: `/profile`,
      actionText: 'View Profile',
      priority: 'high',
    });
  }

  @OnEvent('user.followed')
  async handleUserFollowed(payload: any): Promise<void> {
    const { followerId, followingId } = payload;

    const follower = await this.getUser(followerId);
    await this.createNotification(followingId, {
      type: 'user_followed',
      title: 'New Follower',
      message: `${follower.username} started following you`,
      data: { followerId },
      category: 'social',
      actionUrl: `/users/${followerId}`,
      actionText: 'View Profile',
      priority: 'low',
    });
  }

  // Private helper methods

  private async sendInAppNotification(userId: string, notification: any): Promise<void> {
    // Send real-time notification via WebSocket
    this.sendToUser(userId, 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      priority: notification.priority,
      category: notification.category,
      actionUrl: notification.actionUrl,
      actionText: notification.actionText,
      imageUrl: notification.imageUrl,
      createdAt: notification.createdAt,
    });
  }

  private async queueEmailNotification(userId: string, notification: any): Promise<void> {
    // Add to email queue for batch processing
    const existingBatch = this.emailQueue.find(batch => 
      batch.userId === userId && !batch.digest
    );

    if (existingBatch) {
      existingBatch.notifications.push(notification);
    } else {
      this.emailQueue.push({
        userId,
        notifications: [notification],
        deliveryTime: new Date(Date.now() + 5 * 60 * 1000), // 5 minute delay
        digest: false,
      });
    }
  }

  private async queuePushNotification(userId: string, notification: any): Promise<void> {
    // Add to push queue for processing
    this.pushQueue.push({
      userId,
      ...notification,
    });
  }

  private async processEmailQueue(): Promise<void> {
    const now = new Date();
    const readyBatches = this.emailQueue.filter(batch => batch.deliveryTime <= now);

    for (const batch of readyBatches) {
      try {
        await this.sendBatchEmail(batch);
        
        // Remove processed batch
        const index = this.emailQueue.indexOf(batch);
        if (index > -1) {
          this.emailQueue.splice(index, 1);
        }
      } catch (error) {
        this.logger.error(`Failed to send batch email to user ${batch.userId}`, error);
        
        // Retry later (move delivery time forward)
        batch.deliveryTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minute delay
      }
    }
  }

  private async processPushQueue(): Promise<void> {
    const batchSize = 100;
    const batch = this.pushQueue.splice(0, batchSize);

    if (batch.length === 0) return;

    try {
      // Process push notifications
      // Implementation would integrate with push notification service
      this.logger.log(`Processing ${batch.length} push notifications`);
      
      // Track analytics for sent push notifications
      for (const notification of batch) {
        await this.trackNotificationAnalytics('notification.push_sent', {
          userId: notification.userId,
          type: notification.type,
          priority: notification.priority,
        });
      }
    } catch (error) {
      this.logger.error('Failed to process push notification batch', error);
      
      // Re-queue failed notifications
      this.pushQueue.unshift(...batch);
    }
  }

  private async processDigestQueue(): Promise<void> {
    for (const [userId, notifications] of this.digestQueue.entries()) {
      try {
        await this.sendDigestEmail(userId, notifications);
        this.digestQueue.delete(userId);
      } catch (error) {
        this.logger.error(`Failed to send digest email to user ${userId}`, error);
      }
    }
  }

  private async sendBatchEmail(batch: NotificationBatch): Promise<void> {
    const user = await this.getUser(batch.userId);
    
    // Group notifications by type for better email structure
    const groupedNotifications = batch.notifications.reduce((acc, notif) => {
      if (!acc[notif.type]) {
        acc[notif.type] = [];
      }
      acc[notif.type].push(notif);
      return acc;
    }, {} as Record<string, any[]>);

    const emailTemplate = this.generateBatchEmailTemplate(user, groupedNotifications);
    
    // Send email (would integrate with email service)
    this.logger.log(`Sending batch email to ${user.email} with ${batch.notifications.length} notifications`);
    
    // Track analytics
    await this.trackNotificationAnalytics('notification.email_batch_sent', {
      userId: batch.userId,
      notificationCount: batch.notifications.length,
      types: Object.keys(groupedNotifications),
    });
  }

  private async sendDigestEmail(userId: string, notifications: NotificationData[]): Promise<void> {
    const user = await this.getUser(userId);
    const emailTemplate = this.generateDigestEmailTemplate(user, notifications);
    
    // Send digest email
    this.logger.log(`Sending digest email to ${user.email} with ${notifications.length} notifications`);
    
    // Track analytics
    await this.trackNotificationAnalytics('notification.digest_sent', {
      userId,
      notificationCount: notifications.length,
    });
  }

  private generateBatchEmailTemplate(user: any, groupedNotifications: Record<string, any[]>): EmailTemplate {
    const totalCount = Object.values(groupedNotifications).flat().length;
    
    return {
      subject: `You have ${totalCount} new notifications`,
      htmlBody: `
        <h2>Hi ${user.firstName || user.username},</h2>
        <p>Here are your recent notifications:</p>
        ${Object.entries(groupedNotifications).map(([type, notifs]) => `
          <h3>${this.formatNotificationType(type)}</h3>
          <ul>
            ${notifs.map(notif => `
              <li>
                <strong>${notif.title}</strong>
                <p>${notif.message}</p>
                ${notif.actionUrl ? `<a href="${notif.actionUrl}">${notif.actionText || 'View'}</a>` : ''}
              </li>
            `).join('')}
          </ul>
        `).join('')}
      `,
      textBody: `Hi ${user.firstName || user.username}, you have ${totalCount} new notifications...`,
      variables: { username: user.username, firstName: user.firstName },
    };
  }

  private generateDigestEmailTemplate(user: any, notifications: NotificationData[]): EmailTemplate {
    return {
      subject: 'Your weekly digest',
      htmlBody: `
        <h2>Weekly Digest for ${user.firstName || user.username}</h2>
        <p>Here's what happened this week:</p>
        <!-- Digest content would be generated here -->
      `,
      textBody: `Weekly digest for ${user.firstName || user.username}...`,
      variables: { username: user.username, firstName: user.firstName },
    };
  }

  private sendToUser(userId: string, event: string, data: any): void {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, data);
    }
  }

  private formatNotificationPreferences(preferences: any): NotificationPreferences {
    let types = {};
    try {
      types = preferences.notificationSettings ? 
        JSON.parse(preferences.notificationSettings) : {};
    } catch (error) {
      this.logger.warn('Failed to parse notification settings', error);
    }

    return {
      emailNotifications: preferences.emailNotifications ?? true,
      pushNotifications: preferences.pushNotifications ?? true,
      inAppNotifications: true, // Always enabled for in-app
      weeklyDigest: preferences.weeklyDigest ?? true,
      communityUpdates: preferences.communityUpdates ?? true,
      promptUpdates: true,
      challengeUpdates: preferences.challengeUpdates ?? true,
      learningUpdates: preferences.learningUpdates ?? true,
      marketingEmails: preferences.marketingEmails ?? false,
      types,
    };
  }

  private formatNotificationType(type: string): string {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private parseTimeframe(timeframe: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate: Date;

    if (timeframe.endsWith('d')) {
      const days = parseInt(timeframe.replace('d', ''));
      startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    } else if (timeframe.endsWith('w')) {
      const weeks = parseInt(timeframe.replace('w', ''));
      startDate = new Date(endDate.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe.endsWith('m')) {
      const months = parseInt(timeframe.replace('m', ''));
      startDate = new Date(endDate.getTime() - months * 30 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  private async getUser(userId: string): Promise<any> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });
  }

  private async getFollowers(userId: string): Promise<any[]> {
    // ISSUE: Model 'follow' does not exist in Prisma schema
    // FIX: Create Follow model for user following relationships
    return this.prisma.follow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
    });
  }

  private async trackNotificationAnalytics(event: string, data: any): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId: data.userId,
          sessionId: 'notifications-service',
          event,
          properties: data,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to track notification analytics', error);
    }
  }

  private initializeWebPush(): void {
    const vapidPublicKey = this.configService.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = this.configService.get('VAPID_PRIVATE_KEY');

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(
        'mailto:support@promptplatform.com',
        vapidPublicKey,
        vapidPrivateKey
      );
      this.logger.log('Web push service initialized successfully');
    } else {
      this.logger.warn('VAPID keys not configured - push notifications disabled');
    }
  }

  async sendPushNotification(userId: string, notification: NotificationData): Promise<void> {
    try {
      // ISSUE: Model 'pushSubscription' does not exist in Prisma schema
      // FIX: Create PushSubscription model for web push notifications
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: { userId }
      });

      if (subscriptions.length === 0) {
        this.logger.debug(`No push subscriptions found for user ${userId}`);
        return;
      }

      const promises = subscriptions.map(sub => 
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          },
          JSON.stringify({
            title: notification.title,
            body: notification.message,
            icon: '/icon-192x192.png',
            badge: '/badge-72x72.png',
            image: notification.imageUrl,
            tag: notification.type,
            data: {
              url: notification.actionUrl,
              type: notification.type,
              ...notification.data
            },
            actions: notification.actionText ? [{
              action: 'view',
              title: notification.actionText,
              icon: '/icon-192x192.png'
            }] : undefined,
            requireInteraction: notification.priority === 'urgent',
            silent: notification.priority === 'low'
          })
        ).catch(err => {
          if (err.statusCode === 410) {
            // ISSUE: Model 'pushSubscription' does not exist in Prisma schema
            // FIX: Create PushSubscription model for managing web push subscriptions
            // Subscription expired, remove it
            return this.prisma.pushSubscription.delete({
              where: { id: sub.id }
            }).catch(() => {
              // Ignore deletion errors
            });
          } else if (err.statusCode === 413) {
            this.logger.warn(`Push notification payload too large for user ${userId}`);
          } else if (err.statusCode >= 400 && err.statusCode < 500) {
            this.logger.warn(`Invalid push subscription for user ${userId}, removing`, err);
            return this.prisma.pushSubscription.delete({
              where: { id: sub.id }
            }).catch(() => {
              // Ignore deletion errors
            });
          } else {
            this.logger.error(`Failed to send push notification to user ${userId}`, err);
          }
        })
      );

      await Promise.allSettled(promises);
      
      // Track push notification analytics
      await this.trackNotificationAnalytics('push_notification_sent', {
        userId,
        type: notification.type,
        subscriptionCount: subscriptions.length
      });

      this.logger.debug(`Push notifications sent to ${subscriptions.length} subscriptions for user ${userId}`);
      
    } catch (error) {
      this.logger.error(`Failed to send push notifications to user ${userId}`, error);
    }
  }

  async subscribeToPush(userId: string, subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      // ISSUE: Model 'pushSubscription' does not exist in Prisma schema
      // FIX: Create PushSubscription model with endpoint and auth fields
      // Check if subscription already exists
      const existingSubscription = await this.prisma.pushSubscription.findFirst({
        where: {
          userId,
          endpoint: subscription.endpoint
        }
      });

      if (existingSubscription) {
        // Update existing subscription
        await this.prisma.pushSubscription.update({
          where: { id: existingSubscription.id },
          data: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            userAgent: subscription.userAgent,
            updatedAt: new Date()
          }
        });
      } else {
        // ISSUE: Model 'pushSubscription' does not exist in Prisma schema
        // FIX: Create PushSubscription model with all necessary web push fields
        // Create new subscription
        await this.prisma.pushSubscription.create({
          data: {
            userId,
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            userAgent: subscription.userAgent
          }
        });
      }

      this.logger.log(`Push subscription updated for user ${userId}`);
      
      // Track subscription analytics
      await this.trackNotificationAnalytics('push_subscription_created', {
        userId,
        endpoint: subscription.endpoint
      });

    } catch (error) {
      this.logger.error(`Failed to subscribe user ${userId} to push notifications`, error);
      throw error;
    }
  }

  async unsubscribeFromPush(userId: string, endpoint: string): Promise<void> {
    try {
      await this.prisma.pushSubscription.deleteMany({
        where: {
          userId,
          endpoint
        }
      });

      this.logger.log(`Push subscription removed for user ${userId}`);
      
      // Track unsubscription analytics
      await this.trackNotificationAnalytics('push_subscription_removed', {
        userId,
        endpoint
      });

    } catch (error) {
      this.logger.error(`Failed to unsubscribe user ${userId} from push notifications`, error);
      throw error;
    }
  }

  async getPushSubscriptions(userId: string): Promise<any[]> {
    // ISSUE: Model 'pushSubscription' does not exist in Prisma schema
    // FIX: Create PushSubscription model for web push subscription management
    return this.prisma.pushSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async testPushNotification(userId: string): Promise<void> {
    await this.sendPushNotification(userId, {
      type: 'test',
      title: 'Test Notification',
      message: 'This is a test push notification from Prompt Engineering Platform',
      priority: 'medium',
      category: 'system',
      actionUrl: '/dashboard',
      actionText: 'Go to Dashboard'
    });
  }
}