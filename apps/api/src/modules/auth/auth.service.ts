import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto, RefreshTokenDto, ResetPasswordDto, VerifyEmailDto } from './dto';
import { JwtPayload, AuthTokens, UserWithProfile } from './interfaces';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds = 12;

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ user: UserWithProfile; tokens: AuthTokens }> {
    const { email, password, username, firstName, lastName } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      if (existingUser.email === email) {
        throw new ConflictException('Email already registered');
      }
      throw new ConflictException('Username already taken');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, this.saltRounds);

    // Create user with profile in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          username,
          passwordHash,
          firstName,
          lastName,
          preferences: {
            create: {
              theme: 'light',
              language: 'en',
              emailNotifications: true,
              pushNotifications: true,
            },
          },
          profile: {
            create: {
              totalPoints: 0,
              level: 1,
              currentStreak: 0,
              longestStreak: 0,
            },
          },
          skills: {
            create: {
              specificity: 0,
              constraints: 0,
              structure: 0,
              roleDefinition: 0,
              outputFormat: 0,
              verification: 0,
              safety: 0,
              overallScore: 0,
            },
          },
        },
        include: {
          profile: true,
          preferences: true,
          skills: true,
        },
      });

      // Award welcome badge
      const welcomeBadge = await tx.badge.findUnique({
        where: { slug: 'welcome' },
      });

      if (welcomeBadge) {
        await tx.userBadge.create({
          data: {
            userId: newUser.id,
            badgeId: welcomeBadge.id,
          },
        });
      }

      return newUser;
    });

    // Generate tokens
    const tokens = await this.generateTokens(user.id);

    // Log registration event
    await this.logSecurityEvent(user.id, 'registration', {
      method: 'email',
      timestamp: new Date().toISOString(),
    });

    return { user, tokens };
  }

  async login(loginDto: LoginDto, userAgent?: string, ip?: string): Promise<{ user: UserWithProfile; tokens: AuthTokens }> {
    const { email, password } = loginDto;

    // Find user with all relations
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        preferences: true,
        skills: true,
      },
    });

    if (!user) {
      await this.logSecurityEvent(null, 'login_failed', {
        email,
        reason: 'user_not_found',
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      await this.logSecurityEvent(user.id, 'login_failed', {
        reason: 'invalid_password',
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (await this.isAccountLocked(user.id)) {
      throw new ForbiddenException('Account locked due to suspicious activity');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id);

    // Update last active
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActive: new Date() },
    });

    // Update streak
    await this.updateStreak(user.id);

    // Log successful login
    await this.logSecurityEvent(user.id, 'login_success', {
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    });

    return { user, tokens };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<AuthTokens> {
    const { refreshToken } = refreshTokenDto;

    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });

      // Verify user exists and is active
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Generate new tokens
      return this.generateTokens(user.id);
    } catch (error) {
      this.logger.warn('Invalid refresh token', { error: error.message });
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    // In a full implementation, you might want to blacklist tokens
    // For now, we'll just log the logout event
    await this.logSecurityEvent(userId, 'logout', {
      timestamp: new Date().toISOString(),
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if user exists
      return;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    // Store reset token (you'd typically store this in a separate table)
    // For now, we'll use a simple approach
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        // In production, store this in a separate password_reset_tokens table
        additionalContext: {
          passwordResetToken: resetToken,
          passwordResetExpires: expiresAt.toISOString(),
        } as any,
      },
    });

    // Send password reset email
    await this.emailService.sendTemplateEmail({
      to: user.email,
      template: 'password-reset',
      context: {
        firstName: user.firstName || user.username,
        resetToken,
        resetUrl: `${this.configService.get('WEB_URL')}/auth/reset-password?token=${resetToken}`,
        expiresIn: '1 hour'
      }
    });
    this.logger.log(`Password reset email sent to user ${user.id}`);
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { token, newPassword } = resetPasswordDto;

    // Find user by reset token
    const user = await this.prisma.user.findFirst({
      where: {
        // This is simplified - in production use a proper reset tokens table
        additionalContext: {
          path: ['passwordResetToken'],
          equals: token,
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const resetExpires = (user.additionalContext as any)?.passwordResetExpires;
    if (!resetExpires || new Date(resetExpires) < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, this.saltRounds);

    // Update password and clear reset token
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Store password reset token in user context  
        additionalContext: {
          ...((user.additionalContext as any) || {}),
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      },
    });

    // Log password reset
    await this.logSecurityEvent(user.id, 'password_reset', {
      timestamp: new Date().toISOString(),
    });
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<void> {
    const { token } = verifyEmailDto;

    // Find user by verification token
    const user = await this.prisma.user.findFirst({
      where: {
        // This is simplified - in production use a proper verification tokens table
        additionalContext: {
          path: ['emailVerificationToken'],
          equals: token,
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    // Mark email as verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        // Store email verification token in user context
        additionalContext: {
          ...((user.additionalContext as any) || {}),
          emailVerificationToken: null,
        },
      },
    });

    // Award email verification badge
    await this.awardBadge(user.id, 'email-verified');
  }

  private async generateTokens(userId: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.expiresIn'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateStreak(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user?.profile) return;

    const now = new Date();
    const lastActive = user.profile.lastActivityDate;
    const daysDiff = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

    let newStreak = user.profile.currentStreak;

    if (daysDiff === 1) {
      // Consecutive day
      newStreak += 1;
    } else if (daysDiff > 1) {
      // Streak broken
      newStreak = 1;
    }
    // If daysDiff === 0, same day - no change

    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        currentStreak: newStreak,
        longestStreak: Math.max(user.profile.longestStreak, newStreak),
        lastActivityDate: now,
      },
    });

    // Award streak badges
    if (newStreak === 7) await this.awardBadge(userId, 'week-streak');
    if (newStreak === 30) await this.awardBadge(userId, 'month-streak');
    if (newStreak === 100) await this.awardBadge(userId, 'century-streak');
  }

  private async awardBadge(userId: string, badgeSlug: string): Promise<void> {
    try {
      const badge = await this.prisma.badge.findUnique({
        where: { slug: badgeSlug },
      });

      if (!badge) return;

      // Check if user already has badge
      const existingBadge = await this.prisma.userBadge.findUnique({
        where: {
          userId_badgeId: {
            userId,
            badgeId: badge.id,
          },
        },
      });

      if (!existingBadge) {
        await this.prisma.userBadge.create({
          data: {
            userId,
            badgeId: badge.id,
          },
        });

        // Award points
        await this.prisma.userProfile.update({
          where: { userId },
          data: {
            totalPoints: { increment: badge.points },
            weeklyPoints: { increment: badge.points },
            monthlyPoints: { increment: badge.points },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to award badge ${badgeSlug} to user ${userId}`, error);
    }
  }

  private async isAccountLocked(userId: string): Promise<boolean> {
    // Check for recent failed login attempts
    const recentFailures = await this.prisma.analyticsEvent.count({
      where: {
        userId,
        event: 'auth.login_failed',
        createdAt: {
          gte: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
        },
      },
    });

    // Lock account after 5 failed attempts in 15 minutes
    if (recentFailures >= 5) {
      await this.logSecurityEvent(userId, 'account.locked', {
        reason: 'too_many_failed_attempts',
        failureCount: recentFailures,
      });
      return true;
    }

    return false;
  }

  private async logSecurityEvent(
    userId: string | null,
    event: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId,
          sessionId: crypto.randomUUID(),
          event: `auth.${event}`,
          properties: metadata,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      this.logger.error('Failed to log security event', { error, event, userId });
    }
  }

  async validateUser(email: string, password: string): Promise<UserWithProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        preferences: true,
        skills: true,
      },
    });

    if (user && await bcrypt.compare(password, user.passwordHash)) {
      return user;
    }
    return null;
  }

  async logLoginAttempt(data: {
    email: string;
    ipAddress: string;
    userAgent?: string;
    success: boolean;
    timestamp: Date;
  }): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId: null, // We don't have userId for failed attempts
          sessionId: crypto.randomUUID(),
          event: `auth.login_attempt`,
          properties: {
            email: data.email,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent || 'unknown',
            success: data.success,
            timestamp: data.timestamp.toISOString(),
          },
          timestamp: data.timestamp,
        },
      });
    } catch (error) {
      this.logger.error('Failed to log login attempt', { error, email: data.email });
    }
  }
}