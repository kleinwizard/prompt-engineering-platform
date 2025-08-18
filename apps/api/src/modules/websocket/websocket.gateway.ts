import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  },
  namespace: '/',
})
export class WebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebSocketGateway.name);
  private activeUsers = new Map<string, AuthenticatedSocket>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private gamificationService: GamificationService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization;
      
      if (!token) {
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token.replace('Bearer ', ''), {
        secret: this.configService.get<string>('jwt.secret'),
      });

      // Get user data
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          profile: true,
          preferences: true,
        },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      client.userId = user.id;
      client.user = user;
      this.activeUsers.set(user.id, client);

      // Join user to their personal room
      client.join(`user:${user.id}`);

      // Update user's online status
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActive: new Date() },
      });

      // Notify user's connections
      this.server.to(`user:${user.id}`).emit('status', {
        type: 'connected',
        timestamp: new Date()
      });

      // Notify friends of online status
      const friends = await this.prisma.follow.findMany({
        where: { followingId: user.id },
        include: { follower: true }
      });

      for (const friend of friends) {
        this.server.to(`user:${friend.followerId}`).emit('friend-online', {
          userId: user.id,
          username: user.username,
          timestamp: new Date()
        });
      }

      // Track activity
      await this.gamificationService.trackActivity({
        userId: user.id,
        type: 'session_start',
        timestamp: new Date()
      });

      this.logger.log(`User ${user.username} connected`);

      // Notify about connection
      client.emit('connected', {
        userId: user.id,
        onlineUsers: this.activeUsers.size,
      });

    } catch (error) {
      this.logger.error('Connection authentication failed', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      this.activeUsers.delete(client.userId);
      this.logger.log(`User ${client.userId} disconnected`);
    }
  }

  @SubscribeMessage('join-workspace')
  async handleJoinWorkspace(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() workspaceId: string,
  ) {
    if (!client.userId) return;

    await client.join(`workspace:${workspaceId}`);
    
    // Notify others in workspace
    client.to(`workspace:${workspaceId}`).emit('user-joined-workspace', {
      userId: client.userId,
      user: {
        id: client.user.id,
        username: client.user.username,
        avatar: client.user.avatar,
      },
    });

    this.logger.log(`User ${client.userId} joined workspace ${workspaceId}`);
  }

  @SubscribeMessage('leave-workspace')
  async handleLeaveWorkspace(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() workspaceId: string,
  ) {
    if (!client.userId) return;

    await client.leave(`workspace:${workspaceId}`);
    
    // Notify others in workspace
    client.to(`workspace:${workspaceId}`).emit('user-left-workspace', {
      userId: client.userId,
    });

    this.logger.log(`User ${client.userId} left workspace ${workspaceId}`);
  }

  @SubscribeMessage('prompt-updated')
  async handlePromptUpdated(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { workspaceId: string; prompt: string; version: number },
  ) {
    if (!client.userId) return;

    // Broadcast to other users in the workspace
    client.to(`workspace:${data.workspaceId}`).emit('prompt-updated', {
      userId: client.userId,
      prompt: data.prompt,
      version: data.version,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('prompt-improved')
  async handlePromptImproved(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      workspaceId: string;
      original: string;
      improved: string;
      metrics: any;
    },
  ) {
    if (!client.userId) return;

    // Award points for prompt improvement
    await this.gamificationService.awardPoints(client.userId, 'prompt_improved', {
      workspaceId: data.workspaceId,
      metrics: data.metrics,
    });

    // Broadcast to workspace
    client.to(`workspace:${data.workspaceId}`).emit('prompt-improved', {
      userId: client.userId,
      original: data.original,
      improved: data.improved,
      metrics: data.metrics,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('prompt-executed')
  async handlePromptExecuted(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      workspaceId: string;
      prompt: string;
      output: string;
      model: string;
      metrics: any;
    },
  ) {
    if (!client.userId) return;

    // Award points for prompt execution
    await this.gamificationService.awardPoints(client.userId, 'prompt_executed', {
      model: data.model,
      metrics: data.metrics,
    });

    // Broadcast to workspace
    client.to(`workspace:${data.workspaceId}`).emit('prompt-executed', {
      userId: client.userId,
      prompt: data.prompt,
      output: data.output,
      model: data.model,
      metrics: data.metrics,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('typing-start')
  async handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { workspaceId: string },
  ) {
    if (!client.userId) return;

    client.to(`workspace:${data.workspaceId}`).emit('user-typing', {
      userId: client.userId,
      typing: true,
    });
  }

  @SubscribeMessage('typing-stop')
  async handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { workspaceId: string },
  ) {
    if (!client.userId) return;

    client.to(`workspace:${data.workspaceId}`).emit('user-typing', {
      userId: client.userId,
      typing: false,
    });
  }

  @SubscribeMessage('challenge-joined')
  async handleChallengeJoined(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { challengeId: string },
  ) {
    if (!client.userId) return;

    await client.join(`challenge:${data.challengeId}`);

    // Award points for joining challenge
    await this.gamificationService.awardPoints(client.userId, 'challenge_participated', {
      challengeId: data.challengeId,
    });

    // Broadcast to challenge participants
    client.to(`challenge:${data.challengeId}`).emit('participant-joined', {
      userId: client.userId,
      user: {
        id: client.user.id,
        username: client.user.username,
        avatar: client.user.avatar,
      },
    });
  }

  @SubscribeMessage('comment-posted')
  async handleCommentPosted(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      promptId?: string;
      templateId?: string;
      comment: string;
    },
  ) {
    if (!client.userId) return;

    // Award points for community engagement
    await this.gamificationService.awardPoints(client.userId, 'comment_posted');

    // Broadcast to relevant users
    const targetRoom = data.promptId ? `prompt:${data.promptId}` : `template:${data.templateId}`;
    
    this.server.to(targetRoom).emit('comment-added', {
      userId: client.userId,
      user: {
        id: client.user.id,
        username: client.user.username,
        avatar: client.user.avatar,
      },
      comment: data.comment,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('points-awarded')
  async handlePointsAwarded(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    if (!client.userId) return;

    // Send real-time points update
    client.emit('points-updated', data);

    // If level up or badge earned, send celebration animation
    if (data.newLevel || data.newBadges?.length > 0) {
      client.emit('celebration', {
        type: data.newLevel ? 'level-up' : 'badge-earned',
        data: {
          newLevel: data.newLevel,
          newBadges: data.newBadges,
        },
      });
    }
  }

  // Server methods for external use
  async notifyUser(userId: string, event: string, data: any) {
    const userSocket = this.activeUsers.get(userId);
    if (userSocket) {
      userSocket.emit(event, data);
    }
  }

  async broadcastToWorkspace(workspaceId: string, event: string, data: any) {
    this.server.to(`workspace:${workspaceId}`).emit(event, data);
  }

  async broadcastToChallenge(challengeId: string, event: string, data: any) {
    this.server.to(`challenge:${challengeId}`).emit(event, data);
  }

  getOnlineUsersCount(): number {
    return this.activeUsers.size;
  }

  isUserOnline(userId: string): boolean {
    return this.activeUsers.has(userId);
  }
}