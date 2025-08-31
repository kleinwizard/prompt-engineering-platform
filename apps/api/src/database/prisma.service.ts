import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: configService.get('DATABASE_URL'),
        },
      },
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'info',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    });
  }

  async onModuleInit() {
    // Log query events in development
    if (this.configService.get('NODE_ENV') === 'development') {
      this.$on('query' as never, (event: any) => {
        this.logger.debug(
          `Query: ${event.query} | Params: ${event.params} | Duration: ${event.duration}ms`,
        );
      });
    }

    this.$on('error' as never, (event: any) => {
      this.logger.error(`Prisma error: ${event.message}`, event.target);
    });

    this.$on('info' as never, (event: any) => {
      this.logger.log(`Prisma info: ${event.message}`);
    });

    this.$on('warn' as never, (event: any) => {
      this.logger.warn(`Prisma warning: ${event.message}`);
    });

    try {
      await this.$connect();
      this.logger.log('Successfully connected to database');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async enableShutdownHooks(app: any) {
    this.$on('beforeExit' as never, async () => {
      await app.close();
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }

  // Utility methods for common operations
  async healthCheck(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return false;
    }
  }

  async getStats() {
    const [userCount, promptCount, templateCount, challengeCount] =
      await Promise.all([
        this.user.count(),
        this.prompt.count(),
        this.template.count(),
        this.challenge.count(),
      ]);

    return {
      users: userCount,
      prompts: promptCount,
      templates: templateCount,
      challenges: challengeCount,
    };
  }

  // Transaction helper
  async transaction<T>(
    fn: (prisma: Omit<this, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(fn as any) as Promise<T>;
  }
}